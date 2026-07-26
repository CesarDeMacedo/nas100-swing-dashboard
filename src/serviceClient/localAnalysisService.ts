export const DEFAULT_LOCAL_ANALYSIS_SERVICE_URL = 'http://127.0.0.1:4310';

export type ServiceAvailability =
  | { kind: 'available' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'malformed_response'; message: string };

export type ManualRunSummary = {
  id: string;
  runKey: string;
  action: string;
  direction: string;
  score: number | null;
  grade: string | null;
  isActionable: boolean;
  sourceCandleTime: string | null;
  persistedAt: string;
  alreadyExists: boolean;
};

export type ManualRunResult =
  | { kind: 'succeeded'; run: ManualRunSummary }
  | { kind: 'already_exists'; run: ManualRunSummary }
  | { kind: 'failed'; message: string }
  | { kind: 'malformed_response'; message: string };

export type PersistedRun = {
  id: string;
  runKey: string;
  completedAt: string;
  status: string;
  source: string;
  persistedAt: string;
  reportId: string | null;
  /** null means default/unversioned strategy parameters, or a strategy that has since been
   * deleted — distinct from "no strategy concept exists" (see `withStrategyLabel` server-side).
   * Optional so existing fixtures/mocks that predate this field aren't forced to supply it. */
  strategyName?: string | null;
  strategyVersion?: number | null;
};

export type AnalysisHistorySummary = {
  action: string;
  direction: string;
  score: number | null;
  grade: string | null;
  sourceCandleTime: string | null;
  isActionable: boolean;
};

export type AnalysisHistoryItem = { run: PersistedRun; report: AnalysisHistorySummary | null };

export type ImmutableReportDetail = {
  action: string;
  direction: string;
  score: number | null;
  grade: string | null;
  primaryReason: string;
  entryTrigger: string | null;
  stopPrice: number | null;
  targets: number[];
  estimatedRewardRisk: number | null;
  sourceCandleTime: string | null;
  isActionable: boolean;
  displaySnapshot?: SavedOandaDisplaySnapshot;
};

export type SavedOandaDisplaySnapshot = {
  provider: 'oanda-v20';
  environment: 'practice' | 'live';
  instrument: string;
  timeframe: 'H4';
  candles: unknown;
  analysis: unknown;
  h4SourceCandleTime: string | null;
  dailySourceCandleTime: string | null;
  warnings: string[];
};

export type HistoryResult =
  | { kind: 'succeeded'; runs: AnalysisHistoryItem[] }
  | { kind: 'empty'; runs: [] }
  | { kind: 'failed'; message: string }
  | { kind: 'malformed_response'; message: string };

export type RunDetailResult =
  | { kind: 'succeeded'; item: AnalysisHistoryItem; report: ImmutableReportDetail }
  | { kind: 'failed'; message: string }
  | { kind: 'malformed_response'; message: string };

