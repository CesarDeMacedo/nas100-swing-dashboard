import { randomUUID } from 'node:crypto';

import { buildDashboardState, type DashboardState } from '../application/buildDashboardState';
import { buildSwingReport, SWING_REPORT_VERSION, type SwingReport } from '../application/buildSwingReport';
import { classifyDailyRegime } from '../domain/dailyRegime';
import { calculateMarketLevels, type MarketLevelDirection, type MarketLevels } from '../domain/marketLevels';
import { buildTechnicalContext, mapCanonicalDailyRegimeToLegacy, type TechnicalContext } from '../domain/technicalContext';
import { AnalysisRepository, type StoredAnalysisRun } from '../persistence/analysisRepository';
import { OandaProvider } from '../providers/oanda/oandaProvider';
import type { OandaDailyCandleResult, OandaH4CandleResult } from '../providers/oanda/types';
import { AnalysisReportSchema, CandleDatasetSchema, type AnalysisReport, type Candle, type CandleDataset } from '../schemas';

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
  h4SourceCandleTime: string | null;
  dailySourceCandleTime: string | null;
  h4CompletedCandleCount: number;
  dailyCompletedCandleCount: number;
  h4ExcludedOpenCandleCount: number;
  dailyExcludedOpenCandleCount: number;
  h4DataStatus: 'available' | 'unavailable';
  dailyDataStatus: 'available' | 'unavailable';
  warnings: string[];
  message?: string;
};

type OandaReportInputs = {
  analysis: AnalysisReport;
  candles: CandleDataset;
  multiTimeframe: OandaMultiTimeframeData;
  technicalContext: TechnicalContext;
  marketLevels: MarketLevels;
};

export type OandaMultiTimeframeData = {
  provider: 'oanda-v20';
  instrument: string;
  h4Candles: Candle[];
  dailyCandles: Candle[];
  h4SourceCandleTime: string | null;
  dailySourceCandleTime: string | null;
  h4CompletedCandleCount: number;
  dailyCompletedCandleCount: number;
  h4ExcludedOpenCandleCount: number;
  dailyExcludedOpenCandleCount: number;
  h4DataStatus: 'available' | 'unavailable';
  dailyDataStatus: 'available' | 'unavailable';
  warnings: string[];
};

const unavailableCrossMarket = (instrument: 'US500' | 'US30' | 'RUSSELL_2000') => ({
  instrument,
  confirmation: 'UNAVAILABLE' as const,
  dataFreshness: 'MISSING' as const,
  notes: ['Live cross-market data is unavailable for this manual OANDA run.'],
});

const asDatasetCandles = (candles: readonly { time: string; open: number; high: number; low: number; close: number; volume: number | null; instrument: string; timeframe: 'H4' | 'D'; source: 'oanda-v20' }[]) =>
  candles.map((candle) => ({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, isClosed: true, ...(candle.volume === null ? {} : { volume: candle.volume }), source: candle.source, instrument: candle.instrument, timeframe: candle.timeframe }));

const emptyDailyResult = (source: OandaH4CandleResult): OandaDailyCandleResult => ({ provider: source.provider, environment: source.environment, instrument: source.instrument, timeframe: 'D', candles: [] });

