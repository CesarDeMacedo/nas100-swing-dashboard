// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalService, LOCAL_SERVICE_HOST } from './server';
import type { SchedulerStatus } from './scheduler/fixtureScheduler';

type RunningService = {
  stop: () => Promise<void>;
  schedulerStatus: () => SchedulerStatus;
  baseUrl: string;
  directory: string;
};

const services: RunningService[] = [];

const startService = async (schedulerEnabled = false): Promise<RunningService> => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-service-'));
  const service = createLocalService({ databasePath: join(directory, 'history.sqlite'), port: 0, schedulerEnabled });
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
});

describe('local manual-run service', () => {
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
    const service = await startService(true);
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
});
