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

export type LocalAnalysisServiceClient = {
  checkHealth: () => Promise<ServiceAvailability>;
  runManualFixture: () => Promise<ManualRunResult>;
  listRecentRuns: (limit: number) => Promise<HistoryResult>;
  getRunByKey: (runKey: string) => Promise<RunDetailResult>;
};

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
  return typeof run.id === 'string' && typeof run.runKey === 'string' && typeof run.completedAt === 'string' && typeof run.status === 'string' && typeof run.source === 'string' && typeof run.persistedAt === 'string' && (typeof run.reportId === 'string' || run.reportId === null);
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
  };
}

export const localAnalysisService = createLocalAnalysisServiceClient();
