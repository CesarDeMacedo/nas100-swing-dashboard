// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalService, loadProjectEnvironmentForServiceCli, LOCAL_SERVICE_HOST } from './server';
import type { SchedulerRunResult, SchedulerStatus } from './scheduler/fixtureScheduler';

type RunningService = {
  stop: () => Promise<void>;
  schedulerStatus: () => SchedulerStatus;
  baseUrl: string;
  directory: string;
};

const services: RunningService[] = [];
const oandaEnvironmentKeys = ['OANDA_ACCOUNT_ID', 'OANDA_API_TOKEN', 'OANDA_NAS100_INSTRUMENT'] as const;
let originalOandaEnvironment: Record<(typeof oandaEnvironmentKeys)[number], string | undefined> | undefined;

const clearOandaEnvironment = () => {
  originalOandaEnvironment ??= Object.fromEntries(oandaEnvironmentKeys.map((key) => [key, process.env[key]])) as Record<(typeof oandaEnvironmentKeys)[number], string | undefined>;
  for (const key of oandaEnvironmentKeys) delete process.env[key];
};

// Never let a test hit the real Forex Factory feed — resolves fast with a 404, which
// fetchForexFactoryEventRisk already treats as "unavailable" (falls back to the placeholder).
const stubEventRiskFetch: typeof fetch = async () => new Response('', { status: 404 });

const startService = async (options: { schedulerEnabled?: boolean; schedulerProvider?: 'fixture' | 'oanda'; schedulerIntervalMs?: number; schedulerNow?: () => Date; oandaEnvironment?: NodeJS.ProcessEnv; oandaFetch?: typeof fetch; scheduledOandaRetryDelaysMs?: number[]; notifySchedulerOutcome?: (result: SchedulerRunResult) => void; eventRiskFetch?: typeof fetch } = {}): Promise<RunningService> => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-service-'));
  // Always inject safe no-op/stub defaults unless a test overrides them — the scheduler must
  // never trigger a real OS notification or a real network call while running the test suite.
  const service = createLocalService({ databasePath: join(directory, 'history.sqlite'), port: 0, schedulerEnabled: options.schedulerEnabled ?? false, schedulerProvider: options.schedulerProvider, schedulerIntervalMs: options.schedulerIntervalMs, schedulerNow: options.schedulerNow, oandaEnvironment: options.oandaEnvironment, oandaFetch: options.oandaFetch, scheduledOandaRetryDelaysMs: options.scheduledOandaRetryDelaysMs, notifySchedulerOutcome: options.notifySchedulerOutcome ?? (() => {}), eventRiskFetch: options.eventRiskFetch ?? stubEventRiskFetch });
  const health = await service.start();
  const running = { stop: service.stop, schedulerStatus: service.schedulerStatus, baseUrl: `http://${LOCAL_SERVICE_HOST}:${health.port}`, directory };
  services.push(running);
  return running;
};

const oandaCandles = (latestCompletedTime = '2026-07-21T20:00:00.000Z') => ({
  candles: [
    { time: '2026-07-21T12:00:00.000Z', complete: true, volume: 10, mid: { o: '29000', h: '29020', l: '28990', c: '29010' } },
    { time: latestCompletedTime, complete: true, volume: 11, mid: { o: '29010', h: '29040', l: '29000', c: '29030' } },
    { time: '2026-07-22T00:00:00.000Z', complete: false, volume: 12, mid: { o: '29030', h: '99999', l: '1', c: '99998' } },
  ],
});

