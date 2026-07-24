// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { currentAnalysisSource, openCandleDatasetFixture } from '../domain/fixtures';
import { AnalysisRepository } from '../persistence/analysisRepository';
import { runSyntheticFixtureAnalysis } from './fixtureRun';

/**
 * Direct unit coverage for runSyntheticFixtureAnalysis, complementing the indirect
 * exercise it gets through server.test.ts (HTTP layer) and fixtureScheduler.test.ts
 * (scheduler layer). Mirrors the outcome-branch shape of oandaRun.test.ts's coverage
 * of the equivalent OANDA path, including the failed-run branch neither of the
 * indirect callers happens to trigger.
 */
const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

const freshRepository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-fixture-run-'));
  directories.push(directory);
  return new AnalysisRepository(join(directory, 'history.sqlite'));
};

describe('runSyntheticFixtureAnalysis', () => {
  it('defaults to a user-triggered run and honors an explicit scheduler trigger', () => {
    const repository = freshRepository();

    const manual = runSyntheticFixtureAnalysis(repository);
    expect(manual.run.triggeredBy).toBe('user');
    repository.close();

    const schedulerRepository = freshRepository();
    const scheduled = runSyntheticFixtureAnalysis(schedulerRepository, undefined, 'scheduler');
    expect(scheduled.run.triggeredBy).toBe('scheduler');
    schedulerRepository.close();
  });

  it('creates a completed run and returns the existing one on repeat', () => {
    const repository = freshRepository();

    const first = runSyntheticFixtureAnalysis(repository);
    const second = runSyntheticFixtureAnalysis(repository);

    expect(first.outcome).toBe('created');
    expect(first.report).not.toBeNull();
    expect(second.outcome).toBe('already_exists');
    expect(second.run.runKey).toBe(first.run.runKey);
    expect(repository.listHistory()).toHaveLength(1);
    repository.close();
  });

  it('blocks and dedupes an open synthetic candle without producing a report', () => {
    const repository = freshRepository();

    const first = runSyntheticFixtureAnalysis(repository, { analysis: currentAnalysisSource, candles: openCandleDatasetFixture });
    const second = runSyntheticFixtureAnalysis(repository, { analysis: currentAnalysisSource, candles: openCandleDatasetFixture });

    expect(first.outcome).toBe('blocked');
    expect(first.report).toBeNull();
    expect(first.run.status).toBe('BLOCKED');
    expect(second.outcome).toBe('already_exists');
    expect(second.run.runKey).toBe(first.run.runKey);
    repository.close();
  });

  it('records a failed run without throwing when the source fixtures fail schema validation', () => {
    const repository = freshRepository();

    const result = runSyntheticFixtureAnalysis(repository, { analysis: { not: 'a valid analysis report' }, candles: openCandleDatasetFixture });

    expect(result.outcome).toBe('failed');
    expect(result.report).toBeNull();
    expect(result.run.status).toBe('FAILED');
    expect(result.run.errorMessage).toBeTruthy();
    repository.close();
  });

  it('derives a stable, content-based run key rather than one tied to wall-clock time', () => {
    const repository = freshRepository();
    const result = runSyntheticFixtureAnalysis(repository);

    expect(result.report).not.toBeNull();
    if (!result.report) return;
    expect(result.run.runKey).toBe(
      [result.report.instrument, result.report.timeframe, result.report.sourceCandleTime, result.report.reportVersion, 'mock-display-1.0.0', 'fixture'].join(':'),
    );
    repository.close();
  });
});
