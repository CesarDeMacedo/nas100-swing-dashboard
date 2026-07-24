import type { ServerResponse } from 'node:http';

import { h4Window } from '../domain/h4Window';
import type { OandaEnvironment, OandaH4CandleResult } from '../providers/oanda/types';

type LiveH4Candle = OandaH4CandleResult['candles'][number];

export type LiveH4StreamDependencies = {
  instrument: string;
  environment: OandaEnvironment;
  fetchSnapshot: (count: number) => Promise<OandaH4CandleResult>;
  openPricingStream: (signal: AbortSignal) => Promise<Response>;
  reconnectDelaysMs?: number[];
};

type LiveConnectionState = 'idle' | 'connecting' | 'live';

const sse = (response: ServerResponse, event: string, payload: unknown) =>
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

/**
 * Owns the server-side OANDA pricing-stream state machine relayed to the browser over
 * local SSE: connection lifecycle (idle/connecting/live), shared subscriber broadcast,
 * reconnect with backoff, H4 rollover snapshot refresh, and stop-on-idle. Never touches
 * persisted reports or strategy decisions — this is observation only.
 *
 * Extracted from server.ts, where this state machine (closure-scoped variables mixed
 * into the HTTP request handler) was directly implicated in three separate bugs found
 * during lifecycle testing: a late subscriber not receiving replayed connection state,
 * a subscriber bypassing the scheduled reconnect backoff, and unflushed SSE headers.
 * Isolating it here makes it unit-testable without a real HTTP server.
 */
export class LiveH4Stream {
  private readonly subscribers = new Set<ServerResponse>();
  private readonly reconnectDelays: number[];
  private abort: AbortController | null = null;
  private openCandle: LiveH4Candle | null = null;
  private lastCompletedTime: string | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private rolloverRefresh: Promise<void> | null = null;
  private connectionState: LiveConnectionState = 'idle';
  private lastSnapshot: Awaited<ReturnType<LiveH4Stream['snapshot']>> | null = null;

  public constructor(private readonly deps: LiveH4StreamDependencies) {
    this.reconnectDelays = deps.reconnectDelaysMs ?? [1000, 2000, 5000, 10000];
  }

  public subscribe(response: ServerResponse) {
    if (this.stopTimer) { clearTimeout(this.stopTimer); this.stopTimer = null; }
    this.subscribers.add(response);
    if (this.connectionState === 'live') {
      const receivedAt = new Date().toISOString();
      sse(response, 'connection', { state: 'live', receivedAt });
      sse(response, 'snapshot', {
        provider: 'oanda-v20' as const,
        environment: this.deps.environment,
        instrument: this.deps.instrument,
        receivedAt,
        currentPrice: this.openCandle?.close ?? null,
        openCandle: this.openCandle,
        lastCompletedH4SourceTime: this.lastCompletedTime,
        streamState: 'live' as const,
      });
    } else if (this.connectionState === 'connecting' && this.lastSnapshot) {
      // A subscriber joining mid-handshake (snapshot fetched, upstream pricing stream not
      // yet open) gets the same 'connecting' + snapshot replay a subscriber present from
      // the start would have seen, instead of sitting with no event until 'live'/'error'.
      const receivedAt = new Date().toISOString();
      sse(response, 'connection', { state: 'connecting', receivedAt });
      sse(response, 'snapshot', { ...this.lastSnapshot, receivedAt });
    } else {
      void this.start();
    }
  }

  public unsubscribe(response: ServerResponse) {
    this.subscribers.delete(response);
    if (this.subscribers.size === 0) this.stopTimer = setTimeout(() => this.stop(), 1_000);
  }

  public stop() {
    this.abort?.abort();
    this.abort = null;
    this.connectionState = 'idle';
    this.lastSnapshot = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.openCandle = null;
    this.subscribers.clear();
  }

  private broadcast(event: string, payload: unknown) {
    this.subscribers.forEach((subscriber) => sse(subscriber, event, payload));
  }

