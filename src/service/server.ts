import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { ZodError } from 'zod';

import {
  AnalysisRepository,
  defaultPersistencePath,
  type StoredAnalysisRun,
  type StoredMeanReversionEvaluation,
} from '../persistence/analysisRepository';
import { resolveStrategyParameters } from '../domain/strategyParameters';
import { oandaConfigurationStatus, parseOandaConfiguration } from '../providers/oanda/config';
import {
  OandaProvider,
  findNas100CandidatesFromInstruments,
} from '../providers/oanda/oandaProvider';
import { StrategyConfigInputSchema, type StrategyStatus } from '../schemas/strategyConfig';
import { runSyntheticFixtureAnalysis } from './fixtureRun';
import { LiveH4Stream } from './liveH4Stream';
import { evaluateStrategyConfigLive, resolveMrAccountSize } from './meanReversionRun';
import { executeManualOandaAnalysis, runManualOandaAnalysis } from './oandaRun';
import { executeScheduledOandaAnalysis } from './scheduledOandaRun';
import {
  FixtureScheduler,
  type SchedulerRunResult,
  type SchedulerStatus,
} from './scheduler/fixtureScheduler';
import { notifyMeanReversionEvaluation, notifySchedulerOutcome } from './schedulerNotifications';
import { parseSchedulerEnabled, parseSchedulerProvider } from './scheduler/torontoSchedule';
import {
  BacktestRepository,
  defaultBacktestDatabasePath,
} from '../../scripts/backtest/backtestRepository';
import { buildBacktestReport } from '../../scripts/backtest/backtestReport';

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
  backtestDatabasePath?: string;
  port?: number;
  schedulerEnabled?: boolean;
  schedulerIntervalMs?: number;
  schedulerProvider?: 'fixture' | 'oanda';
  /** Test-only override for the scheduler's clock, so a specific Toronto slot can be evaluated deterministically instead of waiting for the real one. */
  schedulerNow?: () => Date;
  oandaEnvironment?: NodeJS.ProcessEnv;
  oandaFetch?: typeof fetch;
  liveReconnectDelaysMs?: number[];
  scheduledOandaRetryDelaysMs?: number[];
  /** Test-only override for the scheduler's outcome notification, so tests never trigger a
   * real OS notification. Defaults to the real node-notifier-backed notifySchedulerOutcome. */
  notifySchedulerOutcome?: (result: SchedulerRunResult) => void;
  /** Test-only override for the scheduler's mean-reversion evaluation notification (ENTER/EXIT
   * only). Defaults to the real node-notifier-backed notifyMeanReversionEvaluation. */
  notifyMeanReversionEvaluation?: (evaluation: StoredMeanReversionEvaluation) => void;
  /** Test-only override for the MR risk-per-trade account size normally read from
   * NAS100_MR_ACCOUNT_SIZE (see resolveMrAccountSize). */
  mrAccountSize?: number | null;
  /** Test-only override for the A2 event-risk (Forex Factory) fetch, so tests never make a
   * real network call to that feed. Defaults to the global fetch. */
  eventRiskFetch?: typeof fetch;
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

/** Denormalizes the strategy name+version onto a persisted run's response, so the Analysis
 * History UI can show "which strategy produced this run" without a second client-side fetch —
 * the same spirit as `report_json` already embedding everything a report view needs. A run
 * with no `strategyConfigId` (the default-parameters case) or one whose strategy has since
 * been deleted just omits the fields. */
const withStrategyLabel = <T extends { run: StoredAnalysisRun }>(
  repository: AnalysisRepository,
  item: T,
) => {
  const strategyConfigId = item.run.strategyConfigId;
  const strategy = strategyConfigId ? repository.getStrategyConfigById(strategyConfigId) : null;
  return {
    ...item,
    run: {
      ...item.run,
      strategyName: strategy?.name ?? null,
      strategyVersion: strategy?.version ?? null,
    },
  };
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return undefined;
  return JSON.parse(raw);
};

