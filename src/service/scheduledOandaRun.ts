import { randomUUID } from 'node:crypto';

import { h4Window } from '../domain/h4Window';
import type { AnalysisRepository } from '../persistence/analysisRepository';
import type { OandaProvider } from '../providers/oanda/oandaProvider';
import type { OandaH4Candle } from '../providers/oanda/types';
import { fetchForexFactoryEventRisk } from './forexFactoryEventRisk';
import { fetchCrossMarketH4, OANDA_STRATEGY_VERSION, runManualOandaAnalysis, type OandaRunResult } from './oandaRun';

export type ScheduledOandaRunOptions = {
  retryDelaysMs?: number[];
  now?: () => Date;
  eventRiskFetcher?: typeof fetch;
};

const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 10000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const emptyResultBase = (instrument: string) => ({
  fetchedCandleCount: 0,
  completedCandleCount: 0,
  excludedOpenCandleCount: 0,
  provider: 'oanda-v20' as const,
  instrument,
  h4SourceCandleTime: null,
  dailySourceCandleTime: null,
  h4CompletedCandleCount: 0,
  dailyCompletedCandleCount: 0,
  h4ExcludedOpenCandleCount: 0,
  dailyExcludedOpenCandleCount: 0,
  h4DataStatus: 'unavailable' as const,
  dailyDataStatus: 'unavailable' as const,
  warnings: [] as string[],
});

const persistBlockedWindowRun = (
  repository: AnalysisRepository,
  instrument: string,
  startedAt: string,
  expectedWindow: number,
  actualCandleTime: string | null,
  attemptsUsed: number,
  reason: 'window-not-yet-available' | 'window-advanced',
): OandaRunResult => {
  const message = reason === 'window-advanced'
    ? `The latest completed OANDA H4 candle (${actualCandleTime ?? 'unavailable'}) is already past the H4 window expected for this scheduled slot; a retry cannot recover the expected window, so this slot was aborted after ${attemptsUsed} attempt(s) to avoid using data from the wrong window.`
    : `The OANDA H4 candle expected for this scheduled slot was not available after ${attemptsUsed} attempt(s) (latest completed candle: ${actualCandleTime ?? 'none'}). Aborted rather than risk using a stale or mismatched candle.`;
  const runKey = ['oanda-v20', instrument, 'H4', 'stale-window', String(expectedWindow), startedAt, OANDA_STRATEGY_VERSION].join(':');
  const run = repository.saveNonCompletedRun({
    id: randomUUID(),
    runKey,
    startedAt,
    completedAt: new Date().toISOString(),
    status: 'BLOCKED',
    source: 'manual',
    triggeredBy: 'scheduler',
    errorMessage: message,
  });
  return { ...emptyResultBase(instrument), outcome: 'blocked', run, report: null, message: run.errorMessage ?? undefined };
};

const persistExhaustedFailureRun = (
  repository: AnalysisRepository,
  instrument: string,
  startedAt: string,
  attemptsUsed: number,
  lastError: unknown,
): OandaRunResult => {
  const causeMessage = lastError instanceof Error ? lastError.message : 'unknown error';
  const message = `Scheduled OANDA analysis failed after ${attemptsUsed} attempt(s). Last failure: ${causeMessage}`;
  const runKey = ['oanda-v20', instrument, 'H4', 'failed', startedAt, OANDA_STRATEGY_VERSION].join(':');
  const run = repository.saveNonCompletedRun({
    id: randomUUID(),
    runKey,
    startedAt,
    completedAt: new Date().toISOString(),
    status: 'FAILED',
    source: 'manual',
    triggeredBy: 'scheduler',
    errorMessage: message,
  });
  return { ...emptyResultBase(instrument), outcome: 'failed', run, report: null, message: run.errorMessage ?? undefined };
};

/**
 * Runs the scheduler's OANDA analysis with retry/backoff, scoped to the scheduled path
 * only — OandaClient/OandaProvider and the manual /runs/manual-oanda endpoint are
 * untouched and remain single-attempt, since a user can simply click again.
 *
 * The non-negotiable guarantee (never confirm off a stale or wrong-window H4 candle) is
 * preserved by capturing the expected H4 window once, at the start, before any attempt:
 * `expectedCompletedWindow = h4Window(startedAt) - 1` — the window whose candle should
 * have just closed when this scheduled slot fired. Every attempt's result is checked
 * against that fixed expectation, never against "now":
 * - Exact match: build and persist the report normally.
 * - Candle older than expected (provider still finalizing the close): treated the same
 *   as a transient fetch error — retried within the normal backoff budget.
 * - Candle newer than expected (only reachable if real time drifted a full H4 window
 *   during retries — clock jump, suspended process, etc.): a retry cannot recover the
 *   expected window, so this aborts immediately without spending the rest of the budget.
 * Never falls through to runManualOandaAnalysis with data that didn't match the window.
 */
export const executeScheduledOandaAnalysis = async (
  repository: AnalysisRepository,
  provider: OandaProvider,
  instrument: string,
  options: ScheduledOandaRunOptions = {},
): Promise<OandaRunResult> => {
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const expectedCompletedWindow = h4Window(startedAt) - 1;
  let lastError: unknown;
  let lastCandleTime: string | null = null;
  const totalAttempts = delays.length + 1;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    let source: Awaited<ReturnType<OandaProvider['getH4Candles']>>;
    let dailySource: Awaited<ReturnType<OandaProvider['getDailyCandles']>>;
    try {
      [source, dailySource] = await Promise.all([
        provider.getH4Candles(instrument, 250),
        provider.getDailyCandles(instrument, 250),
      ]);
    } catch (cause) {
      lastError = cause;
      continue;
    }

    const latestCompleted: OandaH4Candle | undefined = source.candles.filter((candle) => candle.isClosed).at(-1);
    if (!latestCompleted) {
      lastCandleTime = null;
      continue;
    }

    const actualWindow = h4Window(latestCompleted.time);
    if (actualWindow === expectedCompletedWindow) {
      // Cross-market confirmation and event-risk are both supplementary, not safety-critical:
      // fetched here as single best-effort attempts, outside the window-retry loop above
      // (failures degrade to UNAVAILABLE downstream, they never block or retry this run).
      const [crossMarketH4, eventRisk] = await Promise.all([fetchCrossMarketH4(provider), fetchForexFactoryEventRisk(options.eventRiskFetcher ?? fetch)]);
      return runManualOandaAnalysis(repository, source, dailySource, 'scheduler', crossMarketH4, eventRisk ?? undefined);
    }
    if (actualWindow > expectedCompletedWindow) {
      return persistBlockedWindowRun(repository, instrument, startedAt, expectedCompletedWindow, latestCompleted.time, attempt + 1, 'window-advanced');
    }
    // actualWindow < expectedCompletedWindow: provider likely still finalizing the close.
    lastCandleTime = latestCompleted.time;
  }

  if (lastError !== undefined) return persistExhaustedFailureRun(repository, instrument, startedAt, totalAttempts, lastError);
  return persistBlockedWindowRun(repository, instrument, startedAt, expectedCompletedWindow, lastCandleTime, totalAttempts, 'window-not-yet-available');
};