  private async snapshot() {
    const source = await this.deps.fetchSnapshot(2);
    this.openCandle = [...source.candles].reverse().find((candle) => !candle.isClosed) ?? null;
    this.lastCompletedTime = source.candles.filter((candle) => candle.isClosed).at(-1)?.time ?? null;
    return {
      provider: 'oanda-v20' as const,
      environment: this.deps.environment,
      instrument: source.instrument,
      receivedAt: new Date().toISOString(),
      currentPrice: this.openCandle?.close ?? null,
      openCandle: this.openCandle,
      lastCompletedH4SourceTime: this.lastCompletedTime,
      streamState: 'live' as const,
    };
  }

  private async start() {
    // reconnectTimer is cleared (set to null) right before the scheduled callback invokes
    // this method, so this guard only blocks *other* callers (e.g. a subscriber joining
    // mid-backoff) from short-circuiting the scheduled delay — it never blocks the
    // reconnect itself.
    if (this.abort || this.reconnectTimer) return;
    const controller = new AbortController();
    this.abort = controller;
    try {
      const snapshot = await this.snapshot();
      this.lastSnapshot = snapshot;
      this.connectionState = 'connecting';
      this.broadcast('connection', { state: 'connecting', receivedAt: snapshot.receivedAt });
      this.broadcast('snapshot', snapshot);
      const response = await this.deps.openPricingStream(controller.signal);
      this.reconnectAttempt = 0;
      this.connectionState = 'live';
      this.broadcast('connection', { state: 'live', receivedAt: new Date().toISOString() });
      const reader = response.body?.getReader();
      if (!reader) throw new Error('missing stream body');
      let pending = '';
      while (!controller.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += new TextDecoder().decode(chunk.value, { stream: true });
        const lines = pending.split('\n'); pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message: unknown = JSON.parse(line);
            if (!message || typeof message !== 'object') throw new Error('invalid');
            const record = message as Record<string, unknown>;
            if (record.type === 'PricingHeartbeat') { this.broadcast('heartbeat', { receivedAt: typeof record.time === 'string' ? record.time : new Date().toISOString(), streamState: 'live' }); continue; }
            if (record.type !== 'PRICE' || !Array.isArray(record.bids) || !Array.isArray(record.asks)) continue;
            const bid = Number((record.bids[0] as Record<string, unknown> | undefined)?.price);
            const ask = Number((record.asks[0] as Record<string, unknown> | undefined)?.price);
            if (!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error('invalid price');
            const midpoint = (bid + ask) / 2;
            const receivedAt = typeof record.time === 'string' ? record.time : new Date().toISOString();
            if (this.openCandle && Number.isFinite(Date.parse(receivedAt)) && h4Window(receivedAt) > h4Window(this.openCandle.time) && !this.rolloverRefresh) {
              this.rolloverRefresh = this.snapshot().then(() => undefined).catch(() => { this.broadcast('error', { state: 'stale', message: 'OANDA live H4 rollover refresh is unavailable.', receivedAt: new Date().toISOString() }); }).finally(() => { this.rolloverRefresh = null; });
            }
            if (this.openCandle) this.openCandle = { ...this.openCandle, high: Math.max(this.openCandle.high, midpoint), low: Math.min(this.openCandle.low, midpoint), close: midpoint, isClosed: false };
            this.broadcast('price', { currentPrice: midpoint, receivedAt, streamState: 'live' });
            if (this.openCandle) this.broadcast('candle', { candle: this.openCandle, receivedAt });
          } catch { this.broadcast('error', { state: 'stale', message: 'OANDA live observation received invalid stream data.', receivedAt: new Date().toISOString() }); }
        }
      }
      if (!controller.signal.aborted) { this.connectionState = 'idle'; this.broadcast('error', { state: 'reconnecting', message: 'OANDA live observation is reconnecting.', receivedAt: new Date().toISOString() }); this.scheduleReconnect(); }
    } catch {
      if (!controller.signal.aborted) { this.connectionState = 'idle'; this.broadcast('error', { state: 'reconnecting', message: 'OANDA live observation is reconnecting.', receivedAt: new Date().toISOString() }); this.scheduleReconnect(); }
    } finally {
      if (this.abort === controller) this.abort = null;
    }
  }

  private scheduleReconnect() {
    if (this.subscribers.size === 0 || this.reconnectTimer) return;
    const delay = this.reconnectDelays[Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.start(); }, delay);
  }
}
