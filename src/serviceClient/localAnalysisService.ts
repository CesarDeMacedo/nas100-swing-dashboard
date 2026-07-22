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

export type LocalAnalysisServiceClient = {
  checkHealth: () => Promise<ServiceAvailability>;
  runManualFixture: () => Promise<ManualRunResult>;
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
  };
}

export const localAnalysisService = createLocalAnalysisServiceClient();
