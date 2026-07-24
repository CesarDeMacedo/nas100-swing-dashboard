// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalService, LOCAL_SERVICE_HOST } from './server';

type RunningService = {
  stop: () => Promise<void>;
  baseUrl: string;
  directory: string;
};

const services: RunningService[] = [];
const openReaders: ReadableStreamDefaultReader[] = [];

const startService = async (oandaFetch: typeof fetch, liveReconnectDelaysMs?: number[]): Promise<RunningService> => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-live-'));
  const service = createLocalService({
    databasePath: join(directory, 'history.sqlite'),
    port: 0,
    schedulerEnabled: false,
    oandaEnvironment: { OANDA_ACCOUNT_ID: 'account-never-returned', OANDA_API_TOKEN: 'token-never-returned', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' },
    oandaFetch,
    liveReconnectDelaysMs,
  });
  const health = await service.start();
  const running = { stop: service.stop, baseUrl: `http://${LOCAL_SERVICE_HOST}:${health.port}`, directory };
  services.push(running);
  return running;
};

afterEach(async () => {
  while (openReaders.length) {
    const reader = openReaders.pop();
    await reader?.cancel().catch(() => undefined);
  }
  while (services.length) {
    const service = services.pop();
    if (!service) continue;
    await service.stop();
    rmSync(service.directory, { recursive: true, force: true });
  }
}, 15000);

type ControllableStream = {
  stream: ReadableStream<Uint8Array>;
  push: (line: string) => void;
  close: () => void;
};

const createControllableStream = (): ControllableStream => {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  return {
    stream,
    push: (line: string) => controllerRef?.enqueue(encoder.encode(`${line}\n`)),
    close: () => controllerRef?.close(),
  };
};

type SseEvent = { event: string; data: unknown };

const readSse = (response: Response) => {
  const events: SseEvent[] = [];
  const reader = response.body!.getReader();
  openReaders.push(reader);
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const eventLine = block.split('\n').find((line) => line.startsWith('event: '));
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        if (eventLine && dataLine) events.push({ event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) });
        boundary = buffer.indexOf('\n\n');
      }
    }
  };
  void pump().catch(() => undefined);
  return { events, reader };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 4000, intervalMs = 20) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

const closedCandle = { time: '2026-07-21T16:00:00.000Z', complete: true, volume: 10, mid: { o: '29000', h: '29020', l: '28990', c: '29010' } };
const openCandleWindow1 = { time: '2026-07-21T20:00:00.000Z', complete: false, volume: 5, mid: { o: '29010', h: '29010', l: '29010', c: '29010' } };
const rolledClosedCandle = { ...openCandleWindow1, complete: true };
const openCandleWindow2 = { time: '2026-07-22T00:00:00.000Z', complete: false, volume: 1, mid: { o: '29010', h: '29010', l: '29010', c: '29010' } };
const dailyCandle = (index: number) => ({ ...closedCandle, time: `2026-07-${String(19 + index).padStart(2, '0')}T00:00:00.000Z` });

/** Builds an oandaFetch mock: routes candle GETs by granularity/count and pricing-stream GETs to a controllable SSE-like body. */
const buildFetcher = () => {
  const streamRequests: ControllableStream[] = [];
  let h4CandleCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
    if (url.includes('/pricing/stream')) {
      const controllable = createControllableStream();
      streamRequests.push(controllable);
      return new Response(controllable.stream, { status: 200 });
    }
    const parsed = new URL(url);
    const granularity = parsed.searchParams.get('granularity');
    if (granularity === 'D') {
      return new Response(JSON.stringify({ candles: [dailyCandle(0), dailyCandle(1)] }), { status: 200 });
    }
    h4CandleCalls += 1;
    const count = parsed.searchParams.get('count');
    if (count === '2') {
      // Live snapshot request: return the rolled-over window once a rollover has occurred.
      const candles = h4CandleCalls === 1 ? [closedCandle, openCandleWindow1] : [rolledClosedCandle, openCandleWindow2];
      return new Response(JSON.stringify({ candles }), { status: 200 });
    }
    return new Response(JSON.stringify({ candles: [closedCandle, openCandleWindow1] }), { status: 200 });
  };
  return { fetcher, streamRequests, h4CandleCallCount: () => h4CandleCalls };
};

