import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildDashboardState } from '../application/buildDashboardState';
import { buildSwingReport } from '../application/buildSwingReport';
import { parseAnalysis } from '../domain/analysis';
import { parseCandleDataset } from '../domain/candles';
import { currentAnalysisSource, currentCandleDatasetSource } from '../domain/fixtures';
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
});