export const buildOandaMultiTimeframeInputs = (h4Source: OandaH4CandleResult, dailySource: OandaDailyCandleResult, generatedAt = new Date().toISOString()): OandaReportInputs => {
  const completed = h4Source.candles.filter((candle) => candle.isClosed);
  const dailyCompleted = dailySource.candles.filter((candle) => candle.isClosed);
  const latest = completed.at(-1);
  const latestDaily = dailyCompleted.at(-1);
  if (!latest) throw new Error('No completed OANDA H4 candles are available.');
  const previous = completed.at(-2);
  const changePercent = previous ? ((latest.close - previous.close) / previous.close) * 100 : 0;
  const candles = CandleDatasetSchema.parse({
    schemaVersion: '1.0.0',
    datasetId: `oanda-v20:${h4Source.instrument}:H4:${latest.time}`,
    description: 'Completed OANDA v20 midpoint H4 candles for a manual read-only analysis run.',
    isSynthetic: false,
    timezone: 'America/Toronto',
    instrument: h4Source.instrument,
    timeframe: 'H4',
    generatedFor: 'manual-oanda-analysis',
    candles: asDatasetCandles(completed),
  });
  const h4TechnicalContext = buildTechnicalContext(candles.candles);
  const dailyRegime = classifyDailyRegime(asDatasetCandles(dailyCompleted), latestDaily?.close ?? null);
  const technicalContext: TechnicalContext = {
    ...h4TechnicalContext,
    dailyRegime,
    canonicalDailyRegime: dailyRegime.regime,
    legacyDailyRegime: mapCanonicalDailyRegimeToLegacy(dailyRegime.regime),
    status: h4TechnicalContext.status === 'unavailable' ? 'unavailable' : dailyRegime.status === 'available' && h4TechnicalContext.status === 'ready' ? 'ready' : 'partial',
    warnings: [...h4TechnicalContext.warnings, ...(dailyRegime.status === 'unavailable' ? ['Daily regime is unavailable from completed Daily candles'] : [])],
    missingInputs: [...new Set([...h4TechnicalContext.missingInputs, ...dailyRegime.missingInputs])],
  };
  const multiTimeframe: OandaMultiTimeframeData = {
    provider: h4Source.provider,
    instrument: h4Source.instrument,
    h4Candles: candles.candles,
    dailyCandles: asDatasetCandles(dailyCompleted),
    h4SourceCandleTime: latest.time,
    dailySourceCandleTime: latestDaily?.time ?? null,
    h4CompletedCandleCount: completed.length,
    dailyCompletedCandleCount: dailyCompleted.length,
    h4ExcludedOpenCandleCount: h4Source.candles.length - completed.length,
    dailyExcludedOpenCandleCount: dailySource.candles.length - dailyCompleted.length,
    h4DataStatus: technicalContext.h4Structure.status,
    dailyDataStatus: dailyRegime.status,
    warnings: [...technicalContext.warnings, ...(dailySource.candles.length === 0 ? ['No completed Daily candles are available.'] : [])],
  };
  const marketLevelDirection: MarketLevelDirection = technicalContext.canonicalH4Structure.startsWith('bullish') ? 'long' : technicalContext.canonicalH4Structure.startsWith('bearish') ? 'short' : 'none';
  const marketLevels = calculateMarketLevels(candles.candles, marketLevelDirection);
  const analysis = AnalysisReportSchema.parse({
    schemaVersion: '1.0.0',
    strategyVersion: OANDA_STRATEGY_VERSION,
    id: `oanda-v20:${h4Source.instrument}:${latest.time}`,
    generatedAt,
    completedCandleAt: latest.time,
    officialTimezone: 'America/Toronto',
    instrument: h4Source.instrument,
    displayName: h4Source.instrument,
    timeframe: 'H4',
    dataProvider: 'OANDA v20',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'COMPLETED',
    dailyRegime: technicalContext.legacyDailyRegime ?? 'NEUTRAL',
    h4Structure: technicalContext.legacyH4Structure ?? 'UNKNOWN',
    bias: 'NEUTRAL',
    status: 'DATA_UNAVAILABLE',
    action: 'WAIT',
    score: 0,
    grade: 'D',
    confidence: 0,
    currentPrice: latest.close,
    changePercent,
    supportZones: marketLevels.supportZones,
    resistanceZones: marketLevels.resistanceZones,
    ...(marketLevels.preferredEntryZone ? { preferredEntryZone: marketLevels.preferredEntryZone } : {}),
    ...(marketLevels.invalidationCandidate === null ? {} : { invalidation: marketLevels.invalidationCandidate }),
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
      warnings: ['Open OANDA candles are excluded from this manual analysis run.', ...marketLevels.warnings],
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
      instrument: h4Source.instrument,
      timeframe: 'H4',
      latestCandleTime: latest.time,
      candleCount: completed.length,
      synthetic: false,
    },
  });
  return { analysis, candles, multiTimeframe, technicalContext, marketLevels };
};

export const buildOandaReportInputs = (source: OandaH4CandleResult, generatedAt = new Date().toISOString()) =>
  buildOandaMultiTimeframeInputs(source, emptyDailyResult(source), generatedAt);

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

