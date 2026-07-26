import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { SwingReport } from '../application/buildSwingReport';
import {
  StrategyConfigInputSchema,
  type StrategyConfig,
  type StrategyConfigInput,
  type StrategyParameters,
  type StrategyStatus,
} from '../schemas/strategyConfig';

export const PERSISTENCE_SCHEMA_VERSION = 4;

export type AnalysisRunStatus = 'COMPLETED' | 'BLOCKED' | 'FAILED';

/** Distinguishes a user-initiated run (manual button click) from a scheduler-initiated one. Optional and nullable: rows persisted before this field existed have no value and are never rewritten. */
export type AnalysisRunTrigger = 'user' | 'scheduler';

export type AnalysisRunInput = {
  id: string;
  runKey: string;
  startedAt: string;
  completedAt: string;
  status: AnalysisRunStatus;
  source: 'manual' | 'fixture';
  errorMessage?: string | null;
  triggeredBy?: AnalysisRunTrigger | null;
  /** NULL means "default/unversioned parameters" — distinct from "unknown". */
  strategyConfigId?: string | null;
};

export type StoredAnalysisRun = AnalysisRunInput & {
  reportId: string | null;
  persistedAt: string;
};

export type AnalysisHistoryItem = {
  run: StoredAnalysisRun;
  report: SwingReport | null;
};

type RunRow = {
  id: string;
  run_key: string;
  started_at: string;
  completed_at: string;
  status: AnalysisRunStatus;
  source: AnalysisRunInput['source'];
  error_message: string | null;
  report_id: string | null;
  persisted_at: string;
  triggered_by: AnalysisRunTrigger | null;
  strategy_config_id: string | null;
};

type ReportRow = {
  id: string;
  report_json: string;
};

type StrategyConfigRow = {
  id: string;
  strategy_id: string;
  version: number;
  name: string;
  status: StrategyStatus;
  min_reward_risk: number;
  premium_score_threshold: number;
  config_json: string;
  created_at: string;
};

export type MeanReversionSignal = 'ENTER' | 'HOLD' | 'EXIT' | 'FLAT';

/** One immutable, read-only snapshot of what a live MR-kind strategy evaluated to at a given
 * completed bar — never updated in place (see `saveMeanReversionEvaluation`). */
export type MeanReversionEvaluationInput = {
  id: string;
  strategyConfigId: string;
  strategyId: string;
  version: number;
  instrument: string;
  timeframe: 'D' | 'H4';
  evaluatedAt: string;
  referenceCandleTime: string;
  referenceClose: number;
  signal: MeanReversionSignal;
  stopPrice: number | null;
  atr: number | null;
  smaFilterValue: number | null;
  aboveSmaFilter: boolean | null;
  riskPerTradePct: number;
  accountSize: number | null;
  suggestedRiskAmount: number | null;
  suggestedPositionSizeUnits: number | null;
};

export type StoredMeanReversionEvaluation = MeanReversionEvaluationInput & { persistedAt: string };

type MeanReversionEvaluationRow = {
  id: string;
  strategy_config_id: string;
  strategy_id: string;
  version: number;
  instrument: string;
  timeframe: 'D' | 'H4';
  evaluated_at: string;
  reference_candle_time: string;
  reference_close: number;
  signal: MeanReversionSignal;
  stop_price: number | null;
  atr: number | null;
  sma_filter_value: number | null;
  above_sma_filter: number | null;
  risk_per_trade_pct: number;
  account_size: number | null;
  suggested_risk_amount: number | null;
  suggested_position_size_units: number | null;
  persisted_at: string;
};