export type OandaProviderStatus =
  | { kind: 'configured'; environment: 'practice' | 'live'; configuredInstrument: boolean }
  | { kind: 'unconfigured'; environment: 'practice' | 'live'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable'; message: string };

export type LocalAnalysisServiceClient = {
  checkHealth: () => Promise<ServiceAvailability>;
  checkOandaStatus?: () => Promise<OandaProviderStatus>;
  runManualFixture: () => Promise<ManualRunResult>;
  runManualOanda?: () => Promise<ManualRunResult>;
  listRecentRuns: (limit: number) => Promise<HistoryResult>;
  getRunByKey: (runKey: string) => Promise<RunDetailResult>;
  getOandaCandles?: (count?: number) => Promise<OandaPreviewResult>;
  subscribeOandaLiveH4?: (listener: (event: OandaLiveEvent) => void) => () => void;
  listStrategies?: (status?: 'draft' | 'active' | 'archived') => Promise<StrategyListResult>;
  getStrategy?: (strategyId: string) => Promise<StrategyDetailResult>;
  createStrategy?: (name: string, parameters: StrategyParameters) => Promise<StrategyMutationResult>;
  createStrategyVersion?: (strategyId: string, name: string, parameters: StrategyParameters) => Promise<StrategyMutationResult>;
  activateStrategyVersion?: (strategyId: string, version: number) => Promise<StrategyMutationResult>;
  listBacktests?: (strategyConfigId?: string) => Promise<BacktestListResult>;
  getBacktest?: (id: string) => Promise<BacktestReportResult>;
};

export type OandaPreviewCandle = { time: string; open: number; high: number; low: number; close: number; isClosed: boolean; instrument: string; timeframe: 'H4'; source: 'oanda-v20' };
export type OandaPreviewData = { provider: 'oanda-v20'; environment: 'practice' | 'live'; instrument: string; timeframe: 'H4'; candles: OandaPreviewCandle[] };
export type OandaPreviewResult = { kind: 'succeeded'; data: OandaPreviewData } | { kind: 'failed' | 'malformed_response'; message: string };

export type OandaLiveEvent = { type: 'connection' | 'snapshot' | 'price' | 'candle' | 'heartbeat' | 'error'; payload: Record<string, unknown> };

export type StrategyParameters = {
  minRewardRisk: number;
  premiumScoreThreshold: number;
  atrLocationTolerance: number;
  atrTriggerBuffer: number;
  atrStopBuffer: number;
  atrInvalidationBuffer: number;
  confirmationClosePositionThreshold: number;
  crossMarketPrimaryInstruments: ('us500' | 'us30' | 'russell2000')[];
  setupScoreWeights: { trend: number; structure: number; momentum: number; location: number; crossMarket: number; eventRisk: number; rewardRisk: number; patienceReadiness: number };
  eventRisk: { blockingWindowMinutes: number; minImpact: 'High' | 'Medium' | 'Low' };
};

export type StrategyConfig = {
  id: string;
  strategyId: string;
  version: number;
  name: string;
  status: 'draft' | 'active' | 'archived';
  parameters: StrategyParameters;
  createdAt: string;
};

export type StrategyListResult = { kind: 'succeeded'; strategies: StrategyConfig[] } | { kind: 'failed'; message: string } | { kind: 'malformed_response'; message: string };
export type StrategyDetailResult = { kind: 'succeeded'; strategyId: string; versions: StrategyConfig[] } | { kind: 'failed'; message: string } | { kind: 'malformed_response'; message: string };
export type StrategyMutationResult = { kind: 'succeeded'; strategy: StrategyConfig } | { kind: 'validation_failed'; message: string } | { kind: 'failed'; message: string } | { kind: 'malformed_response'; message: string };

export type BacktestRunSummary = {
  id: string;
  strategyConfigId: string;
  instrument: string;
  rangeStart: string;
  rangeEnd: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  frameCount: number | null;
  errorMessage: string | null;
};

export type BacktestSignal = {
  id: string;
  backtestRunId: string;
  decisionCandleTime: string;
  direction: 'long' | 'short';
  entryPrice: number;
  invalidationPrice: number;
  stopPrice: number;
  targetPrice: number;
  estimatedRewardRisk: number;
  score: number | null;
  grade: string | null;
  localHourOfDay: number;
  localWeekday: number;
  status: 'pending' | 'filled' | 'cancelled' | 'win' | 'loss' | 'unresolved';
  filledAt: string | null;
  resolvedAt: string | null;
  outcomeRR: number | null;
};

export type BacktestReport = {
  run: BacktestRunSummary;
  summary: {
    signalCount: number;
    filledCount: number;
    cancelledCount: number;
    winCount: number;
    lossCount: number;
    unresolvedCount: number;
    winRate: number | null;
    avgRewardRisk: number;
    avgWinRewardRisk: number | null;
    expectancy: number;
  };
  breakdownByHour: { hour: number; signalCount: number; winRate: number | null }[];
  breakdownByWeekday: { weekday: number; signalCount: number; winRate: number | null }[];
  signals: BacktestSignal[];
};

export type BacktestListResult = { kind: 'succeeded'; backtests: BacktestRunSummary[] } | { kind: 'failed'; message: string } | { kind: 'malformed_response'; message: string };
export type BacktestReportResult = { kind: 'succeeded'; report: BacktestReport } | { kind: 'not_found' } | { kind: 'failed'; message: string } | { kind: 'malformed_response'; message: string };

const serviceUrl = () =>
  (import.meta.env.VITE_NAS100_SERVICE_URL || DEFAULT_LOCAL_ANALYSIS_SERVICE_URL).replace(/\/$/, '');

const invalidResponse = (message: string) => ({ kind: 'malformed_response' as const, message });

const isManualRunSummary = (value: unknown): value is ManualRunSummary => {
  if (!value || typeof value !== 'object') return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.id === 'string' &&
    typeof run.runKey === 'string' &&
    typeof run.action === 'string' &&
    typeof run.direction === 'string' &&
    (typeof run.score === 'number' || run.score === null) &&
    (typeof run.grade === 'string' || run.grade === null) &&
    typeof run.isActionable === 'boolean' &&
    (typeof run.sourceCandleTime === 'string' || run.sourceCandleTime === null) &&
    typeof run.persistedAt === 'string' &&
    typeof run.alreadyExists === 'boolean'
  );
};