afterEach(async () => {
  while (services.length) {
    const service = services.pop();
    if (!service) continue;
    await service.stop();
    rmSync(service.directory, { recursive: true, force: true });
  }
  if (originalOandaEnvironment) {
    for (const key of oandaEnvironmentKeys) {
      const value = originalOandaEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalOandaEnvironment = undefined;
  }
});

describe('local manual-run service', () => {
  it('loads project .env credentials for the service CLI startup path', async () => {
    clearOandaEnvironment();
    const directory = mkdtempSync(join(tmpdir(), 'nas100-service-env-'));
    const envPath = join(directory, '.env');
    writeFileSync(envPath, 'OANDA_ACCOUNT_ID=account-from-file\nOANDA_API_TOKEN=token-from-file\nOANDA_NAS100_INSTRUMENT=NAS100_USD\n');

    loadProjectEnvironmentForServiceCli(envPath);
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/providers/oanda/status`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ state: 'configured', configuredInstrument: true });
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps a missing project .env safe and leaves OANDA unconfigured', async () => {
    clearOandaEnvironment();
    const directory = mkdtempSync(join(tmpdir(), 'nas100-service-env-'));

    expect(() => loadProjectEnvironmentForServiceCli(join(directory, '.env'))).not.toThrow();
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/providers/oanda/status`);

    await expect(response.json()).resolves.toMatchObject({ state: 'unconfigured' });
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps OS OANDA variables ahead of project .env values', () => {
    clearOandaEnvironment();
    const directory = mkdtempSync(join(tmpdir(), 'nas100-service-env-'));
    const envPath = join(directory, '.env');
    process.env.OANDA_API_TOKEN = 'token-from-os';
    writeFileSync(envPath, 'OANDA_API_TOKEN=token-from-file\n');

    loadProjectEnvironmentForServiceCli(envPath);

    expect(process.env.OANDA_API_TOKEN).toBe('token-from-os');
    rmSync(directory, { recursive: true, force: true });
  });

  it('never logs or returns an OANDA token loaded for the service CLI startup path', async () => {
    clearOandaEnvironment();
    const directory = mkdtempSync(join(tmpdir(), 'nas100-service-env-'));
    const envPath = join(directory, '.env');
    const token = 'token-never-exposed';
    writeFileSync(envPath, `OANDA_API_TOKEN=${token}\n`);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    loadProjectEnvironmentForServiceCli(envPath);
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/providers/oanda/verify`, { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(token);
    errorSpy.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports localhost health without creating a run', async () => {
    const service = await startService();
    const health = await fetch(`${service.baseUrl}/health`).then((response) => response.json());
    const history = await fetch(`${service.baseUrl}/runs`).then((response) => response.json());

    expect(health.host).toBe(LOCAL_SERVICE_HOST);
    expect(health.persistence.available).toBe(true);
    expect(health.scheduler).toMatchObject({ enabled: false, timezone: 'America/Toronto' });
    expect(history.runs).toEqual([]);
  });

  it('reports scheduler lifecycle status and clears its timer when stopped', async () => {
    const service = await startService({ schedulerEnabled: true });
    const health = await fetch(`${service.baseUrl}/health`).then((response) => response.json());

    expect(health.scheduler).toMatchObject({ enabled: true, running: true, configuredProvider: 'fixture', activeProvider: 'fixture', configuredSchedule: ['Monday-Friday 13:01', 'Sunday-Friday 21:01'] });
    await service.stop();
    expect(service.schedulerStatus().running).toBe(false);
  });

  it('keeps opt-in OANDA scheduling idle at service startup without requests', async () => {
    const fetcher = vi.fn();
    const service = await startService({ schedulerProvider: 'oanda', oandaEnvironment: { OANDA_ACCOUNT_ID: 'account-never-returned', OANDA_API_TOKEN: 'token-never-returned', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' }, oandaFetch: fetcher });
    const health = await fetch(`${service.baseUrl}/health`).then((response) => response.json());

    expect(health.scheduler).toMatchObject({ configuredProvider: 'oanda', activeProvider: 'oanda', lastRunResult: null, lastFailureSummary: null });
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(health)).not.toContain('token-never-returned');
  });

  it('retries the scheduled OANDA run through the real server wiring instead of failing the slot on one transient error', async () => {
    // Toronto 13:01 EDT = 17:01 UTC; the H4 candle expected to have just closed covers
    // [13:00, 17:00) UTC, so its time is 13:00Z (verified against scheduledOandaRun.test.ts).
    const fixedNow = new Date('2026-07-24T17:01:00.000Z');
    const expectedH4CandleTime = '2026-07-24T13:00:00.000Z';
    const h4CandlesPayload = {
      candles: [
        { time: '2026-07-24T09:00:00.000Z', complete: true, volume: 10, mid: { o: '29000', h: '29020', l: '28990', c: '29010' } },
        { time: expectedH4CandleTime, complete: true, volume: 11, mid: { o: '29010', h: '29040', l: '29000', c: '29030' } },
        { time: '2026-07-24T17:00:00.000Z', complete: false, volume: 12, mid: { o: '29030', h: '99999', l: '1', c: '99998' } },
      ],
    };
    const dailyCandlesPayload = {
      candles: [
        { time: '2026-07-22T00:00:00.000Z', complete: true, volume: 20, mid: { o: '29000', h: '29050', l: '28950', c: '29020' } },
        { time: '2026-07-23T00:00:00.000Z', complete: true, volume: 21, mid: { o: '29020', h: '29060', l: '28980', c: '29040' } },
        { time: '2026-07-24T00:00:00.000Z', complete: false, volume: 22, mid: { o: '29040', h: '99999', l: '1', c: '99998' } },
      ],
    };
    let h4Calls = 0;
    const fetcher: typeof fetch = async (input) => {
      const requestUrl = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
      const granularity = new URL(requestUrl).searchParams.get('granularity');
      if (granularity === 'D') return new Response(JSON.stringify(dailyCandlesPayload), { status: 200 });
      h4Calls += 1;
      if (h4Calls === 1) return new Response('', { status: 503 });
      return new Response(JSON.stringify(h4CandlesPayload), { status: 200 });
    };
    const service = await startService({
      schedulerEnabled: true,
      schedulerProvider: 'oanda',
      schedulerIntervalMs: 60_000,
      schedulerNow: () => fixedNow,
      scheduledOandaRetryDelaysMs: [20],
      oandaEnvironment: { OANDA_ACCOUNT_ID: 'account-never-returned', OANDA_API_TOKEN: 'token-never-returned', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' },
      oandaFetch: fetcher,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const health = await fetch(`${service.baseUrl}/health`).then((response) => response.json());

    expect(health.scheduler.lastRunResult).toMatchObject({ outcome: 'created' });
    expect(h4Calls).toBeGreaterThanOrEqual(2);
    const history = await fetch(`${service.baseUrl}/runs`).then((response) => response.json());
    expect(history.runs[0].run).toMatchObject({ triggeredBy: 'scheduler', status: 'COMPLETED' });
  });

  it('allows only local Vite preflight requests without changing its localhost bind', async () => {
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/runs/manual-fixture`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('persists one completed fixture report and makes repeated calls idempotent', async () => {
    const service = await startService();
    const first = await fetch(`${service.baseUrl}/runs/manual-fixture`, { method: 'POST' });
    const firstBody = await first.json();
    const second = await fetch(`${service.baseUrl}/runs/manual-fixture`, { method: 'POST' });
    const secondBody = await second.json();
    const history = await fetch(`${service.baseUrl}/runs`).then((response) => response.json());

    expect(first.status).toBe(201);
    expect(firstBody.alreadyExists).toBe(false);
    expect(second.status).toBe(200);
    expect(secondBody.alreadyExists).toBe(true);
    expect(secondBody.runKey).toBe(firstBody.runKey);
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].run.status).toBe('COMPLETED');
  });

  it('marks a manually-triggered fixture run as user-triggered', async () => {
    const service = await startService();
    const manual = await fetch(`${service.baseUrl}/runs/manual-fixture`, { method: 'POST' }).then((response) => response.json());
    const stored = await fetch(`${service.baseUrl}/runs/${encodeURIComponent(manual.runKey)}`).then((response) => response.json());
    expect(stored.run.triggeredBy).toBe('user');
  });

  it('lists and retrieves the immutable stored report', async () => {
    const service = await startService();
    const created = await fetch(`${service.baseUrl}/runs/manual-fixture`, { method: 'POST' }).then((response) => response.json());
    const history = await fetch(`${service.baseUrl}/runs?limit=1`).then((response) => response.json());
    const stored = await fetch(`${service.baseUrl}/runs/${encodeURIComponent(created.runKey)}`).then((response) => response.json());

    expect(history.runs).toHaveLength(1);
    expect(stored.run.runKey).toBe(created.runKey);
    expect(stored.report.action).toBe(created.action);
    expect(stored.report.score).toBe(created.score);
    expect(stored.report.targets).toEqual([]);
  });

  it('returns safe JSON errors for unknown runs and invalid limits', async () => {
    const service = await startService();
    const missing = await fetch(`${service.baseUrl}/runs/missing-run`);
    const invalid = await fetch(`${service.baseUrl}/runs?limit=invalid`);
    const aboveMaximum = await fetch(`${service.baseUrl}/runs?limit=101`);

    await expect(missing.json()).resolves.toEqual({ error: { code: 'RUN_NOT_FOUND', message: 'No persisted run matches this key.' } });
    await expect(invalid.json()).resolves.toEqual({ error: { code: 'INVALID_LIMIT', message: 'limit must be an integer between 1 and 100.' } });
    await expect(aboveMaximum.json()).resolves.toEqual({ error: { code: 'INVALID_LIMIT', message: 'limit must be an integer between 1 and 100.' } });
    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
    expect(aboveMaximum.status).toBe(400);
  });

  it('reports OANDA configuration without making a network request or exposing credentials', async () => {
    const fetcher = vi.fn();
    const service = await startService({ oandaEnvironment: { OANDA_API_TOKEN: 'secret-token' }, oandaFetch: fetcher });
    const response = await fetch(`${service.baseUrl}/providers/oanda/status`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ state: 'unconfigured', environment: 'practice', configuredInstrument: false });
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('verifies configured OANDA instruments through one read-only request', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ instruments: [{ name: 'NAS100_USD', displayName: 'NAS 100', type: 'CFD', displayPrecision: 1, pipLocation: -1 }] }), { status: 200 });
    };
    const service = await startService({
      oandaEnvironment: { OANDA_ACCOUNT_ID: 'account', OANDA_API_TOKEN: 'secret-token', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' },
      oandaFetch: fetcher,
    });
    const response = await fetch(`${service.baseUrl}/providers/oanda/verify`, { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ providerAvailable: true, environment: 'practice', configuredInstrument: true, configuredInstrumentSupported: true, candidates: [{ name: 'NAS100_USD' }] });
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(requestInit).toMatchObject({ method: 'GET' });
  });

  it('returns safe OANDA errors for unconfigured, unauthorized, and invalid candle requests', async () => {
    const unconfigured = await startService();
    const unconfiguredResponse = await fetch(`${unconfigured.baseUrl}/providers/oanda/verify`, { method: 'POST' });
    expect(unconfiguredResponse.status).toBe(409);
    await expect(unconfiguredResponse.json()).resolves.toMatchObject({ error: { code: 'OANDA_UNCONFIGURED' } });

    const unauthorized = await startService({
      oandaEnvironment: { OANDA_ACCOUNT_ID: 'account', OANDA_API_TOKEN: 'secret-token' },
      oandaFetch: vi.fn(async () => new Response('', { status: 401 })),
    });
    const unauthorizedResponse = await fetch(`${unauthorized.baseUrl}/providers/oanda/verify`, { method: 'POST' });
    expect(unauthorizedResponse.status).toBe(502);
    await expect(unauthorizedResponse.json()).resolves.toEqual({ error: { code: 'OANDA_VERIFY_FAILED', message: 'OANDA provider verification failed.' } });

    const candlesResponse = await fetch(`${unconfigured.baseUrl}/providers/oanda/candles?count=0`);
    expect(candlesResponse.status).toBe(409);
    await expect(candlesResponse.json()).resolves.toMatchObject({ error: { code: 'OANDA_INSTRUMENT_UNCONFIGURED' } });
  });

  it('returns normalized explicit-instrument H4 candles without changing the synthetic run path', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ candles: [{ time: '2026-07-21T21:00:00.000Z', complete: false, mid: { o: '29000', h: '29040', l: '28980', c: '29020' } }] }), { status: 200 });
    };
    const service = await startService({
      oandaEnvironment: { OANDA_ACCOUNT_ID: 'account', OANDA_API_TOKEN: 'secret-token', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' },
      oandaFetch: fetcher,
    });
    const response = await fetch(`${service.baseUrl}/providers/oanda/candles?count=1`);
    const body = await response.json();
    const manual = await fetch(`${service.baseUrl}/runs/manual-fixture`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(body.candles[0]).toMatchObject({ isClosed: false, timeframe: 'H4', source: 'oanda-v20' });
    expect(manual.status).toBe(201);
    expect(requestInit).toMatchObject({ method: 'GET' });
  });

  it('creates an idempotent manual OANDA report from completed candles only', async () => {
    const requestUrls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const requestUrl = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
      requestUrls.push(requestUrl);
      expect(init?.method).toBe('GET');
      const granularity = new URL(requestUrl).searchParams.get('granularity');
      return new Response(JSON.stringify(granularity === 'D' ? { candles: oandaCandles().candles.map((candle, index) => ({ ...candle, time: `2026-07-${String(19 + index).padStart(2, '0')}T00:00:00.000Z` })) } : oandaCandles()), { status: 200 });
    };
    const service = await startService({
      oandaEnvironment: { OANDA_ACCOUNT_ID: 'account-never-returned', OANDA_API_TOKEN: 'token-never-returned', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' },
      oandaFetch: fetcher,
    });

    const first = await fetch(`${service.baseUrl}/runs/manual-oanda`, { method: 'POST' });
    const firstBody = await first.json();
    const repeated = await fetch(`${service.baseUrl}/runs/manual-oanda`, { method: 'POST' }).then((response) => response.json());
    const stored = await fetch(`${service.baseUrl}/runs/${encodeURIComponent(firstBody.runKey)}`).then((response) => response.json());
    const urls = requestUrls.map((requestUrl) => new URL(requestUrl));

    expect(first.status).toBe(201);
    expect(urls.map((url) => url.searchParams.get('granularity'))).toContain('H4');
    expect(urls.map((url) => url.searchParams.get('granularity'))).toContain('D');
    expect(urls.every((url) => url.searchParams.get('count') === '250')).toBe(true);
    expect(firstBody).toMatchObject({ provider: 'oanda-v20', instrument: 'NAS100_USD', sourceCandleTime: '2026-07-21T20:00:00.000Z', h4SourceCandleTime: '2026-07-21T20:00:00.000Z', dailySourceCandleTime: '2026-07-20T00:00:00.000Z', h4CompletedCandleCount: 2, dailyCompletedCandleCount: 2, h4ExcludedOpenCandleCount: 1, dailyExcludedOpenCandleCount: 1, alreadyExists: false, isActionable: false });
    expect(['BUY', 'SELL']).not.toContain(firstBody.action);
    expect(repeated).toMatchObject({ runKey: firstBody.runKey, alreadyExists: true });
    expect(stored.report).toMatchObject({ sourceCandleTime: '2026-07-21T20:00:00.000Z', dailySourceCandleTime: '2026-07-20T00:00:00.000Z', currentPrice: 29030, targets: [] });
    expect(JSON.stringify({ firstBody, repeated, stored })).not.toContain('token-never-returned');
    expect(JSON.stringify(stored.report)).not.toContain('99999');
  });

  it('returns safe errors for unavailable configuration and malformed OANDA manual-run responses', async () => {
    const unconfigured = await startService();
    const unconfiguredResponse = await fetch(`${unconfigured.baseUrl}/runs/manual-oanda`, { method: 'POST' });
    expect(unconfiguredResponse.status).toBe(409);
    await expect(unconfiguredResponse.json()).resolves.toMatchObject({ error: { code: 'OANDA_INSTRUMENT_UNCONFIGURED' } });

    const malformed = await startService({
      oandaEnvironment: { OANDA_ACCOUNT_ID: 'account-never-returned', OANDA_API_TOKEN: 'token-never-returned', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' },
      oandaFetch: vi.fn(async () => new Response(JSON.stringify({ candles: [{ complete: true }] }), { status: 200 })),
    });
    const malformedResponse = await fetch(`${malformed.baseUrl}/runs/manual-oanda`, { method: 'POST' });
    const body = await malformedResponse.json();

    expect(malformedResponse.status).toBe(502);
    expect(body).toEqual({ error: { code: 'OANDA_MANUAL_RUN_FAILED', message: 'Manual OANDA analysis could not be completed.' } });
    expect(JSON.stringify(body)).not.toContain('token-never-returned');
  });
});
