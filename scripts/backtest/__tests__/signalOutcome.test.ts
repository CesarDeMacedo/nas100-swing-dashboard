// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { OandaCandle } from '../../../src/providers/oanda/types';
import { evaluateSignalOutcome, localHourAndWeekday } from '../signalOutcome';

const candle = (time: string, open: number, high: number, low: number, close: number): OandaCandle => ({
  time, open, high, low, close, isClosed: true, volume: 100, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20',
});

// A long signal: entry 110 (breakout above confirmation high), invalidation 95, stop 92, target 130.
const LONG = { entryPrice: 110, invalidationPrice: 95, stopPrice: 92, targetPrice: 130 } as const;

describe('evaluateSignalOutcome', () => {
  it('fills on the candle that reaches entryPrice, then resolves as a win on the candle that reaches target', () => {
    const candles = [
      candle('t1', 100, 105, 98, 102), // no touch
      candle('t2', 102, 112, 100, 111), // fills entry (high >= 110)
      candle('t3', 111, 120, 108, 118), // neither stop nor target yet
      candle('t4', 118, 132, 117, 129), // target hit (high >= 130)
    ];
    const outcome = evaluateSignalOutcome(candles, 'long', LONG.entryPrice, LONG.invalidationPrice, LONG.stopPrice, LONG.targetPrice);
    expect(outcome.status).toBe('win');
    expect(outcome.filledAt).toBe('t2');
    expect(outcome.resolvedAt).toBe('t4');
    expect(outcome.outcomeRR).toBeCloseTo((130 - 110) / (110 - 92), 5);
  });

  it('fills, then resolves as a loss when the stop is hit before the target', () => {
    const candles = [
      candle('t1', 102, 112, 100, 111), // fills entry
      candle('t2', 111, 113, 90, 91), // stop hit (low <= 92)
    ];
    const outcome = evaluateSignalOutcome(candles, 'long', LONG.entryPrice, LONG.invalidationPrice, LONG.stopPrice, LONG.targetPrice);
    expect(outcome).toMatchObject({ status: 'loss', filledAt: 't1', resolvedAt: 't2', outcomeRR: -1 });
  });

  it('is cancelled when invalidation is reached before the entry ever fills', () => {
    const candles = [
      candle('t1', 100, 104, 98, 101),
      candle('t2', 101, 103, 90, 92), // invalidation hit (low <= 95) before entry (high never reached 110)
    ];
    const outcome = evaluateSignalOutcome(candles, 'long', LONG.entryPrice, LONG.invalidationPrice, LONG.stopPrice, LONG.targetPrice);
    expect(outcome).toMatchObject({ status: 'cancelled', filledAt: null, resolvedAt: 't2', outcomeRR: null });
  });

  it('tie-break: a candle spanning both entry and invalidation is cancelled, not filled', () => {
    const candles = [candle('t1', 100, 111, 90, 105)]; // high >= 110 (entry) AND low <= 95 (invalidation) in the same candle
    const outcome = evaluateSignalOutcome(candles, 'long', LONG.entryPrice, LONG.invalidationPrice, LONG.stopPrice, LONG.targetPrice);
    expect(outcome.status).toBe('cancelled');
  });

  it('tie-break: a candle spanning both stop and target after fill is a loss, not a win', () => {
    const candles = [
      candle('t1', 102, 112, 100, 111), // fills entry
      candle('t2', 111, 131, 91, 100), // high >= 130 (target) AND low <= 92 (stop) in the same candle
    ];
    const outcome = evaluateSignalOutcome(candles, 'long', LONG.entryPrice, LONG.invalidationPrice, LONG.stopPrice, LONG.targetPrice);
    expect(outcome.status).toBe('loss');
  });

  it('is unresolved when data runs out before the entry ever fills or invalidates', () => {
    const candles = [candle('t1', 100, 104, 98, 101)];
    const outcome = evaluateSignalOutcome(candles, 'long', LONG.entryPrice, LONG.invalidationPrice, LONG.stopPrice, LONG.targetPrice);
    expect(outcome).toMatchObject({ status: 'unresolved', filledAt: null, resolvedAt: null, outcomeRR: null });
  });

  it('is unresolved when data runs out after filling but before stop/target resolves', () => {
    const candles = [candle('t1', 102, 112, 100, 111)];
    const outcome = evaluateSignalOutcome(candles, 'long', LONG.entryPrice, LONG.invalidationPrice, LONG.stopPrice, LONG.targetPrice);
    expect(outcome).toMatchObject({ status: 'unresolved', filledAt: 't1', resolvedAt: null, outcomeRR: null });
  });

  it('mirrors the same state machine for short signals with inverted price comparisons', () => {
    // short: entry 90 (breakout below), invalidation 105, stop 108, target 70
    const candles = [
      candle('t1', 100, 102, 89, 91), // fills entry (low <= 90)
      candle('t2', 91, 92, 69, 70), // target hit (low <= 70)
    ];
    const outcome = evaluateSignalOutcome(candles, 'short', 90, 105, 108, 70);
    expect(outcome.status).toBe('win');
    expect(outcome.outcomeRR).toBeCloseTo((90 - 70) / (108 - 90), 5);
  });
});

describe('localHourAndWeekday', () => {
  it('converts a UTC instant to its America/Toronto local hour and weekday (0=Sun..6=Sat)', () => {
    // 2026-06-15 is a Monday; 17:01 UTC = 13:01 EDT.
    expect(localHourAndWeekday('2026-06-15T17:01:00.000Z')).toEqual({ hour: 13, weekday: 1 });
    // 2026-06-14 is a Sunday.
    expect(localHourAndWeekday('2026-06-15T01:01:00.000Z').weekday).toBe(0);
  });
});
