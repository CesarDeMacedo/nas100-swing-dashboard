import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { buildDashboardState } from '../application/buildDashboardState';
import { buildSwingReport } from '../application/buildSwingReport';
import { currentAnalysisSource, currentCandleDatasetSource } from '../domain/fixtures';
import { AnalysisRepository, defaultPersistencePath, type StoredAnalysisRun } from '../persistence/analysisRepository';
import { AnalysisReportSchema, CandleDatasetSchema } from '../schemas';

export const LOCAL_SERVICE_HOST = '127.0.0.1';
export const DEFAULT_SERVICE_PORT = 4310;
const LOCAL_VITE_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

type LocalServiceOptions = {
  databasePath?: string;
  port?: number;
};

type ServiceHealth = {
  service: 'nas100-swing-dashboard';
  status: 'healthy';
  host: typeof LOCAL_SERVICE_HOST;
  port: number;
  persistence: { available: boolean; path: string };
};

type LocalService = {
  start: () => Promise<ServiceHealth>;
  stop: () => Promise<void>;
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

const summary = (run: StoredAnalysisRun, report: ReturnType<typeof buildSwingReport>, alreadyExists: boolean) => ({
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

const fixtureRunKey = (report: ReturnType<typeof buildSwingReport>, strategyVersion: string) =>
  [report.instrument, report.timeframe, report.sourceCandleTime ?? 'unavailable', report.reportVersion, strategyVersion, 'fixture'].join(':');

const parseLimit = (value: string | null) => {
  if (value === null) return 20;
  if (!/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 ? limit : null;
};

const resolvePort = (value: string | undefined) => {
  if (value === undefined) return DEFAULT_SERVICE_PORT;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_SERVICE_PORT;
};

export function createLocalService(options: LocalServiceOptions = {}): LocalService {
  const databasePath = options.databasePath ?? process.env.NAS100_DASHBOARD_DB_PATH ?? defaultPersistencePath();
  const configuredPort = options.port ?? resolvePort(process.env.NAS100_DASHBOARD_PORT);
  let repository: AnalysisRepository | null = null;
  let server: Server | null = null;
  let boundPort = configuredPort;

  const health = (): ServiceHealth => ({
    service: 'nas100-swing-dashboard',
    status: 'healthy',
    host: LOCAL_SERVICE_HOST,
    port: boundPort,
    persistence: { available: repository !== null, path: databasePath },
  });

  const requestHandler = (request: IncomingMessage, response: ServerResponse) => {
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

      if (request.method === 'POST' && url.pathname === '/runs/manual-fixture') {
        const analysis = AnalysisReportSchema.parse(currentAnalysisSource);
        const candles = CandleDatasetSchema.parse(currentCandleDatasetSource);
        const dashboardState = buildDashboardState(analysis, candles);
        const report = buildSwingReport(dashboardState);
        const runKey = fixtureRunKey(report, analysis.strategyVersion);
        const existing = activeRepository.getRunByKey(runKey);
        if (existing?.report) {
          json(response, 200, summary(existing.run, existing.report, true));
          return;
        }

        const now = new Date().toISOString();
        const run = activeRepository.saveCompletedRun(
          {
            id: randomUUID(),
            runKey,
            startedAt: now,
            completedAt: now,
            status: 'COMPLETED',
            source: 'fixture',
          },
          report,
        );
        json(response, 201, summary(run, report, false));
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
            resolve(health());
          });
        } catch (cause) {
          reject(cause);
        }
      }),
    stop: () =>
      new Promise((resolve, reject) => {
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
  };
}

if (process.argv[1]?.endsWith('server.ts')) {
  const service = createLocalService();
  service.start().then(({ host, port }) => {
    process.stdout.write(`NAS100 local service listening on http://${host}:${port}\n`);
  });
}
