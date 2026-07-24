import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { SwingReport } from '../application/buildSwingReport';

export const PERSISTENCE_SCHEMA_VERSION = 2;

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
};

type ReportRow = {
  id: string;
  report_json: string;
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

  const columns = database.prepare('PRAGMA table_info(analysis_runs)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'triggered_by')) {
    database.exec(`
      ALTER TABLE analysis_runs ADD COLUMN triggered_by TEXT CHECK (triggered_by IN ('user', 'scheduler') OR triggered_by IS NULL);
    `);
  }

  database.exec(`
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
            id, run_key, started_at, completed_at, status, source, error_message, report_id, persisted_at, triggered_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          id, run_key, started_at, completed_at, status, source, error_message, report_id, persisted_at, triggered_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
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
      );

    return { ...run, errorMessage: run.errorMessage ?? null, triggeredBy: run.triggeredBy ?? null, reportId: null, persistedAt };
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

  public close() {
    this.database.close();
  }
}

const reportIdFor = (run: AnalysisRunInput, report: SwingReport) =>
  `${run.id}:${report.reportVersion}`;
