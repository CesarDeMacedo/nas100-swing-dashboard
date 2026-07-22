import type { Action, AnalysisReport, CandleStatus } from '../schemas';

export const MINIMUM_REWARD_RISK = 2;

export type SafetyReason =
  | 'open-candle'
  | 'unknown-candle'
  | 'stale-data'
  | 'invalid-data'
  | 'invalid-data-health'
  | 'event-risk-unavailable'
  | 'event-risk-blocking'
  | 'reward-risk'
  | 'missing-targets';

export type SafeAnalysisReport = AnalysisReport & {
  originalAction?: Action;
  safetyReason?: SafetyReason;
};

const prependUnique = (items: string[], message: string) => [
  message,
  ...items.filter((item) => item !== message),
];

const isEntryAction = (action: Action) => action === 'BUY' || action === 'SELL';

const blockWithNoTrade = (
  report: AnalysisReport,
  safetyReason: SafetyReason,
  reason: string,
  why: string,
): SafeAnalysisReport => ({
  ...report,
  originalAction: report.action,
  action: 'NO_TRADE',
  status: 'BLOCKED',
  safetyReason,
  reason,
  whyNoEntry: prependUnique(report.whyNoEntry, why),
});

const waitForCandle = (report: AnalysisReport, candleStatus: CandleStatus): SafeAnalysisReport => {
  const isOpen = candleStatus === 'OPEN';

  return {
    ...report,
    originalAction: report.action,
    action: 'WAIT_FOR_NEXT_4H_CLOSE',
    status: 'AWAITING_CANDLE_CLOSE',
    safetyReason: isOpen ? 'open-candle' : 'unknown-candle',
    reason: isOpen
      ? 'The latest H4 candle is still open.'
      : 'The latest H4 candle close has not been confirmed.',
    whyNoEntry: prependUnique(
      report.whyNoEntry,
      isOpen
        ? 'An open H4 candle cannot authorize an entry.'
        : 'Provider-confirmed H4 candle closure is required.',
    ),
    whatToDoNext: prependUnique(
      report.whatToDoNext,
      'Wait for the provider to confirm the completed H4 candle.',
    ),
  };
};

const waitForSafetyRequirement = (
  report: AnalysisReport,
  safetyReason: SafetyReason,
  reason: string,
  why: string,
): SafeAnalysisReport => ({
  ...report,
  originalAction: report.action,
  action: 'WAIT',
  status: 'BLOCKED',
  safetyReason,
  reason,
  whyNoEntry: prependUnique(report.whyNoEntry, why),
});

export function enforceAnalysisSafety(report: AnalysisReport): SafeAnalysisReport {
  if (report.dataFreshness === 'STALE' || report.dataHealth.status === 'STALE') {
    return blockWithNoTrade(
      report,
      'stale-data',
      'Market data is stale. No trade is authorized.',
      'The latest market data is stale.',
    );
  }

  if (report.dataFreshness === 'MISSING' || report.dataFreshness === 'INVALID') {
    return blockWithNoTrade(
      report,
      'invalid-data',
      'Required market data is unavailable or invalid.',
      'Required market data is unavailable.',
    );
  }

  if (
    report.dataHealth.status === 'INVALID' ||
    report.dataHealth.status === 'UNAVAILABLE' ||
    report.dataHealth.providerStatus === 'UNAVAILABLE' ||
    report.dataHealth.providerStatus === 'UNCONFIGURED'
  ) {
    return blockWithNoTrade(
      report,
      'invalid-data-health',
      'Data health checks failed. No trade is authorized.',
      'Validated market-data health is required.',
    );
  }

  if (!isEntryAction(report.action)) return report;

  if (report.latestCandleStatus !== 'COMPLETED' || report.dataHealth.latestCandleClosed !== true) {
    return waitForCandle(report, report.latestCandleStatus);
  }

  const unavailableEventRisk =
    report.eventRisk.length === 0 ||
    report.eventRisk.some(
      (event) =>
        event.status === 'UNAVAILABLE' ||
        event.freshness === 'MISSING' ||
        event.freshness === 'INVALID' ||
        event.freshness === 'STALE',
    );

  if (unavailableEventRisk) {
    return waitForSafetyRequirement(
      report,
      'event-risk-unavailable',
      'Required event-risk information is unavailable.',
      'Current event-risk information is required before an entry can be authorized.',
    );
  }

  if (report.eventRisk.some((event) => event.blocksEntry || event.severity === 'BLOCKING')) {
    return waitForSafetyRequirement(
      report,
      'event-risk-blocking',
      'A blocking event risk prevents entry authorization.',
      'A current event-risk item is blocking entry.',
    );
  }

  if (report.estimatedRR === undefined || report.estimatedRR < MINIMUM_REWARD_RISK) {
    return waitForSafetyRequirement(
      report,
      'reward-risk',
      'The minimum 2.0 reward-to-risk requirement is not satisfied.',
      'Reward-to-risk must be at least 2.0 before an entry can be authorized.',
    );
  }

  if (report.targets.length === 0) {
    return waitForSafetyRequirement(
      report,
      'missing-targets',
      'A validated target is required before entry authorization.',
      'At least one validated target is required.',
    );
  }

  return report;
}
