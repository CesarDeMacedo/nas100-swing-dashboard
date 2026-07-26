// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BacktestRepository } from '../backtestRepository';

const directories: string[] = [];
const createRepository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-backtest-'));
  directories.push(directory);
  return new BacktestRepository(join(directory, 'backtest-results.sqlite'));
};

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

const signal = (overrides: Partial<Parameters<BacktestRepository['insertSignal']>[0]> = {}) => ({
  id: 'signal-1',
  backtestRunId: 'run-1',
  decisionCandleTime: '2026-01-05T17:01:00.000Z',
  direction: 'long' as const,
  entryPrice: 110,
  invalidationPrice: 95,
  stopPrice: 92,
  targetPrice: 130,
  estimatedRewardRisk: (130 - 110) / (110 - 92),
  score: 80,
  grade: 'A',
  localHourOfDay: 13,
  localWeekday: 1,
  status: 'win' as const,
  filledAt: '2026-01-05T21:01:00.000Z',
  resolvedAt: '2026-01-06T01:01:00.000Z',
  outcomeRR: 1.11,
  ...overrides,
});

describe('BacktestRepository', () => {
  it('persists a run lifecycle from running to completed with its signals', () => {
    const repository = createRepository();
    const run = repository.createRun({ id: 'run-1', strategyConfigId: 'strategy-a:1', instrument: 'NAS100_USD', rangeStart: '2026-01-01', rangeEnd: '2026-02-01' });
    expect(run.status).toBe('running');

    repository.insertSignal(signal());
    repository.completeRun('run-1', 42);

    const stored = repository.getRun('run-1');
    expect(stored).toMatchObject({ status: 'completed', frameCount: 42 });
    expect(repository.listSignals('run-1')).toEqual([signal()]);
    repository.close();
  });

  it('records a failed run with its error message', () => {
    const repository = createRepository();
    repository.createRun({ id: 'run-2', strategyConfigId: 'strategy-a:1', instrument: 'NAS100_USD', rangeStart: '2026-01-01', rangeEnd: '2026-02-01' });
    repository.failRun('run-2', 'No cached H4 candles for NAS100_USD.');

    expect(repository.getRun('run-2')).toMatchObject({ status: 'failed', errorMessage: 'No cached H4 candles for NAS100_USD.' });
    repository.close();
  });

  it('filters runs by strategyConfigId and orders by most recently started', () => {
    const repository = createRepository();
    repository.createRun({ id: 'run-a', strategyConfigId: 'strategy-a:1', instrument: 'NAS100_USD', rangeStart: '2026-01-01', rangeEnd: '2026-02-01' });
    repository.createRun({ id: 'run-b', strategyConfigId: 'strategy-b:1', instrument: 'NAS100_USD', rangeStart: '2026-01-01', rangeEnd: '2026-02-01' });

    expect(repository.listRuns('strategy-a:1').map((r) => r.id)).toEqual(['run-a']);
    expect(repository.listRuns().map((r) => r.id).sort()).toEqual(['run-a', 'run-b']);
    repository.close();
  });
});
