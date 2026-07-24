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

const sse = (response: ServerResponse, event: string, payload: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

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
  const liveSubscribers = new Set<ServerResponse>();
  let liveAbort: AbortController | null = null;
  let liveOpenCandle: Awaited<ReturnType<NonNullable<typeof oandaProvider>['getH4Candles']>>['candles'][number] | null = null;
  let liveLastCompletedTime: string | null = null;
  let liveStopTimer: ReturnType<typeof setTimeout> | null = null;
  let liveReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let liveReconnectAttempt = 0;
  let liveRolloverRefresh: Promise<void> | null = null;
  let liveIsConnected = false;
  const reconnectDelays = [1000, 2000, 5000, 10000];
  const h4Window = (time: string) => Math.floor(Date.parse(time) / (4 * 60 * 60 * 1000));
  const liveBroadcast = (event: string, payload: unknown) => liveSubscribers.forEach((subscriber) => sse(subscriber, event, payload));
  const liveSnapshot = async () => {
    if (!oandaProvider || !oandaConfiguration.nas100Instrument || oandaConfiguration.state !== 'configured') throw new Error('unconfigured');
    const source = await oandaProvider.getH4Candles(oandaConfiguration.nas100Instrument, 2);
    liveOpenCandle = [...source.candles].reverse().find((candle) => !candle.isClosed) ?? null;
    liveLastCompletedTime = source.candles.filter((candle) => candle.isClosed).at(-1)?.time ?? null;
    return { provider: 'oanda-v20', environment: oandaConfiguration.environment, instrument: source.instrument, receivedAt: new Date().toISOString(), currentPrice: liveOpenCandle?.close ?? null, openCandle: liveOpenCandle, lastCompletedH4SourceTime: liveLastCompletedTime, streamState: 'live' as const };
  };
  const startLiveStream = async () => {
    if (liveAbort || !oandaProvider || !oandaConfiguration.nas100Instrument) return;
    const controller = new AbortController();
    liveAbort = controller;
    try {
      const snapshot = await liveSnapshot();
      liveBroadcast('connection', { state: 'connecting', receivedAt: snapshot.receivedAt });
      liveBroadcast('snapshot', snapshot);
      const response = await oandaProvider.openPricingStream(oandaConfiguration.nas100Instrument, controller.signal);
      liveReconnectAttempt = 0;
      liveIsConnected = true;
      liveBroadcast('connection', { state: 'live', receivedAt: new Date().toISOString() });
      const reader = response.body?.getReader();
      if (!reader) throw new Error('missing stream body');
      let pending = '';
      while (!controller.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += new TextDecoder().decode(chunk.value, { stream: true });
        const lines = pending.split('\n'); pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message: unknown = JSON.parse(line);
            if (!message || typeof message !== 'object') throw new Error('invalid');
            const record = message as Record<string, unknown>;
            if (record.type === 'PricingHeartbeat') { liveBroadcast('heartbeat', { receivedAt: typeof record.time === 'string' ? record.time : new Date().toISOString(), streamState: 'live' }); continue; }
            if (record.type !== 'PRICE' || !Array.isArray(record.bids) || !Array.isArray(record.asks)) continue;
            const bid = Number((record.bids[0] as Record<string, unknown> | undefined)?.price);
            const ask = Number((record.asks[0] as Record<string, unknown> | undefined)?.price);
            if (!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error('invalid price');
            const midpoint = (bid + ask) / 2;
            const receivedAt = typeof record.time === 'string' ? record.time : new Date().toISOString();
            if (liveOpenCandle && Number.isFinite(Date.parse(receivedAt)) && h4Window(receivedAt) > h4Window(liveOpenCandle.time) && !liveRolloverRefresh) {
              liveRolloverRefresh = liveSnapshot().then(() => undefined).catch(() => { liveBroadcast('error', { state: 'stale', message: 'OANDA live H4 rollover refresh is unavailable.', receivedAt: new Date().toISOString() }); }).finally(() => { liveRolloverRefresh = null; });
            }
            if (liveOpenCandle) liveOpenCandle = { ...liveOpenCandle, high: Math.max(liveOpenCandle.high, midpoint), low: Math.min(liveOpenCandle.low, midpoint), close: midpoint, isClosed: false };
            liveBroadcast('price', { currentPrice: midpoint, receivedAt, streamState: 'live' });
            if (liveOpenCandle) liveBroadcast('candle', { candle: liveOpenCandle, receivedAt });
          } catch { liveBroadcast('error', { state: 'stale', message: 'OANDA live observation received invalid stream data.', receivedAt: new Date().toISOString() }); }
        }
      }
      if (!controller.signal.aborted) { liveIsConnected = false; liveBroadcast('error', { state: 'reconnecting', message: 'OANDA live observation is reconnecting.', receivedAt: new Date().toISOString() }); scheduleReconnect(); }
    } catch { if (!controller.signal.aborted) { liveIsConnected = false; liveBroadcast('error', { state: 'reconnecting', message: 'OANDA live observation is reconnecting.', receivedAt: new Date().toISOString() }); scheduleReconnect(); } }
    finally { if (liveAbort === controller) liveAbort = null; }
  };
  const scheduleReconnect = () => {
    if (liveSubscribers.size === 0 || liveReconnectTimer) return;
    const delay = reconnectDelays[Math.min(liveReconnectAttempt, reconnectDelays.length - 1)]; liveReconnectAttempt += 1;
    liveReconnectTimer = setTimeout(() => { liveReconnectTimer = null; void startLiveStream(); }, delay);
  };
  const stopLiveStream = () => { liveAbort?.abort(); liveAbort = null; liveIsConnected = false; if (liveReconnectTimer) clearTimeout(liveReconnectTimer); liveReconnectTimer = null; liveReconnectAttempt = 0; liveOpenCandle = null; };
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

      if (request.method === 'GET' && url.pathname === '/providers/oanda/live-h4') {
        if (!oandaProvider || !oandaConfiguration.nas100Instrument || oandaConfiguration.state !== 'configured') {
          error(response, 409, 'OANDA_UNCONFIGURED', 'OANDA live observation requires configured credentials and an explicit instrument.');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        if (liveStopTimer) { clearTimeout(liveStopTimer); liveStopTimer = null; }
        liveSubscribers.add(response);
        if (liveIsConnected) {
          const receivedAt = new Date().toISOString();
          sse(response, 'connection', { state: 'live', receivedAt });
          sse(response, 'snapshot', {
            provider: 'oanda-v20' as const,
            environment: oandaConfiguration.environment,
            instrument: oandaConfiguration.nas100Instrument,
            receivedAt,
            currentPrice: liveOpenCandle?.close ?? null,
            openCandle: liveOpenCandle,
            lastCompletedH4SourceTime: liveLastCompletedTime,
            streamState: 'live' as const,
          });
        } else {
          void startLiveStream();
        }
        request.on('close', () => {
          liveSubscribers.delete(response);
          if (liveSubscribers.size === 0) liveStopTimer = setTimeout(stopLiveStream, 1_000);
        });
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
        stopLiveStream();
        liveSubscribers.clear();
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
