import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildDashboardState } from '../application/buildDashboardState';
import { buildSwingReport } from '../application/buildSwingReport';
import { parseAnalysis } from '../domain/analysis';
import { parseCandleDataset } from '../domain/candles';
import { currentAnalysisSource, currentCandleDatasetSource } from '../domain/fixtures';
import type { StrategyParameters } from '../schemas/strategyConfig';
import { AnalysisRepository, defaultPersistencePath } from './analysisRepository';

const temporaryDirectories: string[] = [];

const createRepository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-persistence-'));
  temporaryDirectories.push(directory);
  return new AnalysisRepository(join(directory, 'history.sqlite'));
};

const currentReport = () => {
  const analysis = parseAnalysis(currentAnalysisSource);
  const candles = parseCandleDataset(currentCandleDatasetSource);
  if (!analysis.success || !candles.success) throw new Error('Current fixtures must validate.');
  return buildSwingReport(buildDashboardState(analysis.analysis, candles.dataset));
};

const completedRun = (id = 'run-001') => ({
  id,
  runKey: `NAS100:H4:2026-07-21T21:00:00-04:00:1.0.0:${id}`,
  startedAt: '2026-07-21T21:01:00-04:00',
  completedAt: '2026-07-21T21:01:01-04:00',
  status: 'COMPLETED' as const,
  source: 'fixture' as const,
});

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('AnalysisRepository', () => {
  it('persists an immutable completed run and its report', () => {
    const repository = createRepository();
    const report = currentReport();
    const stored = repository.saveCompletedRun(completedRun(), report);

    expect(stored.reportId).toBe('run-001:1.0.0');
    expect(repository.getRunByKey(stored.runKey)).toEqual({ run: stored, report });
    repository.close();
  });

  it('persists blocked and failed runs without a report', () => {
    const repository = createRepository();
    const blocked = repository.saveNonCompletedRun({
      ...completedRun('blocked-001'),
      status: 'BLOCKED',
      errorMessage: 'Latest candle is open.',
    });

    expect(repository.getRunByKey(blocked.runKey)).toEqual({ run: blocked, report: null });
    repository.close();
  });

  it('orders history by completed time and respects the requested limit', () => {
    const repository = createRepository();
    repository.saveNonCompletedRun({
      ...completedRun('older'),
      status: 'FAILED',
      completedAt: '2026-07-21T20:00:00-04:00',
    });
    repository.saveCompletedRun(
      { ...completedRun('newer'), completedAt: '2026-07-21T22:00:00-04:00' },
      currentReport(),
    );

    expect(repository.listHistory(1).map((entry) => entry.run.id)).toEqual(['newer']);
    repository.close();
  });

  it('enforces idempotency through the unique run key', () => {
    const repository = createRepository();
    const run = completedRun();
    repository.saveCompletedRun(run, currentReport());

    expect(() => repository.saveCompletedRun({ ...run, id: 'run-002' }, currentReport())).toThrow();
    repository.close();
  });

  it('creates a durable database that can be reopened', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nas100-persistence-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'history.sqlite');
    const repository = new AnalysisRepository(path);
    repository.saveCompletedRun(completedRun(), currentReport());
    repository.close();

    const reopened = new AnalysisRepository(path);
    expect(existsSync(path)).toBe(true);
    expect(reopened.listHistory()).toHaveLength(1);
    reopened.close();
  });

  it('requires reports for completed runs and rejects invalid limits', () => {
    const repository = createRepository();
    expect(() => repository.saveNonCompletedRun(completedRun())).toThrow(
      'require an immutable SwingReport',
    );
    expect(() => repository.listHistory(0)).toThrow('positive integer');
    repository.close();
  });

  it('resolves the Windows local-app-data database location without opening it', () => {
    expect(defaultPersistencePath('C:\\Users\\example\\AppData\\Local')).toBe(
      'C:\\Users\\example\\AppData\\Local\\NAS100 Swing Dashboard\\nas100-swing-dashboard.sqlite',
    );
  });

  it('persists an explicit triggeredBy for completed and non-completed runs', () => {
    const repository = createRepository();
    const scheduled = repository.saveCompletedRun(
      { ...completedRun('scheduled-001'), triggeredBy: 'scheduler' },
      currentReport(),
    );
    const manual = repository.saveNonCompletedRun({
      ...completedRun('manual-001'),
      status: 'BLOCKED',
      triggeredBy: 'user',
      errorMessage: 'Latest candle is open.',
    });

    expect(scheduled.triggeredBy).toBe('scheduler');
    expect(manual.triggeredBy).toBe('user');
    expect(repository.getRunByKey(scheduled.runKey)?.run.triggeredBy).toBe('scheduler');
    repository.close();
  });

  it('defaults triggeredBy to null when not supplied, without affecting existing runs', () => {
    const repository = createRepository();
    const stored = repository.saveCompletedRun(completedRun(), currentReport());

    expect(stored.triggeredBy).toBeNull();
    expect(repository.getRunByKey(stored.runKey)?.run.triggeredBy).toBeNull();
    repository.close();
  });

  it('adds the triggered_by column additively on reopen without touching existing run data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nas100-persistence-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'history.sqlite');
    const repository = new AnalysisRepository(path);
    const stored = repository.saveCompletedRun(completedRun(), currentReport());
    repository.close();

    // Reopening re-runs schema setup (including the additive ALTER TABLE) against an
    // already-populated database — this must be idempotent and must not alter the
    // previously persisted row's values.
    const reopened = new AnalysisRepository(path);
    const rehydrated = reopened.getRunByKey(stored.runKey);

    expect(rehydrated?.run).toEqual(stored);
    expect(rehydrated?.run.triggeredBy).toBeNull();
    reopened.close();
  });
});