const isPersistedRun = (value: unknown): value is PersistedRun => {
  if (!value || typeof value !== 'object') return false;
  const run = value as Record<string, unknown>;
  return typeof run.id === 'string' && typeof run.runKey === 'string' && typeof run.completedAt === 'string' && typeof run.status === 'string' && typeof run.source === 'string' && typeof run.persistedAt === 'string' && (typeof run.reportId === 'string' || run.reportId === null) && (run.strategyName === undefined || typeof run.strategyName === 'string' || run.strategyName === null) && (run.strategyVersion === undefined || typeof run.strategyVersion === 'number' || run.strategyVersion === null);
};

const isSavedOandaDisplaySnapshot = (value: unknown): value is SavedOandaDisplaySnapshot => {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.provider === 'oanda-v20' && (snapshot.environment === 'practice' || snapshot.environment === 'live') && typeof snapshot.instrument === 'string' && snapshot.timeframe === 'H4' && Array.isArray(snapshot.candles) && snapshot.analysis !== null && typeof snapshot.analysis === 'object' && (typeof snapshot.h4SourceCandleTime === 'string' || snapshot.h4SourceCandleTime === null) && (typeof snapshot.dailySourceCandleTime === 'string' || snapshot.dailySourceCandleTime === null) && Array.isArray(snapshot.warnings) && snapshot.warnings.every((warning) => typeof warning === 'string');
};

const isImmutableReportDetail = (value: unknown): value is ImmutableReportDetail => {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  return typeof report.action === 'string' && typeof report.direction === 'string' && (typeof report.score === 'number' || report.score === null) && (typeof report.grade === 'string' || report.grade === null) && typeof report.primaryReason === 'string' && (typeof report.entryTrigger === 'string' || report.entryTrigger === null) && (typeof report.stopPrice === 'number' || report.stopPrice === null) && Array.isArray(report.targets) && report.targets.every((target) => typeof target === 'number') && (typeof report.estimatedRewardRisk === 'number' || report.estimatedRewardRisk === null) && (typeof report.sourceCandleTime === 'string' || report.sourceCandleTime === null) && typeof report.isActionable === 'boolean' && (report.displaySnapshot === undefined || isSavedOandaDisplaySnapshot(report.displaySnapshot));
};

