// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalService, loadProjectEnvironmentForServiceCli, LOCAL_SERVICE_HOST } from './server';
import type { SchedulerStatus } from './scheduler/fixtureScheduler';

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

const startService = async (options: { schedulerEnabled?: boolean; oandaEnvironment?: NodeJS.ProcessEnv; oandaFetch?: typeof fetch } = {}): Promise<RunningService> => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-service-'));
  const service = createLocalService({ databasePath: join(directory, 'history.sqlite'), port: 0, schedulerEnabled: options.schedulerEnabled ?? false, oandaEnvironment: options.oandaEnvironment, oandaFetch: options.oandaFetch });
  const health = await service.start();
  const running = { stop: service.stop, schedulerStatus: service.schedulerStatus, baseUrl: `http://${LOCAL_SERVICE_HOST}:${health.port}`, directory };
  services.push(running);
  return running;
};

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

    expect(health.scheduler).toMatchObject({ enabled: true, running: true, configuredSchedule: ['Monday-Friday 13:01', 'Sunday-Friday 21:01'] });
    await service.stop();
    expect(service.schedulerStatus().running).toBe(false);
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
});