const strategyParameters = (overrides: Partial<StrategyParameters> = {}): StrategyParameters => ({
  minRewardRisk: 2,
  premiumScoreThreshold: 70,
  atrLocationTolerance: 0.35,
  atrTriggerBuffer: 0.05,
  atrStopBuffer: 0.25,
  atrInvalidationBuffer: 0.1,
  confirmationClosePositionThreshold: 0.6,
  crossMarketPrimaryInstruments: ['us500', 'us30'],
  invalidationAnchor: 'deepest',
  strategyKind: 'pipeline',
  meanReversion: {
    timeframe: 'D',
    smaFilterPeriod: 200,
    rsiPeriod: 2,
    rsiEntryThreshold: 5,
    rsiExitThreshold: 65,
    lookbackEntryLow: 7,
    lookbackExitHigh: 7,
    protectiveStopAtrMultiple: null,
    atrPeriod: 14,
    maxBarsHeld: null,
  },
  setupScoreWeights: {
    trend: 20,
    structure: 20,
    momentum: 15,
    location: 15,
    crossMarket: 10,
    eventRisk: 5,
    rewardRisk: 10,
    patienceReadiness: 5,
  },
  eventRisk: { blockingWindowMinutes: 60, minImpact: 'High' },
  ...overrides,
});

