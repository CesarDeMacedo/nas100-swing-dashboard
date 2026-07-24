import { randomUUID } from 'node:crypto';

import { buildDashboardState, type DashboardState } from '../application/buildDashboardState';
import { buildSwingReport, SWING_REPORT_VERSION, type SwingReport } from '../application/buildSwingReport';
import { classifyDailyRegime } from '../domain/dailyRegime';
import { calculateMarketLevels, type MarketLevelDirection, type MarketLevels } from '../domain/marketLevels';
import { buildTechnicalContext, mapCanonicalDailyRegimeToLegacy, type TechnicalContext } from '../domain/technicalContext';
import { AnalysisRepository, type AnalysisRunTrigger, type StoredAnalysisRun } from '../persistence/analysisRepository';
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

/** OANDA v20 symbols for the three cross-market confirmation instruments (ADR-014), confirmed
 * present on the account via a one-off account-instrument check — no separate provider needed. */
export const CROSS_MARKET_OANDA_SYMBOLS = { us500: 'SPX500_USD', us30: 'US30_USD', russell2000: 'US2000_USD' } as const;
type CrossMarketKey = keyof typeof CROSS_MARKET_OANDA_SYMBOLS;
const CROSS_MARKET_LABELS: Record<CrossMarketKey, 'US500' | 'US30' | 'RUSSELL_2000'> = { us500: 'US500', us30: 'US30', russell2000: 'RUSSELL_2000' };

export type CrossMarketH4Results = Partial<Record<CrossMarketKey, OandaH4CandleResult>>;

/** Resolves to `undefined` on rejection *or* on timeout, unifying both into the same
 * degradation path — OandaClient has no timeout of its own, so a hung request would
 * otherwise never settle and block whatever awaits it. */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(undefined); },
    );
  });

/** Best-effort, single-attempt fetch of the three cross-market H4 series. Failure or timeout
 * for an individual instrument degrades that instrument to UNAVAILABLE below rather than
 * failing or blocking the whole NAS100 run — this data is supplementary, not safety-critical,
 * and does not participate in the scheduler's window-retry logic (src/service/scheduledOandaRun.ts). */
export const fetchCrossMarketH4 = async (provider: OandaProvider, count = 250, timeoutMs = 8000): Promise<CrossMarketH4Results> => {
  const entries = await Promise.all(
    (Object.entries(CROSS_MARKET_OANDA_SYMBOLS) as [CrossMarketKey, string][]).map(async ([key, symbol]) => {
      const result = await withTimeout(provider.getH4Candles(symbol, count), timeoutMs);
      return [key, result] as const;
    }),
  );
  return Object.fromEntries(entries.filter(([, result]) => result !== undefined)) as CrossMarketH4Results;
};

const directionOf = (structure: string): 'bullish' | 'bearish' | 'neutral' =>
  structure.startsWith('bullish') ? 'bullish' : structure.startsWith('bearish') ? 'bearish' : 'neutral';

const classifyCrossMarketInstrument = (key: CrossMarketKey, nas100Direction: 'bullish' | 'bearish' | 'neutral', source: OandaH4CandleResult | undefined) => {
  const instrument = CROSS_MARKET_LABELS[key];
  const completed = source?.candles.filter((candle) => candle.isClosed) ?? [];
  const latest = completed.at(-1);
  if (!latest) return { instrument, confirmation: 'UNAVAILABLE' as const, dataFreshness: 'MISSING' as const, notes: [`Live ${instrument} H4 data is unavailable for this run.`] };
  const context = buildTechnicalContext(asDatasetCandles(completed));
  const crossDirection = directionOf(context.canonicalH4Structure);
  const confirmation = nas100Direction === 'neutral' || crossDirection === 'neutral' ? 'NEUTRAL' as const : nas100Direction === crossDirection ? 'CONFIRMING' as const : 'CONTRADICTING' as const;
  const previous = completed.at(-2);
  return {
    instrument,
    confirmation,
    dataFreshness: 'FRESH' as const,
    lastPrice: latest.close,
    ...(previous ? { changePercent: ((latest.close - previous.close) / previous.close) * 100 } : {}),
    completedCandleAt: latest.time,
    notes: [`${instrument} H4 structure: ${context.canonicalH4Structure}.`],
  };
};

const buildCrossMarketSnapshot = (nas100Direction: 'bullish' | 'bearish' | 'neutral', crossMarketH4: CrossMarketH4Results) => {
  const us500 = classifyCrossMarketInstrument('us500', nas100Direction, crossMarketH4.us500);
  const us30 = classifyCrossMarketInstrument('us30', nas100Direction, crossMarketH4.us30);
  const russell2000 = classifyCrossMarketInstrument('russell2000', nas100Direction, crossMarketH4.russell2000);
  const available = [us500.confirmation, us30.confirmation, russell2000.confirmation].filter((value) => value !== 'UNAVAILABLE');
  const confirmationStatus =
    available.length === 0 ? ('UNAVAILABLE' as const)
    : available.every((value) => value === 'CONFIRMING') ? ('CONFIRMING' as const)
    : available.some((value) => value === 'CONTRADICTING') && available.some((value) => value === 'CONFIRMING') ? ('MIXED' as const)
    : available.some((value) => value === 'CONTRADICTING') ? ('CONTRADICTING' as const)
    : ('MIXED' as const);
  return {
    us500, us30, russell2000,
    confirmationStatus,
    dataFreshness: available.length > 0 ? ('FRESH' as const) : ('MISSING' as const),
    notes: available.length > 0 ? ["Cross-market confirmation reflects each index's own completed H4 structure relative to NAS100."] : ['Live cross-market data is unavailable for this manual OANDA run.'],
  };
};