describe('OANDA live H4 observation lifecycle', () => {
  it('shares one upstream connection and identical broadcasts across multiple subscribers', async () => {
    const { fetcher, streamRequests } = buildFetcher();
    const service = await startService(fetcher);

    const firstResponse = await fetch(`${service.baseUrl}/providers/oanda/live-h4`);
    const secondResponse = await fetch(`${service.baseUrl}/providers/oanda/live-h4`);
    const first = readSse(firstResponse);
    const second = readSse(secondResponse);

    await waitFor(() => first.events.some((event) => event.event === 'connection' && (event.data as { state: string }).state === 'live'));
    await waitFor(() => second.events.some((event) => event.event === 'connection' && (event.data as { state: string }).state === 'live'));

    expect(streamRequests).toHaveLength(1);

    streamRequests[0].push(
      `${JSON.stringify({ type: 'PRICE', time: '2026-07-21T21:00:00.000Z', bids: [{ price: '29010.0' }], asks: [{ price: '29012.0' }] })}`,
    );

    await waitFor(() => first.events.some((event) => event.event === 'price') && second.events.some((event) => event.event === 'price'));

    const firstPrice = first.events.find((event) => event.event === 'price')?.data;
    const secondPrice = second.events.find((event) => event.event === 'price')?.data;
    expect(firstPrice).toEqual(secondPrice);
    expect((firstPrice as { currentPrice: number }).currentPrice).toBe(29011);
  }, 10000);

  it('reconnects with backoff after the upstream pricing stream ends unexpectedly', async () => {
    const { fetcher, streamRequests } = buildFetcher();
    const service = await startService(fetcher);

    const response = await fetch(`${service.baseUrl}/providers/oanda/live-h4`);
    const client = readSse(response);
    await waitFor(() => client.events.some((event) => event.event === 'connection' && (event.data as { state: string }).state === 'live'));
    expect(streamRequests).toHaveLength(1);

    streamRequests[0].close();

    await waitFor(() => client.events.some((event) => event.event === 'error' && (event.data as { state: string }).state === 'reconnecting'));
    await waitFor(() => streamRequests.length === 2, 4000);
    await waitFor(
      () => client.events.filter((event) => event.event === 'connection' && (event.data as { state: string }).state === 'live').length === 2,
      4000,
    );
  }, 10000);

  it('does not let a subscriber joining mid-backoff bypass the scheduled reconnect delay', async () => {
    // A large, test-only backoff delay so the "still only 1 request" assertion below has a
    // comfortable margin over real HTTP round-trip overhead — the eventual-reconnect path
    // itself is already covered by the "reconnects with backoff" test above, so this test
    // never needs to wait for the timer to actually fire.
    const { fetcher, streamRequests } = buildFetcher();
    const service = await startService(fetcher, [60_000]);

    const firstResponse = await fetch(`${service.baseUrl}/providers/oanda/live-h4`);
    const first = readSse(firstResponse);
    await waitFor(() => first.events.some((event) => event.event === 'connection' && (event.data as { state: string }).state === 'live'));
    expect(streamRequests).toHaveLength(1);

    streamRequests[0].close();
    await waitFor(() => first.events.some((event) => event.event === 'error' && (event.data as { state: string }).state === 'reconnecting'));

    // A second subscriber joins while the backoff timer is pending. The connect must not open
    // a second upstream pricing-stream request of its own — the scheduled timer is the only
    // thing allowed to reconnect.
    const secondResponse = await fetch(`${service.baseUrl}/providers/oanda/live-h4`);
    readSse(secondResponse);
    expect(streamRequests).toHaveLength(1);
  }, 10000);

  it('refreshes the H4 snapshot exactly once when a price tick rolls into the next H4 window', async () => {
    const { fetcher, streamRequests, h4CandleCallCount } = buildFetcher();
    const service = await startService(fetcher);

    const response = await fetch(`${service.baseUrl}/providers/oanda/live-h4`);
    const client = readSse(response);
    await waitFor(() => client.events.some((event) => event.event === 'connection' && (event.data as { state: string }).state === 'live'));
    expect(h4CandleCallCount()).toBe(1);

    streamRequests[0].push(
      `${JSON.stringify({ type: 'PRICE', time: '2026-07-22T00:05:00.000Z', bids: [{ price: '29020.0' }], asks: [{ price: '29022.0' }] })}`,
    );

    await waitFor(() => h4CandleCallCount() === 2);

    streamRequests[0].push(
      `${JSON.stringify({ type: 'PRICE', time: '2026-07-22T00:06:00.000Z', bids: [{ price: '29030.0' }], asks: [{ price: '29032.0' }] })}`,
    );
    await waitFor(() => client.events.filter((event) => event.event === 'price').length >= 2);

    expect(h4CandleCallCount()).toBe(2);
  }, 10000);

  it('never mutates a persisted OANDA run while the live stream is active', async () => {
    const { fetcher, streamRequests } = buildFetcher();
    const service = await startService(fetcher);

    const manualRun = await fetch(`${service.baseUrl}/runs/manual-oanda`, { method: 'POST' }).then((response) => response.json());
    expect(manualRun.alreadyExists).toBe(false);
    const storedBefore = await fetch(`${service.baseUrl}/runs/${encodeURIComponent(manualRun.runKey)}`).then((response) => response.json());

    const response = await fetch(`${service.baseUrl}/providers/oanda/live-h4`);
    const client = readSse(response);
    await waitFor(() => client.events.some((event) => event.event === 'connection' && (event.data as { state: string }).state === 'live'));

    for (const price of ['29050.0', '29075.0', '29100.0']) {
      streamRequests[0].push(`${JSON.stringify({ type: 'PRICE', time: '2026-07-21T21:10:00.000Z', bids: [{ price }], asks: [{ price }] })}`);
    }
    await waitFor(() => client.events.filter((event) => event.event === 'price').length >= 3);

    const storedAfter = await fetch(`${service.baseUrl}/runs/${encodeURIComponent(manualRun.runKey)}`).then((response) => response.json());
    const history = await fetch(`${service.baseUrl}/runs`).then((response) => response.json());

    expect(storedAfter).toEqual(storedBefore);
    expect(history.runs).toHaveLength(1);
  }, 10000);
});
