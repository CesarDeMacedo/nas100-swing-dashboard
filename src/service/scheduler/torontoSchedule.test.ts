import { getTorontoScheduleSlot, parseSchedulerEnabled, parseSchedulerProvider } from './torontoSchedule';

/**
 * Dedicated coverage for the Toronto slot matcher and env parsers. Complements the
 * higher-level scheduler-lifecycle tests in fixtureScheduler.test.ts (which exercise
 * these functions incidentally) with direct boundary coverage: the Saturday and
 * Sunday-13:01 exclusions the business rule depends on, and off-by-a-minute times.
 */
describe('getTorontoScheduleSlot', () => {
  it('matches every weekday at 13:01 America/Toronto', () => {
    expect(getTorontoScheduleSlot(new Date('2026-06-15T17:01:00.000Z'))).toMatchObject({ weekday: 'Monday', time: '13:01' });
    expect(getTorontoScheduleSlot(new Date('2026-06-19T17:01:00.000Z'))).toMatchObject({ weekday: 'Friday', time: '13:01' });
  });

  it('excludes Saturday 13:01 and Sunday 13:01', () => {
    expect(getTorontoScheduleSlot(new Date('2026-06-20T17:01:00.000Z'))).toBeNull();
    expect(getTorontoScheduleSlot(new Date('2026-06-14T17:01:00.000Z'))).toBeNull();
  });

  it('matches Monday-Friday and Sunday at 21:01, but excludes Saturday 21:01', () => {
    expect(getTorontoScheduleSlot(new Date('2026-06-16T01:01:00.000Z'))).toMatchObject({ weekday: 'Monday', time: '21:01' });
    expect(getTorontoScheduleSlot(new Date('2026-06-15T01:01:00.000Z'))).toMatchObject({ weekday: 'Sunday', time: '21:01' });
    expect(getTorontoScheduleSlot(new Date('2026-06-21T01:01:00.000Z'))).toBeNull();
  });

  it('rejects times one minute before or after either slot', () => {
    expect(getTorontoScheduleSlot(new Date('2026-06-15T17:00:00.000Z'))).toBeNull();
    expect(getTorontoScheduleSlot(new Date('2026-06-15T17:02:00.000Z'))).toBeNull();
    expect(getTorontoScheduleSlot(new Date('2026-06-16T01:00:00.000Z'))).toBeNull();
    expect(getTorontoScheduleSlot(new Date('2026-06-16T01:02:00.000Z'))).toBeNull();
  });

  it('produces a stable localDate/time key usable for slot dedup', () => {
    const slot = getTorontoScheduleSlot(new Date('2026-06-15T17:01:00.000Z'));
    expect(slot).toMatchObject({ key: '2026-06-15:13:01', localDate: '2026-06-15' });
  });

  it('uses Toronto daylight-saving offsets across both spring-forward and fall-back transitions', () => {
    expect(getTorontoScheduleSlot(new Date('2026-03-09T01:01:00.000Z'))?.key).toBe('2026-03-08:21:01');
    expect(getTorontoScheduleSlot(new Date('2026-11-02T02:01:00.000Z'))?.key).toBe('2026-11-01:21:01');
  });
});

describe('parseSchedulerEnabled', () => {
  it('defaults to enabled when unset', () => {
    expect(parseSchedulerEnabled(undefined)).toBe(true);
  });

  it('accepts explicit true/false', () => {
    expect(parseSchedulerEnabled('true')).toBe(true);
    expect(parseSchedulerEnabled('false')).toBe(false);
  });

  it('throws a descriptive error for any other value', () => {
    expect(() => parseSchedulerEnabled('1')).toThrow('NAS100_DASHBOARD_SCHEDULER_ENABLED must be "true" or "false".');
    expect(() => parseSchedulerEnabled('')).toThrow('NAS100_DASHBOARD_SCHEDULER_ENABLED');
  });
});

describe('parseSchedulerProvider', () => {
  it('defaults to fixture when unset', () => {
    expect(parseSchedulerProvider(undefined)).toBe('fixture');
  });

  it('accepts explicit fixture/oanda', () => {
    expect(parseSchedulerProvider('fixture')).toBe('fixture');
    expect(parseSchedulerProvider('oanda')).toBe('oanda');
  });

  it('throws a descriptive error for any other value', () => {
    expect(() => parseSchedulerProvider('live')).toThrow('NAS100_DASHBOARD_SCHEDULER_PROVIDER must be "fixture" or "oanda".');
  });
});