const asDatasetCandles = (candles: readonly { time: string; open: number; high: number; low: number; close: number; volume: number | null; instrument: string; timeframe: 'H4' | 'D'; source: 'oanda-v20' }[]) =>
  candles.map((candle) => ({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, isClosed: true, ...(candle.volume === null ? {} : { volume: candle.volume }), source: candle.source, instrument: candle.instrument, timeframe: candle.timeframe }));

const emptyDailyResult = (source: OandaH4CandleResult): OandaDailyCandleResult => ({ provider: source.provider, environment: source.environment, instrument: source.instrument, timeframe: 'D', candles: [] });

export const buildOandaMultiTimeframeInputs = (h4Source: OandaH4CandleResult, dailySource: OandaDailyCandleResult, generatedAt = new Date().toISOString(), crossMarketH4: CrossMarketH4Results = {}): OandaReportInputs => {
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
  const crossMarket = buildCrossMarketSnapshot(directionOf(technicalContext.canonicalH4Structure), crossMarketH4);
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
      'Event-risk data is unavailable.',
    ],
    whatToDoNext: ['Wait for integrated event-risk data before considering an entry.'],
    marketContext: ['OANDA midpoint H4 data is available for manual read-only analysis.', 'Event-risk context is unavailable.'],
    indicators: {},
    crossMarket,
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

export const buildOandaReportInputs = (source: OandaH4CandleResult, generatedAt = new Date().toISOString(), crossMarketH4: CrossMarketH4Results = {}) =>
  buildOandaMultiTimeframeInputs(source, emptyDailyResult(source), generatedAt, crossMarketH4);

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
  primaryReason: 'Event-risk data is unavailable.',
  reasons: ['OANDA H4 candles are completed.', 'Event-risk data is unavailable.'],
  warnings: [...state.warnings, 'This manual OANDA run cannot authorize an entry without event-risk data.'],
});

export const oandaRunKey = (report: SwingReport, strategyVersion: string) =>
  ['oanda-v20', report.instrument, report.timeframe, report.sourceCandleTime, report.reportVersion, strategyVersion].join(':');

const incompleteRunKey = (instrument: string) => ['oanda-v20', instrument, 'H4', 'unavailable', 'blocked', OANDA_STRATEGY_VERSION].join(':');

export const runManualOandaAnalysis = (repository: AnalysisRepository, source: OandaH4CandleResult, dailySource = emptyDailyResult(source), triggeredBy: AnalysisRunTrigger = 'user', crossMarketH4: CrossMarketH4Results = {}): OandaRunResult => {
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
      id: randomUUID(), runKey, startedAt, completedAt: new Date().toISOString(), status: 'BLOCKED', source: 'manual', triggeredBy,
      errorMessage: 'No completed OANDA H4 candles are available.',
    });
    return { ...base, outcome: 'blocked', run, report: null, message: run.errorMessage ?? undefined };
  }

  try {
    const { analysis, candles, multiTimeframe, technicalContext, marketLevels } = buildOandaMultiTimeframeInputs(source, dailySource, startedAt, crossMarketH4);
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
      id: randomUUID(), runKey, startedAt, completedAt: new Date().toISOString(), status: 'COMPLETED', source: 'manual', triggeredBy,
    }, report);
    return { ...base, ...multiTimeframe, outcome: 'created', run, report };
  } catch (cause) {
    const runKey = ['oanda-v20', source.instrument, 'H4', 'failed', OANDA_STRATEGY_VERSION, startedAt].join(':');
    const run = repository.saveNonCompletedRun({
      id: randomUUID(), runKey, startedAt, completedAt: new Date().toISOString(), status: 'FAILED', source: 'manual', triggeredBy,
      errorMessage: cause instanceof Error ? cause.message : 'Manual OANDA analysis could not be completed.',
    });
    return { ...base, outcome: 'failed', run, report: null, message: run.errorMessage ?? undefined };
  }
};

export const executeManualOandaAnalysis = async (repository: AnalysisRepository, provider: OandaProvider, instrument: string, triggeredBy: AnalysisRunTrigger = 'user') => {
  const [source, dailySource, crossMarketH4] = await Promise.all([provider.getH4Candles(instrument, 250), provider.getDailyCandles(instrument, 250), fetchCrossMarketH4(provider)]);
  return runManualOandaAnalysis(repository, source, dailySource, triggeredBy, crossMarketH4);
};
