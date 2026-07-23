import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { AnalysisRepository, defaultPersistencePath, type StoredAnalysisRun } from '../persistence/analysisRepository';
import { oandaConfigurationStatus, parseOandaConfiguration } from '../providers/oanda/config';
import { OandaProvider, findNas100CandidatesFromInstruments } from '../providers/oanda/oandaProvider';
import { runSyntheticFixtureAnalysis } from './fixtureRun';
import { executeManualOandaAnalysis, runManualOandaAnalysis } from './oandaRun';
import { FixtureScheduler, type SchedulerStatus } from './scheduler/fixtureScheduler';
import { parseSchedulerEnabled, parseSchedulerProvider } from './scheduler/torontoSchedule';

export const LOCAL_SERVICE_HOST = '127.0.0.1';
export const DEFAULT_SERVICE_PORT = 4310;
const LOCAL_VITE_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

export const loadProjectEnvironmentForServiceCli = (envPath = resolve(process.cwd(), '.env')) => {
  try {
    process.loadEnvFile(envPath);
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return;
    throw cause;
  }
};

type LocalServiceOptions = {
  databasePath?: string;
  port?: number;
  schedulerEnabled?: boolean;
  schedulerIntervalMs?: number;
  schedulerProvider?: 'fixture' | 'oanda';
  oandaEnvironment?: NodeJS.ProcessEnv;
  oandaFetch?: typeof fetch;
};

type ServiceHealth = {
  service: 'nas100-swing-dashboard';
  status: 'healthy';
  host: typeof LOCAL_SERVICE_HOST;
  port: number;
  persistence: { available: boolean; path: string };
  scheduler: SchedulerStatus;
};

type LocalService = {
  start: () => Promise<ServiceHealth>;
  stop: () => Promise<void>;
  schedulerStatus: () => SchedulerStatus;
};

const setCorsHeaders = (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  if (origin && LOCAL_VITE_ORIGINS.has(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
  }
};

const json = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
};

const error = (response: ServerResponse, statusCode: number, code: string, message: string) =>
  json(response, statusCode, { error: { code, message } });

const summary = (run: StoredAnalysisRun, report: NonNullable<ReturnType<typeof runSyntheticFixtureAnalysis>['report']>, alreadyExists: boolean) => ({
  id: run.id,
  runKey: run.runKey,
  action: report.action,
  direction: report.direction,
  score: report.score,
  grade: report.grade,
  isActionable: report.isActionable,
  sourceCandleTime: report.sourceCandleTime,
  persistedAt: run.persistedAt,
  alreadyExists,
});

