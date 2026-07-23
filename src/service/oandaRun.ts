import { randomUUID } from 'node:crypto';

import { buildDashboardState, type DashboardState } from '../application/buildDashboardState';
import { buildSwingReport, SWING_REPORT_VERSION, type SwingReport } from '../application/buildSwingReport';
import { AnalysisRepository, type StoredAnalysisRun } from '../persistence/analysisRepository';
import type { OandaH4CandleResult } from '../providers/oanda/types';
import { AnalysisReportSchema, CandleDatasetSchema, type AnalysisReport, type CandleDataset } from '../schemas';

export const OANDA_STRATEGY_VERSION = '1.0.0';

export type OandaRunResult = {
  outcome: 'created' | 'already_exists' | 'blocked' | 'failed';
  run: StoredAnalysisRun;
  report: SwingReport | null;
  fetchedCandleCount: number;
  completedCandleCount: number;
  excludedOpenCandleCount: number;
  provider: 'oanda-v20';
  instrument: string;
  message?: string;
};

type OandaReportInputs = {
  analysis: AnalysisReport;
  candles: CandleDataset;
};

const unavailableCrossMarket = (instrument: 'US500' | 'US30' | 'RUSSELL_2000') => ({
  instrument,
  confirmation: 'UNAVAILABLE' as const,
  dataFreshness: 'MISSING' as const,
  notes: ['Live cross-market data is unavailable for this manual OANDA run.'],
});

export const buildOandaReportInputs = (source: OandaH4CandleResult, generatedAt = new Date().toISOString()): OandaReportInputs => {
  const completed = source.candles.filter((candle) => candle.isClosed);
  const latest = completed.at(-1);
  if (!latest) throw new Error('No completed OANDA H4 candles are available.');
  const previous = completed.at(-2);
  const changePercent = previous ? ((latest.close - previous.close) / previous.close) * 100 : 0;
  const candles = CandleDatasetSchema.parse({
    schemaVersion: '1.0.0',
    datasetId: `oanda-v20:${source.instrument}:H4:${latest.time}`,
    description: 'Completed OANDA v20 midpoint H4 candles for a manual read-only analysis run.',
    isSynthetic: false,
    timezone: 'America/Toronto',
    instrument: source.instrument,
    timeframe: 'H4',
    generatedFor: 'manual-oanda-analysis',
    candles: completed.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      isClosed: true,
      ...(candle.volume === null ? {} : { volume: candle.volume }),
      source: candle.source,
      instrument: candle.instrument,
      timeframe: candle.timeframe,
    })),
  });
  const analysis = AnalysisReportSchema.parse({
    schemaVersion: '1.0.0',
    strategyVersion: OANDA_STRATEGY_VERSION,
    id: `oanda-v20:${source.instrument}:${latest.time}`,
    generatedAt,
    completedCandleAt: latest.time,
    officialTimezone: 'America/Toronto',
    instrument: source.instrument,
    displayName: source.instrument,
    timeframe: 'H4',
    dataProvider: 'OANDA v20',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'COMPLETED',
    dailyRegime: 'NEUTRAL',
    h4Structure: 'UNKNOWN',
    bias: 'NEUTRAL',
    status: 'DATA_UNAVAILABLE',
    action: 'WAIT',
    score: 0,
    grade: 'D',
    confidence: 0,
    currentPrice: latest.close,
    changePercent,
    supportZones: [],
    resistanceZones: [],
    targets: [],
    whyNoEntry: [
      'Cross-market confirmation is unavailable.',
      'Event-risk data is unavailable.',
    ],
    whatToDoNext: ['Wait for integrated cross-market and event-risk data before considering an entry.'],
    marketContext: ['OANDA midpoint H4 data is available for manual read-only analysis.', 'Cross-market and event-risk context are unavailable.'],
    indicators: {},
    crossMarket: {
      us500: unavailableCrossMarket('US500'),
      us30: unavailableCrossMarket('US30'),
      russell2000: unavailableCrossMarket('RUSSELL_2000'),
      confirmationStatus: 'UNAVAILABLE',
      dataFreshness: 'MISSING',
      notes: ['No live cross-market confirmation is integrated for this phase.'],
    },
    eventRisk: [{
      status: 'UNAVAILABLE',
      severity: 'NONE',
      eventName: 'Live event-risk feed unavailable',
      eventTime: latest.time,
      source: 'unavailable',
      freshness: 'MISSING',
      blocksEntry: false,
      notes: ['No live macro or event-risk feed is integrated for this phase.'],
    }],
    dataHealth: {
      status: 'HEALTHY',
      providerStatus: 'HEALTHY',
      lastSuccessfulUpdate: latest.time,
      latestExpectedCandleTime: latest.time,
      latestAvailableCandleTime: latest.time,
      latestCandleClosed: true,
      staleAfterMinutes: 250,
      validationErrors: [],
      warnings: ['Open OANDA candles are excluded from this manual analysis run.'],
    },
    setupScoreBreakdown: {
      trend: 0,
      structure: 0,
      momentum: 0,
      location: 0,
      crossMarket: 0,
      eventRisk: 0,
      rewardRisk: 0,
      patienceFilter: 0,
      total: 0,
    },
    candlesReference: {
      datasetId: candles.datasetId,
      instrument: source.instrument,
      timeframe: 'H4',
      latestCandleTime: latest.time,
      candleCount: completed.length,
      synthetic: false,
    },
  });
  return { analysis, candles };
};

