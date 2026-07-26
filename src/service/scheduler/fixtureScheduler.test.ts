// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentAnalysisSource, openCandleDatasetFixture } from '../../domain/fixtures';
import { AnalysisRepository } from '../../persistence/analysisRepository';
import { runSyntheticFixtureAnalysis } from '../fixtureRun';
import { FixtureScheduler } from './fixtureScheduler';
import { getTorontoScheduleSlot, parseSchedulerEnabled, parseSchedulerProvider } from './torontoSchedule';

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
    // 21:01, kept from the original coverage (falls on a Sunday, valid for that slot).
    expect(getTorontoScheduleSlot(new Date('2026-03-09T01:01:00.000Z'))?.key).toBe('2026-03-08:21:01');
    expect(getTorontoScheduleSlot(new Date('2026-11-02T02:01:00.000Z'))?.key).toBe('2026-11-01:21:01');

    // Friday immediately before spring-forward (2026-03-06, still EST) — all 5 weekday slots.
    expect(getTorontoScheduleSlot(new Date('2026-03-06T06:01:00.000Z'))?.key).toBe('2026-03-06:01:01');
    expect(getTorontoScheduleSlot(new Date('2026-03-06T10:01:00.000Z'))?.key).toBe('2026-03-06:05:01');
    expect(getTorontoScheduleSlot(new Date('2026-03-06T14:01:00.000Z'))?.key).toBe('2026-03-06:09:01');
    expect(getTorontoScheduleSlot(new Date('2026-03-06T18:01:00.000Z'))?.key).toBe('2026-03-06:13:01');
    expect(getTorontoScheduleSlot(new Date('2026-03-06T22:01:00.000Z'))?.key).toBe('2026-03-06:17:01');

    // Monday immediately after spring-forward (2026-03-09, now EDT).
    expect(getTorontoScheduleSlot(new Date('2026-03-09T05:01:00.000Z'))?.key).toBe('2026-03-09:01:01');
    expect(getTorontoScheduleSlot(new Date('2026-03-09T09:01:00.000Z'))?.key).toBe('2026-03-09:05:01');
    expect(getTorontoScheduleSlot(new Date('2026-03-09T13:01:00.000Z'))?.key).toBe('2026-03-09:09:01');
    expect(getTorontoScheduleSlot(new Date('2026-03-09T17:01:00.000Z'))?.key).toBe('2026-03-09:13:01');
    expect(getTorontoScheduleSlot(new Date('2026-03-09T21:01:00.000Z'))?.key).toBe('2026-03-09:17:01');

    // Friday immediately before fall-back (2026-10-30, still EDT).
    expect(getTorontoScheduleSlot(new Date('2026-10-30T05:01:00.000Z'))?.key).toBe('2026-10-30:01:01');
    expect(getTorontoScheduleSlot(new Date('2026-10-30T09:01:00.000Z'))?.key).toBe('2026-10-30:05:01');
    expect(getTorontoScheduleSlot(new Date('2026-10-30T13:01:00.000Z'))?.key).toBe('2026-10-30:09:01');
    expect(getTorontoScheduleSlot(new Date('2026-10-30T17:01:00.000Z'))?.key).toBe('2026-10-30:13:01');
    expect(getTorontoScheduleSlot(new Date('2026-10-30T21:01:00.000Z'))?.key).toBe('2026-10-30:17:01');

    // Monday immediately after fall-back (2026-11-02, now EST).
    expect(getTorontoScheduleSlot(new Date('2026-11-02T06:01:00.000Z'))?.key).toBe('2026-11-02:01:01');
    expect(getTorontoScheduleSlot(new Date('2026-11-02T10:01:00.000Z'))?.key).toBe('2026-11-02:05:01');
    expect(getTorontoScheduleSlot(new Date('2026-11-02T14:01:00.000Z'))?.key).toBe('2026-11-02:09:01');
    expect(getTorontoScheduleSlot(new Date('2026-11-02T18:01:00.000Z'))?.key).toBe('2026-11-02:13:01');
    expect(getTorontoScheduleSlot(new Date('2026-11-02T22:01:00.000Z'))?.key).toBe('2026-11-02:17:01');
  });

  it('parses scheduler configuration safely', () => {
    expect(parseSchedulerEnabled(undefined)).toBe(true);
    expect(parseSchedulerEnabled('true')).toBe(true);
    expect(parseSchedulerEnabled('false')).toBe(false);
    expect(() => parseSchedulerEnabled('yes')).toThrow('NAS100_DASHBOARD_SCHEDULER_ENABLED');
    expect(parseSchedulerProvider(undefined)).toBe('fixture');
    expect(parseSchedulerProvider('oanda')).toBe('oanda');
    expect(() => parseSchedulerProvider('invalid')).toThrow('NAS100_DASHBOARD_SCHEDULER_PROVIDER');
  });
});