export const runManualOandaAnalysis = (repository: AnalysisRepository, source: OandaH4CandleResult, dailySource = emptyDailyResult(source)): OandaRunResult => {
  const startedAt = new Date().toISOString();
  const fetchedCandleCount = source.candles.length;
  const completedCandleCount = source.candles.filter((candle) => candle.isClosed).length;
  const excludedOpenCandleCount = fetchedCandleCount - completedCandleCount;
  const dailyCompletedCandleCount = dailySource.candles.filter((candle) => candle.isClosed).length;
  const base = {
    fetchedCandleCount, completedCandleCount, excludedOpenCandleCount, provider: source.provider, instrument: source.instrument,
    h4SourceCandleTime: source.candles.filter((candle) => candle.isClosed).at(-1)?.time ?? null,
    dailySourceCandleTime: dailySource.candles.filter((candle) => candle.isClosed).at(-1)?.time ?? null,
    h4CompletedCandleCount: completedCandleCount, dailyCompletedCandleCount,
    h4ExcludedOpenCandleCount: excludedOpenCandleCount, dailyExcludedOpenCandleCount: dailySource.candles.length - dailyCompletedCandleCount,
    h4DataStatus: completedCandleCount === 0 ? 'unavailable' : 'available', dailyDataStatus: dailyCompletedCandleCount === 0 ? 'unavailable' : 'available',
    warnings: [] as string[],
  } as const;

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
    const { analysis, candles, multiTimeframe, technicalContext, marketLevels } = buildOandaMultiTimeframeInputs(source, dailySource, startedAt);
    const { preferredEntryZone: _preferredEntryZone, invalidation: _invalidation, ...analysisWithoutMarketLevels } = analysis;
    const baseReport = {
      ...buildSwingReport(safetyConstrainedState(buildDashboardState({ ...analysisWithoutMarketLevels, supportZones: [], resistanceZones: [] }, candles, technicalContext))),
      dailySourceCandleTime: multiTimeframe.dailySourceCandleTime,
      supportZones: analysis.supportZones,
      resistanceZones: analysis.resistanceZones,
      preferredEntryZone: analysis.preferredEntryZone ?? null,
      invalidationCandidate: analysis.invalidation ?? null,
      levelWarnings: marketLevels.warnings,
    };
    const displayAnalysis = AnalysisReportSchema.parse({
      ...analysis,
      action: baseReport.action,
      score: baseReport.score ?? analysis.score,
      grade: baseReport.grade ?? analysis.grade,
      reason: baseReport.primaryReason,
      supportZones: analysis.supportZones,
      resistanceZones: analysis.resistanceZones,
      ...(analysis.preferredEntryZone ? { preferredEntryZone: analysis.preferredEntryZone } : {}),
      ...(analysis.invalidation ? { invalidation: analysis.invalidation } : {}),
      setupScoreBreakdown: { ...analysis.setupScoreBreakdown, total: baseReport.score ?? analysis.score },
    });
    const report = {
      ...baseReport,
      displaySnapshot: {
        provider: 'oanda-v20' as const,
        environment: source.environment,
        instrument: source.instrument,
        timeframe: 'H4' as const,
        candles: candles.candles,
        analysis: displayAnalysis,
        h4SourceCandleTime: multiTimeframe.h4SourceCandleTime,
        dailySourceCandleTime: multiTimeframe.dailySourceCandleTime,
        warnings: [...baseReport.warnings, ...marketLevels.warnings],
      },
    };
    const runKey = oandaRunKey(report, analysis.strategyVersion);
    const existing = repository.getRunByKey(runKey);
    if (existing?.report) return { ...base, ...multiTimeframe, outcome: 'already_exists', run: existing.run, report: existing.report };
    const run = repository.saveCompletedRun({
      id: randomUUID(), runKey, startedAt, completedAt: new Date().toISOString(), status: 'COMPLETED', source: 'manual',
    }, report);
    return { ...base, ...multiTimeframe, outcome: 'created', run, report };
  } catch {
    const runKey = ['oanda-v20', source.instrument, 'H4', 'failed', OANDA_STRATEGY_VERSION, startedAt].join(':');
    const run = repository.saveNonCompletedRun({
      id: randomUUID(), runKey, startedAt, completedAt: new Date().toISOString(), status: 'FAILED', source: 'manual',
      errorMessage: 'Manual OANDA analysis could not be completed.',
    });
    return { ...base, outcome: 'failed', run, report: null, message: run.errorMessage ?? undefined };
  }
};

export const executeManualOandaAnalysis = async (repository: AnalysisRepository, provider: OandaProvider, instrument: string) => {
  const [source, dailySource] = await Promise.all([provider.getH4Candles(instrument, 250), provider.getDailyCandles(instrument, 250)]);
  return runManualOandaAnalysis(repository, source, dailySource);
};