describe('AnalysisRepository strategy configs', () => {
  it('creates a version-1 draft and enforces the min-R:R>=2.0 floor at the same choke point', () => {
    const repository = createRepository();
    const strategyId = 'strategy-aggressive';
    const version = repository.getNextStrategyVersion(strategyId);
    expect(version).toBe(1);

    const saved = repository.saveStrategyConfig(strategyId, version, {
      name: 'Aggressive',
      parameters: strategyParameters(),
    });
    expect(saved).toMatchObject({ strategyId, version: 1, status: 'draft', name: 'Aggressive' });

    expect(() =>
      repository.saveStrategyConfig(strategyId, repository.getNextStrategyVersion(strategyId), {
        name: 'Too tight',
        parameters: strategyParameters({ minRewardRisk: 1.5 }),
      }),
    ).toThrow();
    repository.close();
  });

  it('rejects setup-score weights that do not sum to 100 through the same schema', () => {
    const repository = createRepository();
    expect(() =>
      repository.saveStrategyConfig('strategy-bad-weights', 1, {
        name: 'Bad weights',
        parameters: strategyParameters({
          setupScoreWeights: {
            trend: 20,
            structure: 20,
            momentum: 15,
            location: 15,
            crossMarket: 10,
            eventRisk: 5,
            rewardRisk: 10,
            patienceReadiness: 99,
          },
        }),
      }),
    ).toThrow();
    repository.close();
  });

  it('only lets one version per strategy be active, demoting the previous active version to archived', () => {
    const repository = createRepository();
    const strategyId = 'strategy-versioned';
    repository.saveStrategyConfig(strategyId, 1, { name: 'V1', parameters: strategyParameters() });
    repository.activateStrategyVersion(strategyId, 1);
    repository.saveStrategyConfig(strategyId, 2, {
      name: 'V2',
      parameters: strategyParameters({ minRewardRisk: 2.5 }),
    });
    repository.activateStrategyVersion(strategyId, 2);

    const versions = repository.getStrategyVersions(strategyId);
    expect(versions.find((v) => v.version === 1)?.status).toBe('archived');
    expect(versions.find((v) => v.version === 2)?.status).toBe('active');
    expect(repository.listStrategies('active').map((s) => s.id)).toEqual([`${strategyId}:2`]);
    repository.close();
  });

  it('refuses to activate a version that is not a draft', () => {
    const repository = createRepository();
    const strategyId = 'strategy-double-activate';
    repository.saveStrategyConfig(strategyId, 1, { name: 'V1', parameters: strategyParameters() });
    repository.activateStrategyVersion(strategyId, 1);

    expect(() => repository.activateStrategyVersion(strategyId, 1)).toThrow('not a draft');
    repository.close();
  });

  it('links an analysis run to the strategy config that produced it', () => {
    const repository = createRepository();
    const strategyId = 'strategy-linked';
    const strategy = repository.saveStrategyConfig(strategyId, 1, {
      name: 'Linked',
      parameters: strategyParameters(),
    });
    const stored = repository.saveCompletedRun(
      { ...completedRun('linked-run'), strategyConfigId: strategy.id },
      currentReport(),
    );

    expect(stored.strategyConfigId).toBe(strategy.id);
    expect(repository.getRunByKey(stored.runKey)?.run.strategyConfigId).toBe(strategy.id);
    repository.close();
  });
});

const mrEvaluationInput = (
  strategyConfigId: string,
  overrides: Partial<Parameters<AnalysisRepository['saveMeanReversionEvaluation']>[0]> = {},
) => ({
  id: `eval-${overrides.evaluatedAt ?? '1'}`,
  strategyConfigId,
  strategyId: 'strategy-mr',
  version: 1,
  instrument: 'NAS100_USD',
  timeframe: 'D' as const,
  evaluatedAt: '2026-07-21T21:01:00.000Z',
  referenceCandleTime: '2026-07-21T21:00:00.000Z',
  referenceClose: 100,
  signal: 'FLAT' as const,
  stopPrice: null,
  exitWatchPrice: null,
  atr: null,
  smaFilterValue: null,
  aboveSmaFilter: null,
  riskPerTradePct: 0.73,
  accountSize: null,
  suggestedRiskAmount: null,
  suggestedPositionSizeUnits: null,
  ...overrides,
});