const isAnalysisHistorySummary = (value: unknown): value is AnalysisHistorySummary => {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  return typeof report.action === 'string' && typeof report.direction === 'string' && (typeof report.score === 'number' || report.score === null) && (typeof report.grade === 'string' || report.grade === null) && (typeof report.sourceCandleTime === 'string' || report.sourceCandleTime === null) && typeof report.isActionable === 'boolean';
};
const isStrategyConfig = (value: unknown): value is StrategyConfig => {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  return (
    typeof config.id === 'string' &&
    typeof config.strategyId === 'string' &&
    typeof config.version === 'number' &&
    typeof config.name === 'string' &&
    (config.status === 'draft' || config.status === 'active' || config.status === 'archived') &&
    typeof config.createdAt === 'string' &&
    config.parameters !== null &&
    typeof config.parameters === 'object'
  );
};

const isBacktestRunSummary = (value: unknown): value is BacktestRunSummary => {
  if (!value || typeof value !== 'object') return false;
  const run = value as Record<string, unknown>;
  return typeof run.id === 'string' && typeof run.strategyConfigId === 'string' && typeof run.instrument === 'string' && (run.status === 'running' || run.status === 'completed' || run.status === 'failed');
};

const isBacktestReport = (value: unknown): value is BacktestReport => {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  return isBacktestRunSummary(report.run) && report.summary !== null && typeof report.summary === 'object' && Array.isArray(report.breakdownByHour) && Array.isArray(report.breakdownByWeekday) && Array.isArray(report.signals);
};

const isOandaPreviewData = (value: unknown): value is OandaPreviewData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.provider === 'oanda-v20' && (data.environment === 'practice' || data.environment === 'live') && typeof data.instrument === 'string' && data.timeframe === 'H4' && Array.isArray(data.candles) && data.candles.every((candle) => {
    if (!candle || typeof candle !== 'object') return false;
    const item = candle as Record<string, unknown>;
    return typeof item.time === 'string' && [item.open, item.high, item.low, item.close].every((price) => typeof price === 'number' && Number.isFinite(price)) && typeof item.isClosed === 'boolean' && item.instrument === data.instrument && item.timeframe === 'H4' && item.source === 'oanda-v20';
  });
};

const responseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const serviceErrorMessage = (payload: unknown, fallback: string) => {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return fallback;
};