const safetyConstrainedState = (state: DashboardState): DashboardState => ({
  ...state,
  action: state.action === 'BUY' || state.action === 'SELL' ? 'WAIT' : state.action,
  direction: state.action === 'BUY' || state.action === 'SELL' ? 'none' : state.direction,
  isActionable: false,
  entryTrigger: null,
  entryPrice: null,
  invalidationPrice: null,
  stopPrice: null,
  targets: [],
  estimatedRewardRisk: null,
  primaryReason: 'Cross-market confirmation and event-risk data are unavailable.',
  reasons: ['OANDA H4 candles are completed.', 'Cross-market confirmation is unavailable.', 'Event-risk data is unavailable.'],
  warnings: [...state.warnings, 'This manual OANDA run cannot authorize an entry without cross-market and event-risk data.'],
});

export const oandaRunKey = (report: SwingReport, strategyVersion: string) =>
  ['oanda-v20', report.instrument, report.timeframe, report.sourceCandleTime, report.reportVersion, strategyVersion].join(':');

const incompleteRunKey = (instrument: string) => ['oanda-v20', instrument, 'H4', 'unavailable', 'blocked', OANDA_STRATEGY_VERSION].join(':');

export const runManualOandaAnalysis = (repository: AnalysisRepository, source: OandaH4CandleResult): OandaRunResult => {
  const startedAt = new Date().toISOString();
  const fetchedCandleCount = source.candles.length;
  const completedCandleCount = source.candles.filter((candle) => candle.isClosed).length;
  const excludedOpenCandleCount = fetchedCandleCount - completedCandleCount;
  const base = { fetchedCandleCount, completedCandleCount, excludedOpenCandleCount, provider: source.provider, instrument: source.instrument } as const;

  if (completedCandleCount === 0) {
    const runKey = incompleteRunKey(source.instrument);
    const existing = repository.getRunByKey(runKey);
    if (existing) return { ...base, outcome: 'already_exists', run: existing.run, report: existing.report, message: 'No completed OANDA H4 candles are available.' };
    const run = repository.saveNonCompletedRun({
      id: randomUUID(), runKey, startedAt, completedAt: new Date().toISOString(), status: 'BLOCKED', source: 'manual',
      errorMessage: 'No completed OANDA H4 candles are available.',
    });
    return { ...base, outcome: 'blocked', run, report: null, message: run.errorMessage ?? undefined };
  }

  try {
    const { analysis, candles } = buildOandaReportInputs(source, startedAt);
    const report = buildSwingReport(safetyConstrainedState(buildDashboardState(analysis, candles)));
    const runKey = oandaRunKey(report, analysis.strategyVersion);
    const existing = repository.getRunByKey(runKey);
    if (existing?.report) return { ...base, outcome: 'already_exists', run: existing.run, report: existing.report };
    const run = repository.saveCompletedRun({
      id: randomUUID(), runKey, startedAt, completedAt: new Date().toISOString(), status: 'COMPLETED', source: 'manual',
    }, report);
    return { ...base, outcome: 'created', run, report };
  } catch {
    const runKey = ['oanda-v20', source.instrument, 'H4', 'failed', OANDA_STRATEGY_VERSION, startedAt].join(':');
    const run = repository.saveNonCompletedRun({
      id: randomUUID(), runKey, startedAt, completedAt: new Date().toISOString(), status: 'FAILED', source: 'manual',
      errorMessage: 'Manual OANDA analysis could not be completed.',
    });
    return { ...base, outcome: 'failed', run, report: null, message: run.errorMessage ?? undefined };
  }
};
