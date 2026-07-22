import type { DashboardState } from './buildDashboardState';

export const SWING_REPORT_VERSION = '1.0.0';

export type SwingReport = {
  reportVersion: typeof SWING_REPORT_VERSION;
  generatedAt: string;
  instrument: string;
  timeframe: string;
  sourceCandleTime: string | null;
  dataFreshness: DashboardState['dataFreshness'];
  regime: string;
  h4Structure: string;
  bias: string;
  action: DashboardState['action'];
  direction: DashboardState['direction'];
  setupStatus: string;
  score: number | null;
  grade: string | null;
  premiumSetupState: string;
  isActionable: boolean;
  currentPrice: number;
  entryTrigger: string | null;
  entryPrice: number | null;
  invalidationPrice: number | null;
  stopPrice: number | null;
  targets: number[];
  estimatedRewardRisk: number | null;
  primaryReason: string;
  reasons: string[];
  warnings: string[];
  whyNoEntry: string[];
  whatToDoNext: string[];
  marketContext: string[];
  dataHealth: DashboardState['dataHealth'];
};

export type SwingReportOutput = {
  report: SwingReport;
  text: string;
};

const formatPrice = (value: number | null) => (value === null ? 'Not available' : value.toFixed(2));
const formatTargets = (targets: readonly number[]) =>
  targets.length === 0 ? 'Not calculated' : targets.map((target) => target.toFixed(2)).join(', ');
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());

function actionMessage(report: SwingReport) {
  switch (report.action) {
    case 'BUY':
      return 'Long setup confirmed and actionable.';
    case 'SELL':
      return 'Short setup confirmed and actionable.';
    case 'WAIT_FOR_PULLBACK':
      return 'Directional context exists, but the preferred entry location has not been reached.';
    case 'WAIT_FOR_NEXT_4H_CLOSE':
      return 'Setup location is acceptable, but the next completed H4 candle must confirm.';
    case 'WAIT':
      return 'Evidence is incomplete.';
    case 'NO_TRADE':
      return 'Trading is blocked by the current safety state.';
  }
}

const entryTrigger = (report: SwingReport) => {
  if (report.action === 'WAIT_FOR_PULLBACK') return 'Waiting for pullback location';
  return report.entryTrigger ?? 'Not available';
};

function dataHealthWarnings(report: SwingReport) {
  const warnings = [...report.warnings];
  if (report.dataFreshness === 'STALE') warnings.push('Market data is stale.');
  if (report.dataHealth.latestCandleClosed === false) {
    warnings.push('Latest H4 candle is open or unconfirmed.');
  }
  return [...new Set(warnings)];
}

export function buildSwingReport(state: DashboardState): SwingReport {
  return {
    reportVersion: SWING_REPORT_VERSION,
    generatedAt: state.generatedAt,
    instrument: state.instrument,
    timeframe: state.timeframe,
    sourceCandleTime: state.sourceCandleTime,
    dataFreshness: state.dataFreshness,
    regime: state.marketRegime,
    h4Structure: state.h4Structure,
    bias: state.bias,
    action: state.action,
    direction: state.direction,
    setupStatus: state.setupStatus,
    score: state.score,
    grade: state.grade,
    premiumSetupState: state.premiumSetupState,
    isActionable: state.isActionable,
    currentPrice: state.currentPrice,
    entryTrigger: state.entryTrigger,
    entryPrice: state.entryPrice,
    invalidationPrice: state.invalidationPrice,
    stopPrice: state.stopPrice,
    targets: [...state.targets],
    estimatedRewardRisk: state.estimatedRewardRisk,
    primaryReason: state.primaryReason,
    reasons: [...state.reasons],
    warnings: [...state.warnings],
    whyNoEntry: [...state.whyNoEntry],
    whatToDoNext: [...state.whatToDoNext],
    marketContext: [...state.marketContext],
    dataHealth: {
      ...state.dataHealth,
      validationErrors: [...state.dataHealth.validationErrors],
      warnings: [...state.dataHealth.warnings],
    },
  };
}

export function formatSwingReport(report: SwingReport): string {
  const healthWarnings = dataHealthWarnings(report);
  const nextSteps = report.whatToDoNext.length > 0 ? report.whatToDoNext : ['No next-step guidance is available.'];

  return [
    `# ${report.instrument} Swing Report`,
    `Instrument: ${report.instrument} | H4 candle: ${report.sourceCandleTime ?? 'Not available'}`,
    `Daily Regime: ${titleCase(report.regime)}`,
    `H4 Structure: ${titleCase(report.h4Structure)}`,
    `Bias: ${titleCase(report.bias)}`,
    `Setup Status: ${titleCase(report.setupStatus)}`,
    `Setup Score: ${report.score ?? 'Not available'} | Grade: ${report.grade ?? 'Not available'}`,
    `Action: ${report.action.replaceAll('_', ' ')} (${report.direction}, ${report.isActionable ? 'actionable' : 'non-actionable'}). ${actionMessage(report)}`,
    `Entry Trigger: ${entryTrigger(report)}`,
    `Entry price: ${formatPrice(report.entryPrice)}`,
    `Invalidation: ${report.invalidationPrice === null ? 'Not calculated' : formatPrice(report.invalidationPrice)}`,
    `ATR-aware Stop: ${report.stopPrice === null ? 'Not calculated' : formatPrice(report.stopPrice)}`,
    `Targets: ${formatTargets(report.targets)}`,
    `Estimated R:R: ${report.estimatedRewardRisk === null ? 'Not available' : report.estimatedRewardRisk}`,
    `Reason: ${report.primaryReason}`,
    'What to do next:',
    ...nextSteps.map((step) => `- ${step}`),
    ...(healthWarnings.length > 0 ? ['Data-health warnings:', ...healthWarnings.map((warning) => `- ${warning}`)] : []),
  ].join('\n');
}

export function buildSwingReportOutput(state: DashboardState): SwingReportOutput {
  const report = buildSwingReport(state);
  return { report, text: formatSwingReport(report) };
}