export function createLocalAnalysisServiceClient(baseUrl = serviceUrl()): LocalAnalysisServiceClient {
  const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);

  return {
    async checkHealth() {
      try {
        const response = await request('/health');
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'unavailable', message: serviceErrorMessage(payload, 'Local service is unavailable.') };
        if (!payload || typeof payload !== 'object') return invalidResponse('Local service returned an invalid health response.');
        const health = payload as { status?: unknown; persistence?: { available?: unknown } };
        if (health.status !== 'healthy' || health.persistence?.available !== true) return invalidResponse('Local service returned an invalid health response.');
        return { kind: 'available' };
      } catch {
        return { kind: 'unavailable', message: 'Start the local analysis service to enable manual persistence.' };
      }
    },
    async checkOandaStatus() {
      try {
        const response = await request('/providers/oanda/status');
        const payload = await responseJson(response);
        if (!response.ok || !payload || typeof payload !== 'object') return { kind: 'unavailable', message: 'OANDA configuration status is unavailable.' };
        const status = payload as { state?: unknown; environment?: unknown; configuredInstrument?: unknown; message?: unknown };
        if (status.state === 'configured' && (status.environment === 'practice' || status.environment === 'live')) {
          return { kind: 'configured', environment: status.environment, configuredInstrument: status.configuredInstrument === true };
        }
        if (status.state === 'unconfigured' && (status.environment === 'practice' || status.environment === 'live')) {
          return { kind: 'unconfigured', environment: status.environment, message: typeof status.message === 'string' ? status.message : 'OANDA credentials are not configured.' };
        }
        if (status.state === 'invalid') {
          return { kind: 'invalid', message: typeof status.message === 'string' ? status.message : 'OANDA configuration is invalid.' };
        }
        return { kind: 'unavailable', message: 'OANDA configuration status is unavailable.' };
      } catch {
        return { kind: 'unavailable', message: 'OANDA configuration status is unavailable.' };
      }
    },
    async runManualFixture() {
      try {
        const response = await request('/runs/manual-fixture', { method: 'POST' });
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Manual analysis could not be saved.') };
        if (!isManualRunSummary(payload)) return invalidResponse('Local service returned an invalid manual-run response.');
        return payload.alreadyExists ? { kind: 'already_exists', run: payload } : { kind: 'succeeded', run: payload };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to enable manual persistence.' };
      }
    },
    async runManualOanda() {
      try {
        const response = await request('/runs/manual-oanda', { method: 'POST' });
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Manual OANDA analysis could not be saved.') };
        if (!isManualRunSummary(payload)) return invalidResponse('Local service returned an invalid manual-run response.');
        return payload.alreadyExists ? { kind: 'already_exists', run: payload } : { kind: 'succeeded', run: payload };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to enable manual OANDA runs.' };
      }
    },
    async listRecentRuns(limit) {
      try {
        const response = await request(`/runs?limit=${encodeURIComponent(String(limit))}`);
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not load local analysis history.') };
        if (!payload || typeof payload !== 'object' || !('runs' in payload) || !Array.isArray(payload.runs)) return invalidResponse('Local service returned an invalid history response.');
        const runs = payload.runs;
        if (!runs.every((item) => item && typeof item === 'object' && isPersistedRun((item as { run?: unknown }).run) && ((item as { report?: unknown }).report === null || isAnalysisHistorySummary((item as { report?: unknown }).report)))) return invalidResponse('Local service returned an invalid history response.');
        const items = runs as AnalysisHistoryItem[];
        return items.length === 0 ? { kind: 'empty', runs: [] } : { kind: 'succeeded', runs: items };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to view analysis history.' };
      }
    },
    async getRunByKey(runKey) {
      try {
        const response = await request(`/runs/${encodeURIComponent(runKey)}`);
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not load the stored analysis report.') };
        if (!payload || typeof payload !== 'object') return invalidResponse('Local service returned an invalid analysis-detail response.');
        const item = payload as { run?: unknown; report?: unknown };
        if (!isPersistedRun(item.run) || !isImmutableReportDetail(item.report)) return invalidResponse('Local service returned an invalid analysis-detail response.');
        return { kind: 'succeeded', item: { run: item.run, report: item.report }, report: item.report };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to view analysis history.' };
      }
    },
    async getOandaCandles(count = 250) {
      try {
        const response = await request(`/providers/oanda/candles?count=${encodeURIComponent(String(count))}`);
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'OANDA chart preview data could not be loaded.') };
        return isOandaPreviewData(payload) ? { kind: 'succeeded', data: payload } : invalidResponse('Local service returned invalid OANDA candle data.');
      } catch { return { kind: 'failed', message: 'Local service is unavailable.' }; }
    },
    subscribeOandaLiveH4(listener) {
      const source = new EventSource(`${baseUrl}/providers/oanda/live-h4`);
      const events: OandaLiveEvent['type'][] = ['connection', 'snapshot', 'price', 'candle', 'heartbeat', 'error'];
      for (const type of events) source.addEventListener(type, (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data);
          if (payload && typeof payload === 'object') listener({ type, payload: payload as Record<string, unknown> });
          else listener({ type: 'error', payload: { state: 'offline', message: 'Malformed live observation event.' } });
        } catch {
          listener({ type: 'error', payload: { state: 'offline', message: 'Malformed live observation event.' } });
        }
      });
      source.onerror = () => listener({ type: 'error', payload: { state: 'offline', message: 'Local live observation connection is unavailable.' } });
      return () => source.close();
    },
    async listStrategies(status) {
      try {
        const response = await request(status ? `/strategies?status=${encodeURIComponent(status)}` : '/strategies');
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not load strategies.') };
        if (!payload || typeof payload !== 'object' || !('strategies' in payload) || !Array.isArray(payload.strategies) || !payload.strategies.every(isStrategyConfig)) return invalidResponse('Local service returned an invalid strategies response.');
        return { kind: 'succeeded', strategies: payload.strategies };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to manage strategies.' };
      }
    },
    async getStrategy(strategyId) {
      try {
        const response = await request(`/strategies/${encodeURIComponent(strategyId)}`);
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not load this strategy.') };
        if (!payload || typeof payload !== 'object' || typeof (payload as { strategyId?: unknown }).strategyId !== 'string' || !Array.isArray((payload as { versions?: unknown }).versions) || !(payload as { versions: unknown[] }).versions.every(isStrategyConfig)) return invalidResponse('Local service returned an invalid strategy response.');
        return { kind: 'succeeded', strategyId: (payload as { strategyId: string }).strategyId, versions: (payload as { versions: StrategyConfig[] }).versions };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to manage strategies.' };
      }
    },
    async createStrategy(name, parameters) {
      try {
        const response = await request('/strategies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, parameters }) });
        const payload = await responseJson(response);
        if (response.status === 422) return { kind: 'validation_failed', message: serviceErrorMessage(payload, 'Strategy parameters are invalid.') };
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not create the strategy.') };
        if (!isStrategyConfig(payload)) return invalidResponse('Local service returned an invalid strategy response.');
        return { kind: 'succeeded', strategy: payload };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to manage strategies.' };
      }
    },
    async createStrategyVersion(strategyId, name, parameters) {
      try {
        const response = await request(`/strategies/${encodeURIComponent(strategyId)}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, parameters }) });
        const payload = await responseJson(response);
        if (response.status === 422) return { kind: 'validation_failed', message: serviceErrorMessage(payload, 'Strategy parameters are invalid.') };
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not create the new strategy version.') };
        if (!isStrategyConfig(payload)) return invalidResponse('Local service returned an invalid strategy response.');
        return { kind: 'succeeded', strategy: payload };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to manage strategies.' };
      }
    },
    async activateStrategyVersion(strategyId, version) {
      try {
        const response = await request(`/strategies/${encodeURIComponent(strategyId)}/versions/${version}/activate`, { method: 'POST' });
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not activate this strategy version.') };
        if (!isStrategyConfig(payload)) return invalidResponse('Local service returned an invalid strategy response.');
        return { kind: 'succeeded', strategy: payload };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to manage strategies.' };
      }
    },
    async listBacktests(strategyConfigId) {
      try {
        const response = await request(strategyConfigId ? `/backtests?strategyConfigId=${encodeURIComponent(strategyConfigId)}` : '/backtests');
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not load backtest results.') };
        if (!payload || typeof payload !== 'object' || !('backtests' in payload) || !Array.isArray(payload.backtests) || !payload.backtests.every(isBacktestRunSummary)) return invalidResponse('Local service returned an invalid backtests response.');
        return { kind: 'succeeded', backtests: payload.backtests };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to view backtest results.' };
      }
    },
    async getBacktest(id) {
      try {
        const response = await request(`/backtests/${encodeURIComponent(id)}`);
        if (response.status === 404) return { kind: 'not_found' };
        const payload = await responseJson(response);
        if (!response.ok) return { kind: 'failed', message: serviceErrorMessage(payload, 'Could not load this backtest report.') };
        if (!isBacktestReport(payload)) return invalidResponse('Local service returned an invalid backtest report.');
        return { kind: 'succeeded', report: payload };
      } catch {
        return { kind: 'failed', message: 'Start the local analysis service to view backtest results.' };
      }
    },
  };
}

export const localAnalysisService = createLocalAnalysisServiceClient();
