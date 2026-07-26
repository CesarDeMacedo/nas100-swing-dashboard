import type { BacktestRepository, StoredBacktestRun, StoredBacktestSignal } from './backtestRepository';

export type BacktestReportSummary = {
  signalCount: number;
  filledCount: number;
  cancelledCount: number;
  winCount: number;
  lossCount: number;
  unresolvedCount: number;
  winRate: number | null;
  /** Mean of `estimatedRewardRisk` (the R:R PLANNED at decision time, target[0] vs stop) over
   * every non-cancelled signal — includes losses and unresolved signals, not just wins. This
   * is distinct from `avgWinRewardRisk` below: since target[0] isn't fixed across signals (it
   * varies by zone/structure), the average planned R:R across all signals can diverge from
   * the average REALIZED R:R among winners only. */
  avgRewardRisk: number;
  /** Mean of `outcomeRR` (the R:R actually REALIZED) over 'win' signals only. null if there are
   * no wins. This — not `avgRewardRisk` — is what the expectancy formula uses. */
  avgWinRewardRisk: number | null;
  /** Standard expected-R-per-trade formula: winRate * avgWinRewardRisk - (1 - winRate) * 1.
   * 0 if winRate or avgWinRewardRisk is null (no resolved signals to compute from). */
  expectancy: number;
};

export type BacktestBreakdownEntry = { signalCount: number; winRate: number | null };

export type BacktestReport = {
  run: StoredBacktestRun;
  summary: BacktestReportSummary;
  breakdownByHour: Array<{ hour: number } & BacktestBreakdownEntry>;
  breakdownByWeekday: Array<{ weekday: number } & BacktestBreakdownEntry>;
  signals: StoredBacktestSignal[];
};

const winRateOf = (wins: number, losses: number): number | null => (wins + losses === 0 ? null : wins / (wins + losses));

const breakdownBy = <TKey extends number>(signals: StoredBacktestSignal[], keyOf: (signal: StoredBacktestSignal) => TKey, keys: readonly TKey[]) =>
  keys.map((key) => {
    const inGroup = signals.filter((signal) => keyOf(signal) === key);
    const wins = inGroup.filter((signal) => signal.status === 'win').length;
    const losses = inGroup.filter((signal) => signal.status === 'loss').length;
    return { key, signalCount: inGroup.length, winRate: winRateOf(wins, losses) };
  });

/** Computed on read from the raw `backtest_signals` rows, not pre-aggregated at write time —
 * a single backtest has at most a few hundred signals, aggregation is cheap, and this needs
 * to support ad hoc breakdowns that would otherwise require precomputing every combination. */
export function buildBacktestReport(repository: BacktestRepository, runId: string): BacktestReport | null {
  const run = repository.getRun(runId);
  if (!run) return null;
  const signals = repository.listSignals(runId);

  const nonCancelled = signals.filter((signal) => signal.status !== 'cancelled');
  const wins = signals.filter((signal) => signal.status === 'win');
  const losses = signals.filter((signal) => signal.status === 'loss');
  const cancelled = signals.filter((signal) => signal.status === 'cancelled');
  const unresolved = signals.filter((signal) => signal.status === 'unresolved');
  const filled = signals.filter((signal) => signal.filledAt !== null);

  const winRate = winRateOf(wins.length, losses.length);
  const avgRewardRisk = nonCancelled.length === 0 ? 0 : nonCancelled.reduce((sum, signal) => sum + signal.estimatedRewardRisk, 0) / nonCancelled.length;
  const avgWinRewardRisk = wins.length === 0 ? null : wins.reduce((sum, signal) => sum + (signal.outcomeRR ?? 0), 0) / wins.length;
  const expectancy = winRate === null || avgWinRewardRisk === null ? 0 : winRate * avgWinRewardRisk - (1 - winRate) * 1;

  const hourGroups = breakdownBy(signals, (signal) => signal.localHourOfDay, Array.from({ length: 24 }, (_, hour) => hour));
  const weekdayGroups = breakdownBy(signals, (signal) => signal.localWeekday, [0, 1, 2, 3, 4, 5, 6]);

  return {
    run,
    summary: {
      signalCount: nonCancelled.length + cancelled.length,
      filledCount: filled.length,
      cancelledCount: cancelled.length,
      winCount: wins.length,
      lossCount: losses.length,
      unresolvedCount: unresolved.length,
      winRate,
      avgRewardRisk,
      avgWinRewardRisk,
      expectancy,
    },
    breakdownByHour: hourGroups.map(({ key, signalCount, winRate: rate }) => ({ hour: key, signalCount, winRate: rate })),
    breakdownByWeekday: weekdayGroups.map(({ key, signalCount, winRate: rate }) => ({ weekday: key, signalCount, winRate: rate })),
    signals,
  };
}
