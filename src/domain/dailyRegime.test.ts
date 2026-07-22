import type { Candle } from '../schemas/candles';
import { calculateLatestIndicatorSnapshot } from './indicators';
import {
  calculateEmaSlope,
  classifyDailyRegime,
  DAILY_REGIME_SLOPE_LOOKBACK,
} from './dailyRegime';

const candle = (time: string, close: number): Candle => ({
  time,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  isClosed: true,
});

const trendCandles = (direction: 'up' | 'down', length = 210): Candle[] =>
  Array.from({ length }, (_, index) => {
    const close = direction === 'up' ? 100 + index : 400 - index;
    return candle(`2026-01-${String(index + 1).padStart(3, '0')}T01:00:00-05:00`, close);
  });

const flatCandles = (length = 210): Candle[] =>
  Array.from({ length }, (_, index) =>
    candle(`2026-02-${String(index + 1).padStart(3, '0')}T01:00:00-05:00`, 100),
  );

describe('daily regime classification', () => {
  it('classifies strong bullish conditions with deterministic reasons', () => {
    const candles = trendCandles('up');
    const result = classifyDailyRegime(candles, candles.at(-1)!.close);

    expect(result).toMatchObject({
      regime: 'strong_bullish',
      status: 'available',
      sourceCandleTime: candles.at(-1)!.time,
      missingInputs: [],
    });
    expect(result.reasons).toEqual([
      'Price is above EMA20, EMA50, and EMA200',
      'EMA20 and EMA50 slopes are positive; EMA200 slope is non-negative',
      'RSI14 is at or above 55',
    ]);
  });

  it('classifies defensive bullish conditions when short-term alignment is incomplete', () => {
    const candles = trendCandles('up');
    const indicators = calculateLatestIndicatorSnapshot(candles, candles.at(-1)!.close);
    const currentPrice = (indicators.ema20.value! + indicators.ema50.value!) / 2;

    expect(classifyDailyRegime(candles, currentPrice).regime).toBe('defensive_bullish');
  });

  it('classifies neutral conditions when moving averages are flat', () => {
    const candles = flatCandles();

    expect(classifyDailyRegime(candles, 100).regime).toBe('neutral');
  });

  it('classifies defensive bearish conditions when short-term alignment is incomplete', () => {
    const candles = trendCandles('down');
    const indicators = calculateLatestIndicatorSnapshot(candles, candles.at(-1)!.close);
    const currentPrice = (indicators.ema20.value! + indicators.ema50.value!) / 2;

    expect(classifyDailyRegime(candles, currentPrice).regime).toBe('defensive_bearish');
  });

  it('classifies strong bearish conditions', () => {
    const candles = trendCandles('down');

    expect(classifyDailyRegime(candles, candles.at(-1)!.close).regime).toBe('strong_bearish');
  });

  it('is unavailable when EMA200 is unavailable', () => {
    const candles = trendCandles('up', 199);
    const result = classifyDailyRegime(candles, candles.at(-1)!.close);

    expect(result).toMatchObject({ regime: 'unavailable', status: 'unavailable' });
    expect(result.missingInputs).toContain('ema200');
  });

  it('excludes open candles and preserves the latest completed source timestamp', () => {
    const candles = trendCandles('up');
    const expected = classifyDailyRegime(candles, candles.at(-1)!.close);
    const withOpenCandle = [
      ...candles,
      { ...candles.at(-1)!, time: '2026-12-31T01:00:00-05:00', close: 1, isClosed: false },
    ];

    expect(classifyDailyRegime(withOpenCandle, candles.at(-1)!.close)).toEqual(expected);
  });

  it('is deterministic and does not mutate input candles', () => {
    const source = trendCandles('up');
    const before = structuredClone(source);

    expect(classifyDailyRegime(source, source.at(-1)!.close)).toEqual(
      classifyDailyRegime(source, source.at(-1)!.close),
    );
    expect(source).toEqual(before);
  });

  it('returns positive, negative, flat, and unavailable EMA slopes', () => {
    expect(calculateEmaSlope(trendCandles('up'), 20).direction).toBe('positive');
    expect(calculateEmaSlope(trendCandles('down'), 20).direction).toBe('negative');
    expect(calculateEmaSlope(flatCandles(), 20).direction).toBe('flat');
    expect(calculateEmaSlope(trendCandles('up', 20), 20).direction).toBe('unavailable');
    expect(calculateEmaSlope(trendCandles('up'), 20).lookback).toBe(DAILY_REGIME_SLOPE_LOOKBACK);
  });
});
