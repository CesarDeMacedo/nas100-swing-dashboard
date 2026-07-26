import { describe, expect, it } from 'vitest';

import type { Candle } from '../schemas/candles';
import { calculateMarketLevels, MARKET_LEVEL_INVALIDATION_ATR_BUFFER, MARKET_LEVEL_MAX_ZONES, MARKET_LEVEL_ZONE_ATR_BUFFER } from './marketLevels';

const candles = (): Candle[] => Array.from({ length: 22 }, (_, index) => {
  const time = new Date(Date.UTC(2026, 6, 1, index * 4)).toISOString();
  const low = index === 5 ? 90 : 98;
  const high = index === 12 ? 120 : 108;
  return { time, open: 102, high, low, close: index === 21 ? 105 : 103, isClosed: index !== 21, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20' };
});

describe('deterministic H4 market levels', () => {
  it('uses completed confirmed swings only and leaves input unchanged', () => {
    const input = candles();
    const before = structuredClone(input);
    const result = calculateMarketLevels(input, 'long');

    expect(input).toEqual(before);
    expect(result.supportZones[0]).toMatchObject({ type: 'SUPPORT', lockedByUser: false });
    expect(result.resistanceZones[0]).toMatchObject({ type: 'RESISTANCE', lockedByUser: false });
    expect(JSON.stringify(result)).not.toContain('2026-07-04T12:00:00.000Z');
  });

  it('applies centralized ATR widths, sorts zones, and deduplicates overlapping swings', () => {
    const result = calculateMarketLevels(candles(), 'long');
    const support = result.supportZones[0]!;

    expect((support.high - support.low) / result.atrUsed!).toBeCloseTo(MARKET_LEVEL_ZONE_ATR_BUFFER * 2);
    expect(result.supportZones.map((item) => (item.low + item.high) / 2)).toEqual([...result.supportZones.map((item) => (item.low + item.high) / 2)].sort((left, right) => right - left));
    expect(result.resistanceZones.map((item) => (item.low + item.high) / 2)).toEqual([...result.resistanceZones.map((item) => (item.low + item.high) / 2)].sort((left, right) => left - right));
  });

  it('calculates directional preferred entries and informational invalidation candidates', () => {
    const long = calculateMarketLevels(candles(), 'long');
    const short = calculateMarketLevels(candles(), 'short');

    expect(long.preferredEntryZone).toMatchObject({ type: 'ENTRY' });
    expect(long.invalidationCandidate).toBeCloseTo(long.preferredEntryZone!.low - long.atrUsed! * MARKET_LEVEL_INVALIDATION_ATR_BUFFER);
    expect(short.preferredEntryZone).toMatchObject({ type: 'ENTRY' });
    expect(short.invalidationCandidate).toBeCloseTo(short.preferredEntryZone!.high + short.atrUsed! * MARKET_LEVEL_INVALIDATION_ATR_BUFFER);
    expect(calculateMarketLevels(candles(), 'none')).toMatchObject({ preferredEntryZone: null, invalidationCandidate: null });
  });

  it('fails safely with insufficient history or missing ATR', () => {
    expect(calculateMarketLevels(candles().slice(0, 5), 'long')).toMatchObject({ supportZones: [], resistanceZones: [], preferredEntryZone: null });
    const flat = candles().map((candle) => ({ ...candle, high: 100, low: 100, open: 100, close: 100 }));
    expect(calculateMarketLevels(flat, 'long')).toMatchObject({ supportZones: [], resistanceZones: [], preferredEntryZone: null, atrUsed: null });
  });
});

describe('market level zone recency cap (regression: unbounded history could surface a stale, wildly-distant swing as an invalidation candidate)', () => {
  const PLATEAU = 30000;
  const PLATEAU_SPAN = 10;
  const plateauCandle = (t: number): Candle => ({
    time: new Date(Date.UTC(2018, 0, 1, t * 4)).toISOString(),
    open: PLATEAU + PLATEAU_SPAN / 2, high: PLATEAU + PLATEAU_SPAN, low: PLATEAU, close: PLATEAU + PLATEAU_SPAN / 2,
    isClosed: true, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20',
  });

  /** Builds a candle series with one swing far from `PLATEAU` (mimicking an old, irrelevant
   * structural level from years ago) and `MARKET_LEVEL_MAX_ZONES` swings close to it (recent,
   * structurally relevant levels), preceded by `leadingFlatCandles` swing-free candles to
   * simulate however much extra history a caller (a multi-year backtest replay vs. a live
   * ~250-candle fetch) happens to load. `settleCandles` between the far swing and the near
   * cluster lets ATR14 (Wilder-smoothed, so a single huge true-range candle decays but never
   * fully vanishes) return to a small, local-volatility baseline before the near swings are
   * built — otherwise the far swing's own gap would inflate ATR enough to make the (deliberately
   * tight) near-level spacing collide with `deduplicate`'s ATR-scaled merge threshold. */
  const buildSeries = (direction: 'long' | 'short', leadingFlatCandles: number) => {
    const settleCandles = 100;
    const farLevel = direction === 'long' ? PLATEAU - 25000 : PLATEAU + 25000; // ~ real bug's 2018-era vs. current NAS100 scale
    // The 'short' (resistance) swing candle's `high` is the level itself, so it must clear the
    // plateau candle's own `high` (PLATEAU + PLATEAU_SPAN) to register as a strictly higher
    // local peak — hence the extra +PLATEAU_SPAN offset on that side only.
    const nearLevels = direction === 'long'
      ? [PLATEAU - 70, PLATEAU - 55, PLATEAU - 40, PLATEAU - 25, PLATEAU - 10]
      : [PLATEAU + PLATEAU_SPAN + 70, PLATEAU + PLATEAU_SPAN + 55, PLATEAU + PLATEAU_SPAN + 40, PLATEAU + PLATEAU_SPAN + 25, PLATEAU + PLATEAU_SPAN + 10];

    let t = 0;
    const candles: Candle[] = [];
    const pushPlateau = () => { candles.push(plateauCandle(t)); t += 1; };
    const pushSwing = (level: number) => {
      const swing = direction === 'long'
        ? { open: level + 1, high: level + 2, low: level, close: level + 1 }
        : { open: level - 1, high: level, low: level - 2, close: level - 1 };
      candles.push({ time: new Date(Date.UTC(2018, 0, 1, t * 4)).toISOString(), ...swing, isClosed: true, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20' });
      t += 1;
    };

    for (let i = 0; i < leadingFlatCandles; i += 1) pushPlateau();
    pushPlateau();
    pushPlateau();

    pushSwing(farLevel);
    const farSwingId = `oanda-h4-${direction === 'long' ? 'support' : 'resistance'}-${candles.at(-1)!.time}`;
    for (let i = 0; i < settleCandles; i += 1) pushPlateau();
    pushPlateau();
    pushPlateau();

    for (const level of nearLevels) {
      pushSwing(level);
      pushPlateau();
      pushPlateau();
    }

    return { candles, farLevel, farSwingId, nearLevels };
  };

  it.each([
    { label: 'short window (production-scale, ~250 live candles)', leadingFlatCandles: 20 },
    { label: 'long window (backtest-scale, years of cached candles)', leadingFlatCandles: 2000 },
  ])('caps supportZones to the $MARKET_LEVEL_MAX_ZONES nearest-to-price swings and drops a distant one — $label', ({ leadingFlatCandles }) => {
    const { candles, farSwingId, nearLevels } = buildSeries('long', leadingFlatCandles);
    const result = calculateMarketLevels(candles, 'long');

    expect(result.supportZones).toHaveLength(MARKET_LEVEL_MAX_ZONES);
    expect(result.supportZones.some((zone) => zone.id === farSwingId)).toBe(false);
    expect(result.invalidationCandidate).toBeGreaterThan(Math.min(...nearLevels) - 500);
  });

  it.each([
    { label: 'short window (production-scale, ~250 live candles)', leadingFlatCandles: 20 },
    { label: 'long window (backtest-scale, years of cached candles)', leadingFlatCandles: 2000 },
  ])('caps resistanceZones to the $MARKET_LEVEL_MAX_ZONES nearest-to-price swings and drops a distant one — $label', ({ leadingFlatCandles }) => {
    const { candles, farSwingId, nearLevels } = buildSeries('short', leadingFlatCandles);
    const result = calculateMarketLevels(candles, 'short');

    expect(result.resistanceZones).toHaveLength(MARKET_LEVEL_MAX_ZONES);
    expect(result.resistanceZones.some((zone) => zone.id === farSwingId)).toBe(false);
    expect(result.invalidationCandidate).toBeLessThan(Math.max(...nearLevels) + 500);
  });
});