const summary = (
  run: StoredAnalysisRun,
  report: NonNullable<ReturnType<typeof runSyntheticFixtureAnalysis>['report']>,
  alreadyExists: boolean,
) => ({
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

/** Best-effort, after-the-fact evaluation of every ACTIVE rsi2/double7 strategy config, run on
 * the same scheduler slots as the main pipeline (no new slots — see docs/MR_LIVE_INTEGRATION_PLAN.md).
 * Independent of the main pipeline run: fetches its own completed daily/H4 candles (cached per
 * timeframe so multiple MR strategies sharing a timeframe don't refetch), persists every
 * evaluation, and returns them for the caller to notify on. Never touches
 * safetyConstrainedState/the Patience Filter/minRewardRisk — this is a parallel, analysis-only
 * surface with no order placement.
 *
 * Deduplicated per completed bar: a daily reference bar stays the latest completed bar across
 * up to six consecutive scheduler slots, so without this check the same ENTER/EXIT would be
 * re-persisted and re-notified on every slot until the next daily close. If the latest stored
 * evaluation for a config already covers the same referenceCandleTime, the config is skipped —
 * nothing new happened, so nothing is persisted and (because only returned evaluations are
 * notified) no repeat OS notification fires. */
export const evaluateActiveMeanReversionStrategies = async (
  repository: AnalysisRepository,
  provider: OandaProvider,
  instrument: string,
  accountSize: number | null,
): Promise<StoredMeanReversionEvaluation[]> => {
  const activeMrStrategies = repository.listStrategies('active').filter((strategy) => {
    const kind = resolveStrategyParameters(strategy.parameters).strategyKind;
    return kind === 'rsi2' || kind === 'double7';
  });
  if (activeMrStrategies.length === 0) return [];

  const candlesByTimeframe: {
    D?: Awaited<ReturnType<OandaProvider['getDailyCandles']>>['candles'];
    H4?: Awaited<ReturnType<OandaProvider['getH4Candles']>>['candles'];
  } = {};
  const evaluations: StoredMeanReversionEvaluation[] = [];
  for (const strategy of activeMrStrategies) {
    const timeframe = resolveStrategyParameters(strategy.parameters).meanReversion.timeframe;
    // 500, not the SMA-filter minimum of ~200+1: the signal is derived by replaying the engine
    // over this window, and the replay must include any still-open position's entry bar. With a
    // 200-bar warmup, 500 bars leave ~300 replayable bars against a backtested worst hold of 24.
    if (timeframe === 'D' && !candlesByTimeframe.D)
      candlesByTimeframe.D = (await provider.getDailyCandles(instrument, 500)).candles;
    if (timeframe === 'H4' && !candlesByTimeframe.H4)
      candlesByTimeframe.H4 = (await provider.getH4Candles(instrument, 500)).candles;
    const evaluation = evaluateStrategyConfigLive(strategy, instrument, candlesByTimeframe, {
      accountSize,
    });
    if (!evaluation) continue;
    const latest = repository.listMeanReversionEvaluations(strategy.id, 1)[0];
    if (latest && latest.referenceCandleTime === evaluation.referenceCandleTime) continue;
    evaluations.push(repository.saveMeanReversionEvaluation({ id: randomUUID(), ...evaluation }));
  }
  return evaluations;
};

export function createLocalService(options: LocalServiceOptions = {}): LocalService {
  const databasePath =
    options.databasePath ?? process.env.NAS100_DASHBOARD_DB_PATH ?? defaultPersistencePath();
  const backtestDatabasePath =
    options.backtestDatabasePath ??
    process.env.NAS100_BACKTEST_DB_PATH ??
    defaultBacktestDatabasePath();
  const configuredPort = options.port ?? resolvePort(process.env.NAS100_DASHBOARD_PORT);
  const schedulerEnabled =
    options.schedulerEnabled ??
    parseSchedulerEnabled(process.env.NAS100_DASHBOARD_SCHEDULER_ENABLED);
  const schedulerProvider =
    options.schedulerProvider ??
    parseSchedulerProvider(process.env.NAS100_DASHBOARD_SCHEDULER_PROVIDER);
  const oandaConfiguration = parseOandaConfiguration(options.oandaEnvironment);
  const oandaProvider =
    oandaConfiguration.state === 'configured'
      ? new OandaProvider(oandaConfiguration, options.oandaFetch)
      : null;
  const configuredOanda =
    oandaConfiguration.state === 'configured' && oandaConfiguration.nas100Instrument
      ? {
          instrument: oandaConfiguration.nas100Instrument,
          environment: oandaConfiguration.environment,
        }
      : null;
  const liveStream =
    oandaProvider && configuredOanda
      ? new LiveH4Stream({
          instrument: configuredOanda.instrument,
          environment: configuredOanda.environment,
          fetchSnapshot: (count) => oandaProvider.getH4Candles(configuredOanda.instrument, count),
          openPricingStream: (signal) =>
            oandaProvider.openPricingStream(configuredOanda.instrument, signal),
          reconnectDelaysMs: options.liveReconnectDelaysMs,
        })
      : null;
  let repository: AnalysisRepository | null = null;
  let backtestRepository: BacktestRepository | null = null;
  let server: Server | null = null;
  let boundPort = configuredPort;
  const scheduler = new FixtureScheduler({
    enabled: schedulerEnabled,
    intervalMs: options.schedulerIntervalMs,
    now: options.schedulerNow,
    notify: options.notifySchedulerOutcome ?? notifySchedulerOutcome,
    provider: schedulerProvider,
    run: async () => {
      if (!repository) throw new Error('Local persistence is unavailable.');
      let result: SchedulerRunResult;
      if (schedulerProvider === 'oanda') {
        if (!oandaProvider || !oandaConfiguration.nas100Instrument) {
          result = {
            outcome: 'failed',
            runKey: 'oanda:unconfigured',
            message: 'OANDA scheduler requires configured credentials and an explicit instrument.',
          };
        } else {
          const oandaResult = await executeScheduledOandaAnalysis(
            repository,
            oandaProvider,
            oandaConfiguration.nas100Instrument,
            {
              retryDelaysMs: options.scheduledOandaRetryDelaysMs,
              now: options.schedulerNow,
              eventRiskFetcher: options.eventRiskFetch,
            },
          );
          result = {
            outcome: oandaResult.outcome,
            runKey: oandaResult.run.runKey,
            message: oandaResult.message,
          };
        }
      } else {
        const fixtureResult = runSyntheticFixtureAnalysis(repository, undefined, 'scheduler');
        result = {
          outcome: fixtureResult.outcome,
          runKey: fixtureResult.run.runKey,
          message: fixtureResult.message,
        };
      }

      // Independent of the branch above: MR evaluation only needs real OANDA candles, not
      // whichever provider drives the main pipeline slot. Best-effort — a failure here must
      // never turn an otherwise-successful scheduler slot into a 'failed' outcome.
      if (oandaProvider && oandaConfiguration.nas100Instrument) {
        try {
          const accountSize = options.mrAccountSize ?? resolveMrAccountSize();
          const evaluations = await evaluateActiveMeanReversionStrategies(
            repository,
            oandaProvider,
            oandaConfiguration.nas100Instrument,
            accountSize,
          );
          const notify = options.notifyMeanReversionEvaluation ?? notifyMeanReversionEvaluation;
          for (const evaluation of evaluations) notify(evaluation);
        } catch (cause) {
          console.error('[mean-reversion] scheduler evaluation failed:', cause);
        }
      }

      return result;
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
        if (!liveStream) {
          error(
            response,
            409,
            'OANDA_UNCONFIGURED',
            'OANDA live observation requires configured credentials and an explicit instrument.',
          );
          return;
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        // writeHead() alone buffers the status line/headers in Node — they only reach the
        // socket with the next write(). Without an immediate flush, a subscriber joining while
        // the stream is disconnected (backoff, no broadcast imminent) never sees the response
        // resolve until some future broadcast happens to write something, which can be seconds
        // away or, in the worst case (last attempt exhausted, no further reconnect), never.
        response.flushHeaders();
        liveStream.subscribe(response);
        request.on('close', () => liveStream.unsubscribe(response));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/providers/oanda/verify') {
        if (!oandaProvider) {
          const message =
            oandaConfiguration.state === 'configured'
              ? 'OANDA provider is not configured.'
              : oandaConfiguration.message;
          error(
            response,
            409,
            oandaConfiguration.state === 'invalid'
              ? 'OANDA_CONFIGURATION_INVALID'
              : 'OANDA_UNCONFIGURED',
            message,
          );
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
            configuredInstrumentSupported:
              configuredInstrument !== null &&
              instruments.some((instrument) => instrument.name === configuredInstrument),
          });
        } catch {
          error(response, 502, 'OANDA_VERIFY_FAILED', 'OANDA provider verification failed.');
        }
        return;
      }

      if (request.method === 'GET' && url.pathname === '/providers/oanda/candles') {
        if (!oandaProvider || !oandaConfiguration.nas100Instrument) {
          error(
            response,
            409,
            'OANDA_INSTRUMENT_UNCONFIGURED',
            'Configure OANDA_ACCOUNT_ID, OANDA_API_TOKEN, and OANDA_NAS100_INSTRUMENT before requesting candles.',
          );
          return;
        }
        const count = parseOandaCandleCount(url.searchParams.get('count'));
        if (count === null) {
          error(
            response,
            400,
            'INVALID_CANDLE_COUNT',
            'count must be an integer between 1 and 5000.',
          );
          return;
        }
        try {
          json(
            response,
            200,
            await oandaProvider.getH4Candles(oandaConfiguration.nas100Instrument, count),
          );
        } catch {
          error(response, 502, 'OANDA_CANDLES_FAILED', 'OANDA candle retrieval failed.');
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/runs/manual-oanda') {
        if (!oandaProvider || !oandaConfiguration.nas100Instrument) {
          error(
            response,
            409,
            'OANDA_INSTRUMENT_UNCONFIGURED',
            'Configure OANDA_ACCOUNT_ID, OANDA_API_TOKEN, and OANDA_NAS100_INSTRUMENT before requesting a manual OANDA run.',
          );
          return;
        }
        try {
          const result = await executeManualOandaAnalysis(
            activeRepository,
            oandaProvider,
            oandaConfiguration.nas100Instrument,
            'user',
            options.eventRiskFetch ?? fetch,
          );
          if (!result.report) {
            error(
              response,
              409,
              result.outcome === 'failed'
                ? 'OANDA_MANUAL_RUN_FAILED'
                : 'OANDA_NO_COMPLETED_CANDLES',
              result.message ?? 'Manual OANDA analysis could not be completed.',
            );
            return;
          }
          json(response, result.outcome === 'created' ? 201 : 200, {
            id: result.run.id,
            runKey: result.run.runKey,
            persistedAt: result.run.persistedAt,
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
          error(
            response,
            502,
            'OANDA_MANUAL_RUN_FAILED',
            'Manual OANDA analysis could not be completed.',
          );
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/runs/manual-fixture') {
        const result = runSyntheticFixtureAnalysis(activeRepository);
        if (!result.report) {
          error(
            response,
            409,
            'FIXTURE_RUN_BLOCKED',
            result.message ?? 'Synthetic fixture analysis could not produce a completed report.',
          );
          return;
        }
        json(
          response,
          result.outcome === 'created' ? 201 : 200,
          summary(result.run, result.report, result.outcome === 'already_exists'),
        );
        return;
      }

      if (request.method === 'GET' && url.pathname === '/runs') {
        const limit = parseLimit(url.searchParams.get('limit'));
        if (limit === null) {
          error(response, 400, 'INVALID_LIMIT', 'limit must be an integer between 1 and 100.');
          return;
        }
        json(response, 200, {
          runs: activeRepository
            .listHistory(limit)
            .map((item) => withStrategyLabel(activeRepository, item)),
        });
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
        json(response, 200, withStrategyLabel(activeRepository, item));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/strategies') {
        const status = url.searchParams.get('status');
        if (status !== null && !['draft', 'active', 'archived'].includes(status)) {
          error(response, 400, 'INVALID_STATUS', 'status must be draft, active, or archived.');
          return;
        }
        json(response, 200, {
          strategies: activeRepository.listStrategies(
            (status as StrategyStatus | null) ?? undefined,
          ),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/strategies') {
        try {
          const body = StrategyConfigInputSchema.parse(await readJsonBody(request));
          const created = activeRepository.saveStrategyConfig(randomUUID(), 1, body);
          json(response, 201, created);
        } catch (cause) {
          if (cause instanceof ZodError) {
            error(
              response,
              422,
              'STRATEGY_VALIDATION_FAILED',
              cause.issues.map((issue) => issue.message).join('; '),
            );
            return;
          }
          error(
            response,
            400,
            'INVALID_REQUEST_BODY',
            cause instanceof Error ? cause.message : 'Invalid request body.',
          );
        }
        return;
      }

      const activateMatch =
        request.method === 'POST'
          ? url.pathname.match(/^\/strategies\/([^/]+)\/versions\/(\d+)\/activate$/)
          : null;
      if (activateMatch) {
        const [, strategyId, versionText] = activateMatch;
        try {
          json(
            response,
            200,
            activeRepository.activateStrategyVersion(strategyId!, Number(versionText)),
          );
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : 'Could not activate strategy version.';
          const notFound = message.includes('does not exist');
          error(
            response,
            notFound ? 404 : 409,
            notFound ? 'STRATEGY_NOT_FOUND' : 'STRATEGY_VERSION_NOT_DRAFT',
            message,
          );
        }
        return;
      }

      const versionsMatch =
        request.method === 'POST' ? url.pathname.match(/^\/strategies\/([^/]+)\/versions$/) : null;
      if (versionsMatch) {
        const [, strategyId] = versionsMatch;
        try {
          const body = StrategyConfigInputSchema.parse(await readJsonBody(request));
          const version = activeRepository.getNextStrategyVersion(strategyId!);
          json(response, 201, activeRepository.saveStrategyConfig(strategyId!, version, body));
        } catch (cause) {
          if (cause instanceof ZodError) {
            error(
              response,
              422,
              'STRATEGY_VALIDATION_FAILED',
              cause.issues.map((issue) => issue.message).join('; '),
            );
            return;
          }
          error(
            response,
            400,
            'INVALID_REQUEST_BODY',
            cause instanceof Error ? cause.message : 'Invalid request body.',
          );
        }
        return;
      }

      const strategyMatch =
        request.method === 'GET' ? url.pathname.match(/^\/strategies\/([^/]+)$/) : null;
      if (strategyMatch) {
        const [, strategyId] = strategyMatch;
        const versions = activeRepository.getStrategyVersions(strategyId!);
        if (versions.length === 0) {
          error(response, 404, 'STRATEGY_NOT_FOUND', 'No strategy matches this id.');
          return;
        }
        json(response, 200, { strategyId, versions });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/backtests') {
        if (!backtestRepository) {
          error(
            response,
            503,
            'BACKTEST_PERSISTENCE_UNAVAILABLE',
            'Backtest results are unavailable.',
          );
          return;
        }
        json(response, 200, {
          backtests: backtestRepository.listRuns(
            url.searchParams.get('strategyConfigId') ?? undefined,
          ),
        });
        return;
      }

      const backtestMatch =
        request.method === 'GET' ? url.pathname.match(/^\/backtests\/([^/]+)$/) : null;
      if (backtestMatch) {
        if (!backtestRepository) {
          error(
            response,
            503,
            'BACKTEST_PERSISTENCE_UNAVAILABLE',
            'Backtest results are unavailable.',
          );
          return;
        }
        const [, runId] = backtestMatch;
        const report = buildBacktestReport(backtestRepository, runId!);
        if (!report) {
          error(response, 404, 'BACKTEST_NOT_FOUND', 'No backtest run matches this id.');
          return;
        }
        json(response, 200, report);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/mr-evaluations') {
        json(response, 200, { evaluations: activeRepository.listLatestMeanReversionEvaluations() });
        return;
      }

      const mrEvaluationsMatch =
        request.method === 'GET' ? url.pathname.match(/^\/mr-evaluations\/([^/]+)$/) : null;
      if (mrEvaluationsMatch) {
        const [, strategyConfigId] = mrEvaluationsMatch;
        const limit = parseLimit(url.searchParams.get('limit'));
        if (limit === null) {
          error(response, 400, 'INVALID_LIMIT', 'limit must be an integer between 1 and 100.');
          return;
        }
        json(response, 200, {
          evaluations: activeRepository.listMeanReversionEvaluations(strategyConfigId!, limit),
        });
        return;
      }

      error(response, 404, 'NOT_FOUND', 'The requested endpoint does not exist.');
    } catch (cause) {
      error(
        response,
        500,
        'SERVICE_ERROR',
        cause instanceof Error
          ? cause.message
          : 'The local service could not complete the request.',
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
          // Best-effort, non-fatal: the backtest harness is an isolated CLI tool (see
          // scripts/backtest/) and its SQLite file may not exist yet if no backtest has ever
          // been run. Opening it here just creates an empty schema in that case — the
          // /backtests* routes below simply return empty lists/404s until a backtest runs.
          try {
            backtestRepository = new BacktestRepository(backtestDatabasePath);
          } catch {
            backtestRepository = null;
          }
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
        liveStream?.stop();
        const activeServer = server;
        server = null;
        if (!activeServer) {
          repository?.close();
          repository = null;
          backtestRepository?.close();
          backtestRepository = null;
          resolve();
          return;
        }
        activeServer.close((cause) => {
          repository?.close();
          repository = null;
          backtestRepository?.close();
          backtestRepository = null;
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
