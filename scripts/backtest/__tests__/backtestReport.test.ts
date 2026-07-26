// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BacktestRepository } from '../backtestRepository';
import { buildBacktestReport } from '../backtestReport';

const directories: string[] = [];
const createRepository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-backtest-report-'));
  directories.push(directory);
  return new BacktestRepository(join(directory, 'backtest-results.sqlite'));
};

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('buildBacktestReport', () => {
  it('computes win rate, avgRewardRisk (planned) distinctly from avgWinRewardRisk (realized), and expectancy from resolved signals only', () => {
    const repository = createRepository();
    repository.createRun({ id: 'run-1', strategyConfigId: 'strategy-a:1', instrument: 'NAS100_USD', rangeStart: '2026-01-01', rangeEnd: '2026-02-01' });

    const base = { backtestRunId: 'run-1', direction: 'long' as const, entryPrice: 110, invalidationPrice: 95, stopPrice: 92, targetPrice: 130, score: 80, grade: 'A' };
    repository.insertSignal({ ...base, id: 'a', decisionCandleTime: 't1', estimatedRewardRisk: 2, localHourOfDay: 13, localWeekday: 1, status: 'win', filledAt: 't1f', resolvedAt: 't1r', outcomeRR: 2 });
    repository.insertSignal({ ...base, id: 'b', decisionCandleTime: 't2', estimatedRewardRisk: 3, localHourOfDay: 13, localWeekday: 1, status: 'win', filledAt: 't2f', resolvedAt: 't2r', outcomeRR: 1 });
    repository.insertSignal({ ...base, id: 'c', decisionCandleTime: 't3', estimatedRewardRisk: 2.5, localHourOfDay: 17, localWeekday: 2, status: 'loss', filledAt: 't3f', resolvedAt: 't3r', outcomeRR: -1 });
    repository.insertSignal({ ...base, id: 'd', decisionCandleTime: 't4', estimatedRewardRisk: 2, localHourOfDay: 9, localWeekday: 3, status: 'cancelled', filledAt: null, resolvedAt: 't4r', outcomeRR: null });
    repository.insertSignal({ ...base, id: 'e', decisionCandleTime: 't5', estimatedRewardRisk: 2, localHourOfDay: 21, localWeekday: 4, status: 'unresolved', filledAt: 't5f', resolvedAt: null, outcomeRR: null });
    repository.completeRun('run-1', 500);

    const report = buildBacktestReport(repository, 'run-1');
    expect(report).not.toBeNull();
    expect(report!.summary.signalCount).toBe(5);
    expect(report!.summary.filledCount).toBe(4); // a, b, c, e all have filledAt set; d (cancelled) never filled
    expect(report!.summary.cancelledCount).toBe(1);
    expect(report!.summary.winCount).toBe(2);
    expect(report!.summary.lossCount).toBe(1);
    expect(report!.summary.unresolvedCount).toBe(1);
    expect(report!.summary.winRate).toBeCloseTo(2 / 3, 10);

    // avgRewardRisk (planned) is over all non-cancelled signals (a, b, c, e): (2 + 3 + 2.5 + 2) / 4
    expect(report!.summary.avgRewardRisk).toBeCloseTo(9.5 / 4, 10);
    // avgWinRewardRisk (realized) is over wins only (a, b): (2 + 1) / 2 — deliberately different from avgRewardRisk above
    expect(report!.summary.avgWinRewardRisk).toBeCloseTo(1.5, 10);
    expect(report!.summary.avgWinRewardRisk).not.toBeCloseTo(report!.summary.avgRewardRisk, 5);

    // expectancy = winRate * avgWinRewardRisk - (1 - winRate) * 1 = (2/3)*1.5 - (1/3)*1
    expect(report!.summary.expectancy).toBeCloseTo((2 / 3) * 1.5 - (1 / 3) * 1, 10);

    const hour13 = report!.breakdownByHour.find((h) => h.hour === 13);
    expect(hour13).toMatchObject({ signalCount: 2, winRate: 1 });
    const hour17 = report!.breakdownByHour.find((h) => h.hour === 17);
    expect(hour17).toMatchObject({ signalCount: 1, winRate: 0 });
    const hour9 = report!.breakdownByHour.find((h) => h.hour === 9);
    expect(hour9).toMatchObject({ signalCount: 1, winRate: null });

    const weekday1 = report!.breakdownByWeekday.find((w) => w.weekday === 1);
    expect(weekday1).toMatchObject({ signalCount: 2, winRate: 1 });

    repository.close();
  });

  it('returns a zero expectancy and null rates when there are no resolved signals at all', () => {
    const repository = createRepository();
    repository.createRun({ id: 'run-empty', strategyConfigId: 'strategy-a:1', instrument: 'NAS100_USD', rangeStart: '2026-01-01', rangeEnd: '2026-02-01' });
    repository.completeRun('run-empty', 0);

    const report = buildBacktestReport(repository, 'run-empty');
    expect(report!.summary).toMatchObject({ signalCount: 0, winRate: null, avgWinRewardRisk: null, expectancy: 0 });
    repository.close();
  });

  it('returns null for an unknown run id', () => {
    const repository = createRepository();
    expect(buildBacktestReport(repository, 'does-not-exist')).toBeNull();
    repository.close();
  });
});