const createSchema = (database: DatabaseSync) => {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS analysis_reports (
      id TEXT PRIMARY KEY,
      report_version TEXT NOT NULL,
      instrument TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      source_candle_time TEXT,
      action TEXT NOT NULL,
      direction TEXT NOT NULL,
      score INTEGER,
      grade TEXT,
      is_actionable INTEGER NOT NULL CHECK (is_actionable IN (0, 1)),
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      run_key TEXT NOT NULL UNIQUE,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'BLOCKED', 'FAILED')),
      source TEXT NOT NULL CHECK (source IN ('manual', 'fixture')),
      error_message TEXT,
      report_id TEXT UNIQUE REFERENCES analysis_reports(id) ON DELETE RESTRICT,
      persisted_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS analysis_runs_completed_at_idx
      ON analysis_runs(completed_at DESC);

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (1, '${new Date().toISOString()}');
  `);

  const columns = database.prepare('PRAGMA table_info(analysis_runs)').all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'triggered_by')) {
    database.exec(`
      ALTER TABLE analysis_runs ADD COLUMN triggered_by TEXT CHECK (triggered_by IN ('user', 'scheduler') OR triggered_by IS NULL);
    `);
  }

  database.exec(`
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (2, '${new Date().toISOString()}');

    CREATE TABLE IF NOT EXISTS strategy_configs (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
      min_reward_risk REAL NOT NULL CHECK (min_reward_risk >= 2.0),
      premium_score_threshold REAL NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (strategy_id, version)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS strategy_configs_one_active_idx
      ON strategy_configs(strategy_id) WHERE status = 'active';
  `);

  const runColumns = database.prepare('PRAGMA table_info(analysis_runs)').all() as Array<{
    name: string;
  }>;
  if (!runColumns.some((column) => column.name === 'strategy_config_id')) {
    database.exec(`
      ALTER TABLE analysis_runs ADD COLUMN strategy_config_id TEXT REFERENCES strategy_configs(id);
    `);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS mr_evaluations (
      id TEXT PRIMARY KEY,
      strategy_config_id TEXT NOT NULL REFERENCES strategy_configs(id),
      strategy_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      instrument TEXT NOT NULL,
      timeframe TEXT NOT NULL CHECK (timeframe IN ('D', 'H4')),
      evaluated_at TEXT NOT NULL,
      reference_candle_time TEXT NOT NULL,
      reference_close REAL NOT NULL,
      signal TEXT NOT NULL CHECK (signal IN ('ENTER', 'HOLD', 'EXIT', 'FLAT')),
      stop_price REAL,
      atr REAL,
      sma_filter_value REAL,
      above_sma_filter INTEGER CHECK (above_sma_filter IN (0, 1) OR above_sma_filter IS NULL),
      risk_per_trade_pct REAL NOT NULL,
      account_size REAL,
      suggested_risk_amount REAL,
      suggested_position_size_units REAL,
      persisted_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS mr_evaluations_strategy_evaluated_at_idx
      ON mr_evaluations(strategy_config_id, evaluated_at DESC);

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (${PERSISTENCE_SCHEMA_VERSION}, '${new Date().toISOString()}');
  `);
};

const toStoredRun = (row: RunRow): StoredAnalysisRun => ({
  id: row.id,
  runKey: row.run_key,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  status: row.status,
  source: row.source,
  errorMessage: row.error_message,
  triggeredBy: row.triggered_by,
  reportId: row.report_id,
  persistedAt: row.persisted_at,
  strategyConfigId: row.strategy_config_id,
});

const toStoredMeanReversionEvaluation = (
  row: MeanReversionEvaluationRow,
): StoredMeanReversionEvaluation => ({
  id: row.id,
  strategyConfigId: row.strategy_config_id,
  strategyId: row.strategy_id,
  version: row.version,
  instrument: row.instrument,
  timeframe: row.timeframe,
  evaluatedAt: row.evaluated_at,
  referenceCandleTime: row.reference_candle_time,
  referenceClose: row.reference_close,
  signal: row.signal,
  stopPrice: row.stop_price,
  atr: row.atr,
  smaFilterValue: row.sma_filter_value,
  aboveSmaFilter: row.above_sma_filter === null ? null : Boolean(row.above_sma_filter),
  riskPerTradePct: row.risk_per_trade_pct,
  accountSize: row.account_size,
  suggestedRiskAmount: row.suggested_risk_amount,
  suggestedPositionSizeUnits: row.suggested_position_size_units,
  persistedAt: row.persisted_at,
});

const toStrategyConfig = (row: StrategyConfigRow): StrategyConfig => ({
  id: row.id,
  strategyId: row.strategy_id,
  version: row.version,
  name: row.name,
  status: row.status,
  parameters: JSON.parse(row.config_json) as StrategyParameters,
  createdAt: row.created_at,
});

export const defaultPersistencePath = (localAppData = process.env.LOCALAPPDATA) => {
  if (!localAppData)
    throw new Error('LOCALAPPDATA is required to resolve the default persistence path.');
  return join(localAppData, 'NAS100 Swing Dashboard', 'nas100-swing-dashboard.sqlite');
};

export class AnalysisRepository {
  private readonly database: DatabaseSync;