const parseLimit = (value: string | null) => {
  if (value === null) return 20;
  if (!/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 ? limit : null;
};

const parseOandaCandleCount = (value: string | null) => {
  if (value === null) return 250;
  if (!/^\d+$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= 5000 ? count : null;
};

const resolvePort = (value: string | undefined) => {
  if (value === undefined) return DEFAULT_SERVICE_PORT;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_SERVICE_PORT;
};

export function createLocalService(options: LocalServiceOptions = {}): LocalService {
  const databasePath = options.databasePath ?? process.env.NAS100_DASHBOARD_DB_PATH ?? defaultPersistencePath();
  const configuredPort = options.port ?? resolvePort(process.env.NAS100_DASHBOARD_PORT);
  const schedulerEnabled = options.schedulerEnabled ?? parseSchedulerEnabled(process.env.NAS100_DASHBOARD_SCHEDULER_ENABLED);
  const schedulerProvider = options.schedulerProvider ?? parseSchedulerProvider(process.env.NAS100_DASHBOARD_SCHEDULER_PROVIDER);
  const oandaConfiguration = parseOandaConfiguration(options.oandaEnvironment);
  const oandaProvider = oandaConfiguration.state === 'configured' ? new OandaProvider(oandaConfiguration, options.oandaFetch) : null;
  let repository: AnalysisRepository | null = null;
  let server: Server | null = null;
  let boundPort = configuredPort;
  const scheduler = new FixtureScheduler({
    enabled: schedulerEnabled,
    intervalMs: options.schedulerIntervalMs,
    provider: schedulerProvider,
    run: async () => {
      if (!repository) throw new Error('Local persistence is unavailable.');
      if (schedulerProvider === 'oanda') {
        if (!oandaProvider || !oandaConfiguration.nas100Instrument) return { outcome: 'failed', runKey: 'oanda:unconfigured', message: 'OANDA scheduler requires configured credentials and an explicit instrument.' };
        try {
          const result = await executeManualOandaAnalysis(repository, oandaProvider, oandaConfiguration.nas100Instrument);
          return { outcome: result.outcome, runKey: result.run.runKey, message: result.message };
        } catch {
          return { outcome: 'failed', runKey: 'oanda:request-failed', message: 'Scheduled OANDA analysis could not be completed.' };
        }
      }
      const result = runSyntheticFixtureAnalysis(repository);
      return { outcome: result.outcome, runKey: result.run.runKey, message: result.message };
    },
  });

  const health = (): ServiceHealth => ({
    service: 'nas100-swing-dashboard',
    status: 'healthy',
    host: LOCAL_SERVICE_HOST,
    port: boundPort,
    persistence: { available: repository !== null, path: databasePath },
    scheduler: scheduler.status(),
  });

  const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', `http://${LOCAL_SERVICE_HOST}`);
    setCorsHeaders(request, response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      response.end();
      return;
    }
    const activeRepository = repository;
    if (!activeRepository) {
      error(response, 503, 'PERSISTENCE_UNAVAILABLE', 'Local persistence is unavailable.');
      return;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, health());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/providers/oanda/status') {
        json(response, 200, oandaConfigurationStatus(oandaConfiguration));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/providers/oanda/verify') {
        if (!oandaProvider) {
          const message = oandaConfiguration.state === 'configured' ? 'OANDA provider is not configured.' : oandaConfiguration.message;
          error(response, 409, oandaConfiguration.state === 'invalid' ? 'OANDA_CONFIGURATION_INVALID' : 'OANDA_UNCONFIGURED', message);
          return;
        }
        try {
          const instruments = await oandaProvider.getAccountInstruments();
          const candidates = findNas100CandidatesFromInstruments(instruments);
          const configuredInstrument = oandaConfiguration.nas100Instrument;
          json(response, 200, {
            providerAvailable: true,
            environment: oandaConfiguration.environment,
            candidates,
            configuredInstrument: configuredInstrument !== null,
            configuredInstrumentSupported: configuredInstrument !== null && instruments.some((instrument) => instrument.name === configuredInstrument),
          });
        } catch {
          error(response, 502, 'OANDA_VERIFY_FAILED', 'OANDA provider verification failed.');
        }
        return;
      }

      if (request.method === 'GET' && url.pathname === '/providers/oanda/candles') {
        if (!oandaProvider || !oandaConfiguration.nas100Instrument) {
          error(response, 409, 'OANDA_INSTRUMENT_UNCONFIGURED', 'Configure OANDA_ACCOUNT_ID, OANDA_API_TOKEN, and OANDA_NAS100_INSTRUMENT before requesting candles.');
          return;
        }
        const count = parseOandaCandleCount(url.searchParams.get('count'));
        if (count === null) {
          error(response, 400, 'INVALID_CANDLE_COUNT', 'count must be an integer between 1 and 5000.');
          return;
        }
        try {
          json(response, 200, await oandaProvider.getH4Candles(oandaConfiguration.nas100Instrument, count));
        } catch {
          error(response, 502, 'OANDA_CANDLES_FAILED', 'OANDA candle retrieval failed.');
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/runs/manual-oanda') {
        if (!oandaProvider || !oandaConfiguration.nas100Instrument) {
          error(response, 409, 'OANDA_INSTRUMENT_UNCONFIGURED', 'Configure OANDA_ACCOUNT_ID, OANDA_API_TOKEN, and OANDA_NAS100_INSTRUMENT before requesting a manual OANDA run.');
          return;
        }
        try {
          const result = await executeManualOandaAnalysis(activeRepository, oandaProvider, oandaConfiguration.nas100Instrument);
          if (!result.report) {
            error(response, 409, result.outcome === 'failed' ? 'OANDA_MANUAL_RUN_FAILED' : 'OANDA_NO_COMPLETED_CANDLES', result.message ?? 'Manual OANDA analysis could not be completed.');
            return;
          }
          json(response, result.outcome === 'created' ? 201 : 200, {
            id: result.run.id,
            runKey: result.run.runKey,
            provider: result.provider,
            instrument: result.instrument,
            sourceCandleTime: result.report.sourceCandleTime,
            h4SourceCandleTime: result.h4SourceCandleTime,
            dailySourceCandleTime: result.dailySourceCandleTime,
            fetchedCandleCount: result.fetchedCandleCount,
            completedCandleCount: result.completedCandleCount,
            excludedOpenCandleCount: result.excludedOpenCandleCount,
            h4CompletedCandleCount: result.h4CompletedCandleCount,
            dailyCompletedCandleCount: result.dailyCompletedCandleCount,
            h4ExcludedOpenCandleCount: result.h4ExcludedOpenCandleCount,
            dailyExcludedOpenCandleCount: result.dailyExcludedOpenCandleCount,
            dailyRegimeStatus: result.dailyDataStatus,
            h4StructureStatus: result.h4DataStatus,
            action: result.report.action,
            direction: result.report.direction,
            score: result.report.score,
            grade: result.report.grade,
            isActionable: result.report.isActionable,
            alreadyExists: result.outcome === 'already_exists',
          });
        } catch {
          error(response, 502, 'OANDA_MANUAL_RUN_FAILED', 'Manual OANDA analysis could not be completed.');
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/runs/manual-fixture') {
        const result = runSyntheticFixtureAnalysis(activeRepository);
        if (!result.report) {
          error(response, 409, 'FIXTURE_RUN_BLOCKED', result.message ?? 'Synthetic fixture analysis could not produce a completed report.');
          return;
        }
        json(response, result.outcome === 'created' ? 201 : 200, summary(result.run, result.report, result.outcome === 'already_exists'));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/runs') {
        const limit = parseLimit(url.searchParams.get('limit'));
        if (limit === null) {
          error(response, 400, 'INVALID_LIMIT', 'limit must be an integer between 1 and 100.');
          return;
        }
        json(response, 200, { runs: activeRepository.listHistory(limit) });
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/runs/')) {
        const runKey = decodeURIComponent(url.pathname.slice('/runs/'.length));
        if (!runKey) {
          error(response, 404, 'RUN_NOT_FOUND', 'No persisted run matches this key.');
          return;
        }
        const item = activeRepository.getRunByKey(runKey);
        if (!item) {
          error(response, 404, 'RUN_NOT_FOUND', 'No persisted run matches this key.');
          return;
        }
        json(response, 200, item);
        return;
      }

      error(response, 404, 'NOT_FOUND', 'The requested endpoint does not exist.');
    } catch (cause) {
      error(
        response,
        500,
        'SERVICE_ERROR',
        cause instanceof Error ? cause.message : 'The local service could not complete the request.',
      );
    }
  };

  return {
    start: () =>
      new Promise((resolve, reject) => {
        if (server) {
          resolve(health());
          return;
        }
        try {
          repository = new AnalysisRepository(databasePath);
          server = createServer(requestHandler);
          server.once('error', reject);
          server.listen(configuredPort, LOCAL_SERVICE_HOST, () => {
            const address = server?.address();
          if (address && typeof address !== 'string') boundPort = address.port;
          server?.off('error', reject);
          scheduler.start();
          resolve(health());
          });
        } catch (cause) {
          reject(cause);
        }
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        scheduler.stop();
        const activeServer = server;
        server = null;
        if (!activeServer) {
          repository?.close();
          repository = null;
          resolve();
          return;
        }
        activeServer.close((cause) => {
          repository?.close();
          repository = null;
          cause ? reject(cause) : resolve();
        });
      }),
    schedulerStatus: () => scheduler.status(),
  };
}

if (process.argv[1]?.endsWith('server.ts')) {
  loadProjectEnvironmentForServiceCli();
  const service = createLocalService();
  service.start().then(({ host, port }) => {
    process.stdout.write(`NAS100 local service listening on http://${host}:${port}\n`);
  });
}
