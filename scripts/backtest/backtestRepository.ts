import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SignalDirection, SignalStatus } from './signalOutcome';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Deliberately a SEPARATE SQLite file from the production app's `analysis_reports.sqlite` —
 * this is the harness's own persistence, isolated so its schema can evolve independently of
 * production's. The running web service opens this file read-only to serve the new
 * `/backtests*` routes; only the CLI (this repository's write path) ever writes to it. */
export const defaultBacktestDatabasePath = () => join(moduleDir, '.cache', 'backtest-results.sqlite');

export type BacktestRunStatus = 'running' | 'completed' | 'failed';

export type BacktestRunInput = {
  id: string;
  strategyConfigId: string;
  instrument: string;
  rangeStart: string;
  rangeEnd: string;
};

export type StoredBacktestRun = BacktestRunInput & {
  status: BacktestRunStatus;
  startedAt: string;
  completedAt: string | null;
  frameCount: number | null;
  errorMessage: string | null;
};

export type BacktestSignalInput = {
  id: string;
  backtestRunId: string;
  decisionCandleTime: string;
  direction: SignalDirection;
  entryPrice: number;
  invalidationPrice: number;
  stopPrice: number;
  targetPrice: number;
  estimatedRewardRisk: number;
  score: number | null;
  grade: string | null;
  localHourOfDay: number;
  localWeekday: number;
  status: SignalStatus;
  filledAt: string | null;
  resolvedAt: string | null;
  outcomeRR: number | null;
};

export type StoredBacktestSignal = BacktestSignalInput;

type BacktestRunRow = {
  id: string;
  strategy_config_id: string;
  instrument: string;
  range_start: string;
  range_end: string;
  status: BacktestRunStatus;
  started_at: string;
  completed_at: string | null;
  frame_count: number | null;
  error_message: string | null;
};

type BacktestSignalRow = {
  id: string;
  backtest_run_id: string;
  decision_candle_time: string;
  direction: SignalDirection;
  entry_price: number;
  invalidation_price: number;
  stop_price: number;
  target_price: number;
  estimated_reward_risk: number;
  score: number | null;
  grade: string | null;
  local_hour_of_day: number;
  local_weekday: number;
  status: SignalStatus;
  filled_at: string | null;
  resolved_at: string | null;
  outcome_rr: number | null;
};

const createSchema = (database: DatabaseSync) => {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,
      strategy_config_id TEXT NOT NULL,
      instrument TEXT NOT NULL,
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      frame_count INTEGER,
      error_message TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS backtest_signals (
      id TEXT PRIMARY KEY,
      backtest_run_id TEXT NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
      decision_candle_time TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
      entry_price REAL NOT NULL,
      invalidation_price REAL NOT NULL,
      stop_price REAL NOT NULL,
      target_price REAL NOT NULL,
      estimated_reward_risk REAL NOT NULL,
      score INTEGER,
      grade TEXT,
      local_hour_of_day INTEGER NOT NULL,
      local_weekday INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'filled', 'cancelled', 'win', 'loss', 'unresolved')),
      filled_at TEXT,
      resolved_at TEXT,
      outcome_rr REAL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS backtest_signals_run_idx ON backtest_signals(backtest_run_id);
  `);
};

const toStoredRun = (row: BacktestRunRow): StoredBacktestRun => ({
  id: row.id,
  strategyConfigId: row.strategy_config_id,
  instrument: row.instrument,
  rangeStart: row.range_start,
  rangeEnd: row.range_end,
  status: row.status,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  frameCount: row.frame_count,
  errorMessage: row.error_message,
});

const toStoredSignal = (row: BacktestSignalRow): StoredBacktestSignal => ({
  id: row.id,
  backtestRunId: row.backtest_run_id,
  decisionCandleTime: row.decision_candle_time,
  direction: row.direction,
  entryPrice: row.entry_price,
  invalidationPrice: row.invalidation_price,
  stopPrice: row.stop_price,
  targetPrice: row.target_price,
  estimatedRewardRisk: row.estimated_reward_risk,
  score: row.score,
  grade: row.grade,
  localHourOfDay: row.local_hour_of_day,
  localWeekday: row.local_weekday,
  status: row.status,
  filledAt: row.filled_at,
  resolvedAt: row.resolved_at,
  outcomeRR: row.outcome_rr,
});

export class BacktestRepository {
  private readonly database: DatabaseSync;

  public constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    createSchema(this.database);
  }

  public createRun(run: BacktestRunInput): StoredBacktestRun {
    const startedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO backtest_runs (id, strategy_config_id, instrument, range_start, range_end, status, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(run.id, run.strategyConfigId, run.instrument, run.rangeStart, run.rangeEnd, startedAt);
    return { ...run, status: 'running', startedAt, completedAt: null, frameCount: null, errorMessage: null };
  }

  public completeRun(id: string, frameCount: number) {
    this.database
      .prepare(`UPDATE backtest_runs SET status = 'completed', completed_at = ?, frame_count = ? WHERE id = ?`)
      .run(new Date().toISOString(), frameCount, id);
  }

  public failRun(id: string, errorMessage: string) {
    this.database
      .prepare(`UPDATE backtest_runs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?`)
      .run(new Date().toISOString(), errorMessage, id);
  }

  public insertSignal(signal: BacktestSignalInput) {
    this.database
      .prepare(
        `INSERT INTO backtest_signals (
          id, backtest_run_id, decision_candle_time, direction, entry_price, invalidation_price, stop_price, target_price,
          estimated_reward_risk, score, grade, local_hour_of_day, local_weekday, status, filled_at, resolved_at, outcome_rr
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        signal.id,
        signal.backtestRunId,
        signal.decisionCandleTime,
        signal.direction,
        signal.entryPrice,
        signal.invalidationPrice,
        signal.stopPrice,
        signal.targetPrice,
        signal.estimatedRewardRisk,
        signal.score,
        signal.grade,
        signal.localHourOfDay,
        signal.localWeekday,
        signal.status,
        signal.filledAt,
        signal.resolvedAt,
        signal.outcomeRR,
      );
  }

  public listRuns(strategyConfigId?: string): StoredBacktestRun[] {
    const rows = strategyConfigId
      ? (this.database.prepare('SELECT * FROM backtest_runs WHERE strategy_config_id = ? ORDER BY started_at DESC').all(strategyConfigId) as BacktestRunRow[])
      : (this.database.prepare('SELECT * FROM backtest_runs ORDER BY started_at DESC').all() as BacktestRunRow[]);
    return rows.map(toStoredRun);
  }

  public getRun(id: string): StoredBacktestRun | null {
    const row = this.database.prepare('SELECT * FROM backtest_runs WHERE id = ?').get(id) as BacktestRunRow | undefined;
    return row ? toStoredRun(row) : null;
  }

  public listSignals(backtestRunId: string): StoredBacktestSignal[] {
    const rows = this.database
      .prepare('SELECT * FROM backtest_signals WHERE backtest_run_id = ? ORDER BY decision_candle_time ASC')
      .all(backtestRunId) as BacktestSignalRow[];
    return rows.map(toStoredSignal);
  }

  public close() {
    this.database.close();
  }
}