describe('FixtureScheduler', () => {
  it('reports selected provider and safe OANDA failures', async () => {
    const scheduler = new FixtureScheduler({ enabled: true, provider: 'oanda', run: async () => ({ outcome: 'failed', runKey: 'oanda:request-failed', message: 'Scheduled OANDA analysis could not be completed.' }), log: () => undefined });
    await scheduler.evaluate(weekdayAfternoon);
    expect(scheduler.status()).toMatchObject({ configuredProvider: 'oanda', activeProvider: 'oanda', lastRunProvider: 'oanda', lastFailureSummary: 'Scheduled OANDA analysis could not be completed.' });
  });
  it('counts consecutive failures across slots and resets on the next non-failed outcome', async () => {
    let outcome: 'failed' | 'created' = 'failed';
    const scheduler = new FixtureScheduler({ enabled: true, run: async () => ({ outcome, runKey: 'fixture-key' }), log: () => undefined });

    await scheduler.evaluate(weekdayAfternoon);
    expect(scheduler.status().consecutiveFailures).toBe(1);
    await scheduler.evaluate(weekdayEvening);
    expect(scheduler.status().consecutiveFailures).toBe(2);
    await scheduler.evaluate(sundayEvening);
    expect(scheduler.status().consecutiveFailures).toBe(3);

    outcome = 'created';
    await scheduler.evaluate(new Date('2026-06-22T17:01:00.000Z'));
    expect(scheduler.status().consecutiveFailures).toBe(0);
  });

  it('triggers each in-memory Toronto slot once', async () => {
    const run = vi.fn(async () => ({ outcome: 'created' as const, runKey: 'fixture-key' }));
    const scheduler = new FixtureScheduler({ enabled: true, run, log: () => undefined });

    await Promise.all([scheduler.evaluate(weekdayAfternoon), scheduler.evaluate(weekdayAfternoon)]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.status().lastEvaluatedSlot).toBe('2026-06-15:13:01');
  });

  it('calls notify with the result of every evaluated slot, including thrown-error failures', async () => {
    // Filtering out 'already_exists' (nothing changed, no notification wanted) is
    // notifySchedulerOutcome's job (see schedulerNotifications.test.ts) — the scheduler
    // itself just reports what happened for every slot it evaluates.
    const notify = vi.fn();
    let outcome: 'created' | 'blocked' | 'already_exists' = 'created';
    const scheduler = new FixtureScheduler({ enabled: true, run: async () => ({ outcome, runKey: 'fixture-key' }), log: () => undefined, notify });

    await scheduler.evaluate(weekdayAfternoon);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'created' }));

    outcome = 'blocked';
    await scheduler.evaluate(weekdayEvening);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'blocked' }));

    outcome = 'already_exists';
    await scheduler.evaluate(sundayEvening);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'already_exists' }));

    const throwingScheduler = new FixtureScheduler({ enabled: true, run: async () => { throw new Error('boom'); }, log: () => undefined, notify });
    await throwingScheduler.evaluate(weekdayAfternoon);
    expect(notify).toHaveBeenCalledTimes(4);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'failed' }));
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