  public constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    createSchema(this.database);
  }

  public saveCompletedRun(run: AnalysisRunInput, report: SwingReport): StoredAnalysisRun {
    if (run.status !== 'COMPLETED') {
      throw new Error('Completed runs must use the COMPLETED status.');
    }

    const persistedAt = new Date().toISOString();
    const reportId = reportIdFor(run, report);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO analysis_reports (
            id, report_version, instrument, timeframe, source_candle_time, action, direction,
            score, grade, is_actionable, report_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reportId,
          report.reportVersion,
          report.instrument,
          report.timeframe,
          report.sourceCandleTime,
          report.action,
          report.direction,
          report.score,
          report.grade,
          Number(report.isActionable),
          JSON.stringify(report),
          report.generatedAt,
        );

      this.database
        .prepare(
          `INSERT INTO analysis_runs (
            id, run_key, started_at, completed_at, status, source, error_message, report_id, persisted_at, triggered_by, strategy_config_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.runKey,
          run.startedAt,
          run.completedAt,
          run.status,
          run.source,
          run.errorMessage ?? null,
          reportId,
          persistedAt,
          run.triggeredBy ?? null,
          run.strategyConfigId ?? null,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      ...run,
      errorMessage: run.errorMessage ?? null,
      triggeredBy: run.triggeredBy ?? null,
      strategyConfigId: run.strategyConfigId ?? null,
      reportId,
      persistedAt,
    };
  }

  public saveNonCompletedRun(run: AnalysisRunInput): StoredAnalysisRun {
    if (run.status === 'COMPLETED') {
      throw new Error('Completed runs require an immutable SwingReport.');
    }

    const persistedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO analysis_runs (
          id, run_key, started_at, completed_at, status, source, error_message, report_id, persisted_at, triggered_by, strategy_config_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.runKey,
        run.startedAt,
        run.completedAt,
        run.status,
        run.source,
        run.errorMessage ?? null,
        persistedAt,
        run.triggeredBy ?? null,
        run.strategyConfigId ?? null,
      );

    return {
      ...run,
      errorMessage: run.errorMessage ?? null,
      triggeredBy: run.triggeredBy ?? null,
      strategyConfigId: run.strategyConfigId ?? null,
      reportId: null,
      persistedAt,
    };
  }

  public listHistory(limit = 50): AnalysisHistoryItem[] {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error('History limit must be a positive integer.');

    const rows = this.database
      .prepare(
        `SELECT runs.*, reports.id AS report_row_id, reports.report_json
         FROM analysis_runs AS runs
         LEFT JOIN analysis_reports AS reports ON reports.id = runs.report_id
         ORDER BY runs.completed_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<RunRow & Partial<ReportRow>>;

    return rows.map((row) => ({
      run: toStoredRun(row),
      report: row.report_json ? (JSON.parse(row.report_json) as SwingReport) : null,
    }));
  }

  public getRunByKey(runKey: string): AnalysisHistoryItem | null {
    const row = this.database
      .prepare(
        `SELECT runs.*, reports.id AS report_row_id, reports.report_json
         FROM analysis_runs AS runs
         LEFT JOIN analysis_reports AS reports ON reports.id = runs.report_id
         WHERE runs.run_key = ?`,
      )
      .get(runKey) as (RunRow & Partial<ReportRow>) | undefined;

    return row
      ? {
          run: toStoredRun(row),
          report: row.report_json ? (JSON.parse(row.report_json) as SwingReport) : null,
        }
      : null;
  }

  /** Single choke point for writing strategy parameter values. Every write path (create
   * strategy, create a new draft version) must go through this method, since it's the one
   * place that runs `StrategyConfigInputSchema.parse()` — including the min-R:R->=2.0 floor
   * and the setup-score-weights-sum-to-100 refine — before any INSERT. The SQLite CHECK on
   * `min_reward_risk` is defense-in-depth only; it isn't the primary enforcement mechanism. */
  public saveStrategyConfig(
    strategyId: string,
    version: number,
    input: StrategyConfigInput,
  ): StrategyConfig {
    const parsed = StrategyConfigInputSchema.parse(input);
    const id = `${strategyId}:${version}`;
    const createdAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO strategy_configs (
          id, strategy_id, version, name, status, min_reward_risk, premium_score_threshold, config_json, created_at
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      )
      .run(
        id,
        strategyId,
        version,
        parsed.name,
        parsed.parameters.minRewardRisk,
        parsed.parameters.premiumScoreThreshold,
        JSON.stringify(parsed.parameters),
        createdAt,
      );

    return {
      id,
      strategyId,
      version,
      name: parsed.name,
      status: 'draft',
      parameters: parsed.parameters,
      createdAt,
    };
  }

  public listStrategies(status?: StrategyStatus): StrategyConfig[] {
    const rows = status
      ? (this.database
          .prepare(
            'SELECT * FROM strategy_configs WHERE status = ? ORDER BY strategy_id, version DESC',
          )
          .all(status) as StrategyConfigRow[])
      : (this.database
          .prepare('SELECT * FROM strategy_configs ORDER BY strategy_id, version DESC')
          .all() as StrategyConfigRow[]);
    return rows.map(toStrategyConfig);
  }

  public getStrategyVersions(strategyId: string): StrategyConfig[] {
    const rows = this.database
      .prepare('SELECT * FROM strategy_configs WHERE strategy_id = ? ORDER BY version ASC')
      .all(strategyId) as StrategyConfigRow[];
    return rows.map(toStrategyConfig);
  }

  public getStrategyConfigById(id: string): StrategyConfig | null {
    const row = this.database.prepare('SELECT * FROM strategy_configs WHERE id = ?').get(id) as
      StrategyConfigRow | undefined;
    return row ? toStrategyConfig(row) : null;
  }

  public getNextStrategyVersion(strategyId: string): number {
    const row = this.database
      .prepare('SELECT MAX(version) AS max_version FROM strategy_configs WHERE strategy_id = ?')
      .get(strategyId) as { max_version: number | null };
    return (row.max_version ?? 0) + 1;
  }

  /** Transactional: demotes whatever version of `strategyId` is currently `active` to
   * `archived`, then promotes `version` from `draft` to `active`. Only one version per
   * strategy may be `active` at a time (also enforced by the partial unique index). */
  public activateStrategyVersion(strategyId: string, version: number): StrategyConfig {
    const target = this.database
      .prepare('SELECT * FROM strategy_configs WHERE strategy_id = ? AND version = ?')
      .get(strategyId, version) as StrategyConfigRow | undefined;
    if (!target) throw new Error(`Strategy ${strategyId} version ${version} does not exist.`);
    if (target.status !== 'draft')
      throw new Error(
        `Strategy ${strategyId} version ${version} is not a draft; only draft versions can be activated.`,
      );

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `UPDATE strategy_configs SET status = 'archived' WHERE strategy_id = ? AND status = 'active'`,
        )
        .run(strategyId);
      this.database
        .prepare(
          `UPDATE strategy_configs SET status = 'active' WHERE strategy_id = ? AND version = ?`,
        )
        .run(strategyId, version);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return { ...toStrategyConfig(target), status: 'active' };
  }

  /** Append-only, like `saveCompletedRun` — a live MR evaluation is a point-in-time record,
   * never updated after the fact. */
  public saveMeanReversionEvaluation(
    input: MeanReversionEvaluationInput,
  ): StoredMeanReversionEvaluation {
    const persistedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO mr_evaluations (
          id, strategy_config_id, strategy_id, version, instrument, timeframe, evaluated_at,
          reference_candle_time, reference_close, signal, stop_price, atr, sma_filter_value,
          above_sma_filter, risk_per_trade_pct, account_size, suggested_risk_amount,
          suggested_position_size_units, persisted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.strategyConfigId,
        input.strategyId,
        input.version,
        input.instrument,
        input.timeframe,
        input.evaluatedAt,
        input.referenceCandleTime,
        input.referenceClose,
        input.signal,
        input.stopPrice,
        input.atr,
        input.smaFilterValue,
        input.aboveSmaFilter === null ? null : Number(input.aboveSmaFilter),
        input.riskPerTradePct,
        input.accountSize,
        input.suggestedRiskAmount,
        input.suggestedPositionSizeUnits,
        persistedAt,
      );

    return { ...input, persistedAt };
  }

  /** Latest evaluation per CURRENTLY ACTIVE strategy config, newest first — the dashboard
   * panel's "current signal per active MR strategy" view. Filtering on strategy_configs.status
   * matters once a strategy has more than one version in its history (draft -> active ->
   * archived): without it, a version that was later archived (superseded by a new active one,
   * or deactivated) keeps showing its last stale evaluation here forever, alongside the
   * current one — including a stale suggested position size computed under a risk% that may
   * no longer apply. */
  public listLatestMeanReversionEvaluations(): StoredMeanReversionEvaluation[] {
    const rows = this.database
      .prepare(
        `SELECT mr.* FROM mr_evaluations AS mr
         INNER JOIN (
           SELECT strategy_config_id, MAX(evaluated_at) AS max_evaluated_at
           FROM mr_evaluations
           GROUP BY strategy_config_id
         ) AS latest
           ON latest.strategy_config_id = mr.strategy_config_id
          AND latest.max_evaluated_at = mr.evaluated_at
         INNER JOIN strategy_configs AS sc
           ON sc.id = mr.strategy_config_id
          AND sc.status = 'active'
         ORDER BY mr.evaluated_at DESC`,
      )
      .all() as MeanReversionEvaluationRow[];
    return rows.map(toStoredMeanReversionEvaluation);
  }

  public listMeanReversionEvaluations(
    strategyConfigId: string,
    limit = 50,
  ): StoredMeanReversionEvaluation[] {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error('Evaluation history limit must be a positive integer.');
    const rows = this.database
      .prepare(
        'SELECT * FROM mr_evaluations WHERE strategy_config_id = ? ORDER BY evaluated_at DESC LIMIT ?',
      )
      .all(strategyConfigId, limit) as MeanReversionEvaluationRow[];
    return rows.map(toStoredMeanReversionEvaluation);
  }

  public close() {
    this.database.close();
  }
}

const reportIdFor = (run: AnalysisRunInput, report: SwingReport) =>
  `${run.id}:${report.reportVersion}`;
