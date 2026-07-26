// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalService, LOCAL_SERVICE_HOST } from './server';

type RunningService = { stop: () => Promise<void>; baseUrl: string; directory: string; backtestDirectory: string };

const services: RunningService[] = [];

const startService = async (): Promise<RunningService> => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-service-'));
  const backtestDirectory = mkdtempSync(join(tmpdir(), 'nas100-backtest-'));
  const service = createLocalService({
    databasePath: join(directory, 'history.sqlite'),
    backtestDatabasePath: join(backtestDirectory, 'backtest-results.sqlite'),
    port: 0,
    schedulerEnabled: false,
    notifySchedulerOutcome: () => {},
  });
  const health = await service.start();
  const running = { stop: service.stop, baseUrl: `http://${LOCAL_SERVICE_HOST}:${health.port}`, directory, backtestDirectory };
  services.push(running);
  return running;
};

afterEach(async () => {
  while (services.length) {
    const service = services.pop();
    if (!service) continue;
    await service.stop();
    rmSync(service.directory, { recursive: true, force: true });
    rmSync(service.backtestDirectory, { recursive: true, force: true });
  }
});

const validParameters = () => ({
  minRewardRisk: 2,
  premiumScoreThreshold: 70,
  atrLocationTolerance: 0.35,
  atrTriggerBuffer: 0.05,
  atrStopBuffer: 0.25,
  atrInvalidationBuffer: 0.1,
  crossMarketPrimaryInstruments: ['us500', 'us30'],
  setupScoreWeights: { trend: 20, structure: 20, momentum: 15, location: 15, crossMarket: 10, eventRisk: 5, rewardRisk: 10, patienceReadiness: 5 },
  eventRisk: { blockingWindowMinutes: 60, minImpact: 'High' },
});

describe('strategy management endpoints', () => {
  it('creates a version-1 draft strategy and lists it', async () => {
    const service = await startService();
    const createResponse = await fetch(`${service.baseUrl}/strategies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Aggressive', parameters: validParameters() }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created).toMatchObject({ version: 1, status: 'draft', name: 'Aggressive' });

    const listResponse = await fetch(`${service.baseUrl}/strategies`);
    const list = await listResponse.json();
    expect(list.strategies).toHaveLength(1);
  });

  it('rejects a strategy whose minRewardRisk is below the 2.0 floor with 422, even calling the API directly', async () => {
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/strategies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Too tight', parameters: { ...validParameters(), minRewardRisk: 1.5 } }),
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('STRATEGY_VALIDATION_FAILED');
  });

  it('rejects setup-score weights that do not sum to 100', async () => {
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/strategies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad weights', parameters: { ...validParameters(), setupScoreWeights: { ...validParameters().setupScoreWeights, trend: 99 } } }),
    });
    expect(response.status).toBe(422);
  });

  it('creates a new draft version, activates it, and demotes the previously active version', async () => {
    const service = await startService();
    const v1 = await (await fetch(`${service.baseUrl}/strategies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'V1', parameters: validParameters() }) })).json();
    await fetch(`${service.baseUrl}/strategies/${v1.strategyId}/versions/1/activate`, { method: 'POST' });

    const v2Response = await fetch(`${service.baseUrl}/strategies/${v1.strategyId}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'V2', parameters: { ...validParameters(), minRewardRisk: 2.5 } }),
    });
    expect(v2Response.status).toBe(201);
    const v2 = await v2Response.json();
    expect(v2.version).toBe(2);

    const activateResponse = await fetch(`${service.baseUrl}/strategies/${v1.strategyId}/versions/2/activate`, { method: 'POST' });
    expect(activateResponse.status).toBe(200);

    const detail = await (await fetch(`${service.baseUrl}/strategies/${v1.strategyId}`)).json();
    expect(detail.versions.find((entry: { version: number }) => entry.version === 1).status).toBe('archived');
    expect(detail.versions.find((entry: { version: number }) => entry.version === 2).status).toBe('active');
  });

  it('returns 409 when activating a version that is not a draft, and 404 for an unknown strategy', async () => {
    const service = await startService();
    const created = await (await fetch(`${service.baseUrl}/strategies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Once', parameters: validParameters() }) })).json();
    await fetch(`${service.baseUrl}/strategies/${created.strategyId}/versions/1/activate`, { method: 'POST' });

    const secondActivate = await fetch(`${service.baseUrl}/strategies/${created.strategyId}/versions/1/activate`, { method: 'POST' });
    expect(secondActivate.status).toBe(409);

    const unknown = await fetch(`${service.baseUrl}/strategies/does-not-exist/versions/1/activate`, { method: 'POST' });
    expect(unknown.status).toBe(404);
  });

  it('404s for an unknown strategy id on GET', async () => {
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/strategies/does-not-exist`);
    expect(response.status).toBe(404);
  });
});

describe('backtest results endpoints', () => {
  it('returns an empty list when no backtest has ever been run', async () => {
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/backtests`);
    expect(response.status).toBe(200);
    expect((await response.json()).backtests).toEqual([]);
  });

  it('404s for an unknown backtest run id', async () => {
    const service = await startService();
    const response = await fetch(`${service.baseUrl}/backtests/does-not-exist`);
    expect(response.status).toBe(404);
  });
});