describe('AnalysisRepository mean-reversion evaluations', () => {
  it('persists an immutable evaluation record and reads it back unchanged', () => {
    const repository = createRepository();
    const strategy = repository.saveStrategyConfig('strategy-mr', 1, {
      name: 'MR',
      parameters: strategyParameters({ strategyKind: 'double7' }),
    });
    const stored = repository.saveMeanReversionEvaluation(
      mrEvaluationInput(strategy.id, {
        signal: 'ENTER',
        stopPrice: 95,
        exitWatchPrice: 108.5,
        atr: 2.5,
      }),
    );

    expect(stored.signal).toBe('ENTER');
    expect(stored.stopPrice).toBe(95);
    expect(stored.exitWatchPrice).toBe(108.5);
    expect(repository.listMeanReversionEvaluations(strategy.id)).toEqual([stored]);
    repository.close();
  });

  it('lists only the latest evaluation per active strategy config', () => {
    const repository = createRepository();
    const strategy = repository.saveStrategyConfig('strategy-mr', 1, {
      name: 'MR',
      parameters: strategyParameters({ strategyKind: 'double7' }),
    });
    repository.activateStrategyVersion('strategy-mr', 1);
    repository.saveMeanReversionEvaluation(
      mrEvaluationInput(strategy.id, {
        id: 'eval-older',
        evaluatedAt: '2026-07-20T21:01:00.000Z',
        signal: 'FLAT',
      }),
    );
    const latest = repository.saveMeanReversionEvaluation(
      mrEvaluationInput(strategy.id, {
        id: 'eval-newer',
        evaluatedAt: '2026-07-21T21:01:00.000Z',
        signal: 'ENTER',
      }),
    );

    const results = repository.listLatestMeanReversionEvaluations();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(latest);
    repository.close();
  });

  it('excludes a strategy version archived by a newer active version, even though its own evaluation is still the latest for that config id', () => {
    const repository = createRepository();
    const strategyId = 'strategy-mr-versioned';
    const v1 = repository.saveStrategyConfig(strategyId, 1, {
      name: 'MR v1',
      parameters: strategyParameters({ strategyKind: 'double7' }),
    });
    repository.activateStrategyVersion(strategyId, 1);
    const staleEvaluation = repository.saveMeanReversionEvaluation(
      mrEvaluationInput(v1.id, {
        id: 'eval-v1',
        evaluatedAt: '2026-07-20T21:01:00.000Z',
        signal: 'HOLD',
      }),
    );

    // v2 supersedes v1 (archiving it) — a real scenario when a strategy's live version changes.
    const v2 = repository.saveStrategyConfig(
      strategyId,
      repository.getNextStrategyVersion(strategyId),
      { name: 'MR v2', parameters: strategyParameters({ strategyKind: 'double7' }) },
    );
    repository.activateStrategyVersion(strategyId, v2.version);
    const currentEvaluation = repository.saveMeanReversionEvaluation(
      mrEvaluationInput(v2.id, {
        id: 'eval-v2',
        evaluatedAt: '2026-07-21T21:01:00.000Z',
        signal: 'ENTER',
      }),
    );

    const results = repository.listLatestMeanReversionEvaluations();
    expect(results).toEqual([currentEvaluation]);
    expect(results.map((r) => r.id)).not.toContain(staleEvaluation.id);
    repository.close();
  });

  it('round-trips a boolean aboveSmaFilter through the SQLite integer column', () => {
    const repository = createRepository();
    const strategy = repository.saveStrategyConfig('strategy-mr', 1, {
      name: 'MR',
      parameters: strategyParameters({ strategyKind: 'double7' }),
    });
    const above = repository.saveMeanReversionEvaluation(
      mrEvaluationInput(strategy.id, { id: 'eval-above', aboveSmaFilter: true }),
    );
    const below = repository.saveMeanReversionEvaluation(
      mrEvaluationInput(strategy.id, {
        id: 'eval-below',
        evaluatedAt: '2026-07-22T21:01:00.000Z',
        aboveSmaFilter: false,
      }),
    );

    expect(above.aboveSmaFilter).toBe(true);
    expect(below.aboveSmaFilter).toBe(false);
    repository.close();
  });
});
