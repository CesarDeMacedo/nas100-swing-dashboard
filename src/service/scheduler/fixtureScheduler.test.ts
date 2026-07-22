// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentAnalysisSource, openCandleDatasetFixture } from '../../domain/fixtures';
import { AnalysisRepository } from '../../persistence/analysisRepository';
import { runSyntheticFixtureAnalysis } from '../fixtureRun';
import { FixtureScheduler } from './fixtureScheduler';
import { getTorontoScheduleSlot, parseSchedulerEnabled } from './torontoSchedule';

const weekdayAfternoon = new Date('2026-06-15T17:01:00.000Z');
const weekdayEvening = new Date('2026-06-16T01:01:00.000Z');
const sundayEvening = new Date('2026-06-15T01:01:00.000Z');

const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('Toronto schedule slots', () => {
  it('matches approved weekday and Sunday evening slots only', () => {
    expect(getTorontoScheduleSlot(weekdayAfternoon)?.time).toBe('13:01');
    expect(getTorontoScheduleSlot(weekdayEvening)?.time).toBe('21:01');
    expect(getTorontoScheduleSlot(sundayEvening)?.weekday).toBe('Sunday');
    expect(getTorontoScheduleSlot(new Date('2026-06-14T17:01:00.000Z'))).toBeNull();
    expect(getTorontoScheduleSlot(new Date('2026-06-20T17:01:00.000Z'))).toBeNull();
    expect(getTorontoScheduleSlot(new Date('2026-06-15T17:00:00.000Z'))).toBeNull();
  });

  it('uses Toronto daylight-saving offsets rather than computer local time', () => {
    expect(getTorontoScheduleSlot(new Date('2026-03-09T01:01:00.000Z'))?.key).toBe('2026-03-08:21:01');
    expect(getTorontoScheduleSlot(new Date('2026-11-02T02:01:00.000Z'))?.key).toBe('2026-11-01:21:01');
  });

  it('parses scheduler configuration safely', () => {
    expect(parseSchedulerEnabled(undefined)).toBe(true);
    expect(parseSchedulerEnabled('true')).toBe(true);
    expect(parseSchedulerEnabled('false')).toBe(false);
    expect(() => parseSchedulerEnabled('yes')).toThrow('NAS100_DASHBOARD_SCHEDULER_ENABLED');
  });
});

describe('FixtureScheduler', () => {
  it('triggers each in-memory Toronto slot once', async () => {
    const run = vi.fn(async () => ({ outcome: 'created' as const, runKey: 'fixture-key' }));
    const scheduler = new FixtureScheduler({ enabled: true, run, log: () => undefined });

    await Promise.all([scheduler.evaluate(weekdayAfternoon), scheduler.evaluate(weekdayAfternoon)]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.status().lastEvaluatedSlot).toBe('2026-06-15:13:01');
  });

  it('can be disabled and stops timer lifecycle cleanly', () => {
    const scheduler = new FixtureScheduler({ enabled: false, run: async () => ({ outcome: 'created', runKey: 'fixture-key' }), log: () => undefined });
    scheduler.start();
    expect(scheduler.status().running).toBe(false);
    scheduler.stop();
    expect(scheduler.status().running).toBe(false);
  });

  it('relies on persisted fixture run keys across scheduler restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nas100-scheduler-'));
    directories.push(directory);
    const repository = new AnalysisRepository(join(directory, 'history.sqlite'));
    const run = async () => {
      const result = runSyntheticFixtureAnalysis(repository);
      return { outcome: result.outcome, runKey: result.run.runKey, message: result.message };
    };
    const firstScheduler = new FixtureScheduler({ enabled: true, run, log: () => undefined });
    const secondScheduler = new FixtureScheduler({ enabled: true, run, log: () => undefined });

    expect((await firstScheduler.evaluate(weekdayAfternoon))?.outcome).toBe('created');
    expect((await secondScheduler.evaluate(weekdayAfternoon))?.outcome).toBe('already_exists');
    expect(repository.listHistory()).toHaveLength(1);
    repository.close();
  });

  it('records a blocked run instead of a completed report for an open synthetic candle', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nas100-scheduler-'));
    directories.push(directory);
    const repository = new AnalysisRepository(join(directory, 'history.sqlite'));
    const result = runSyntheticFixtureAnalysis(repository, { analysis: currentAnalysisSource, candles: openCandleDatasetFixture });

    expect(result.outcome).toBe('blocked');
    expect(result.report).toBeNull();
    expect(result.run.status).toBe('BLOCKED');
    repository.close();
  });
});
