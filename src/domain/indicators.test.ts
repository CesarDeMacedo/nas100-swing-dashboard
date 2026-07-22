import type { Candle } from '../schemas/candles';
import {
  calculateAtrWilder,
  calculateEma,
  calculateRsiWilder,
  type IndicatorAvailable,
  type IndicatorSeriesResult,
} from './indicators';

const candle = (index: number, close: number, isClosed = true): Candle => ({
  time: `2026-01-${String(index + 1).padStart(2, '0')}T01:00:00-05:00`,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  isClosed,
});

const candlesFromCloses = (closes: number[]) =>
  closes.map((close, index) => candle(index, close));

const expectAvailable = (result: IndicatorSeriesResult): IndicatorAvailable => {
  expect(result.status).toBe('available');
  if (result.status !== 'available') throw new Error('Expected an available indicator result.');
  return result;
};

describe('core indicators', () => {
  it('calculates EMA from a simple moving-average seed', () => {
    const result = expectAvailable(calculateEma(candlesFromCloses([1, 2, 3, 4, 5]), 3));

    expect(result.points.map((point) => point.value)).toEqual([2, 3, 4]);
    expect(result.points.map((point) => point.time)).toEqual([
      '2026-01-03T01:00:00-05:00',
      '2026-01-04T01:00:00-05:00',
      '2026-01-05T01:00:00-05:00',
    ]);
  });

  it('calculates RSI14 with Wilder smoothing', () => {
    const closes = [...Array.from({ length: 15 }, (_, index) => index + 1), 14];
    const result = expectAvailable(calculateRsiWilder(candlesFromCloses(closes)));

    expect(result.points).toHaveLength(2);
    expect(result.points[0]!.value).toBe(100);
    expect(result.points[1]!.value).toBeCloseTo(92.8571428571, 10);
  });

  it('calculates ATR14 with Wilder smoothing and true ranges', () => {
    const candles = Array.from({ length: 15 }, (_, index) => candle(index, 100));
    candles[14] = {
      ...candles[14]!,
      high: 104,
      low: 100,
      close: 103,
    };

    const result = expectAvailable(calculateAtrWilder(candles));

    expect(result.points.map((point) => point.value)).toEqual([2, 2 + 2 / 14]);
  });

  it('returns explicit unavailable results when closed history is insufficient', () => {
    const candles = candlesFromCloses([1, 2]);
    const ema = calculateEma(candles, 3);
    const rsi = calculateRsiWilder(Array.from({ length: 14 }, (_, index) => candle(index, index + 1)));
    const atr = calculateAtrWilder(Array.from({ length: 13 }, (_, index) => candle(index, 100)));

    expect(ema).toMatchObject({
      status: 'unavailable',
      reason: 'INSUFFICIENT_CLOSED_CANDLES',
      requiredClosedCandleCount: 3,
      availableClosedCandleCount: 2,
    });
    expect(rsi).toMatchObject({
      status: 'unavailable',
      requiredClosedCandleCount: 15,
      availableClosedCandleCount: 14,
    });
    expect(atr).toMatchObject({
      status: 'unavailable',
      requiredClosedCandleCount: 14,
      availableClosedCandleCount: 13,
    });
  });

  it('excludes open candles from EMA, RSI, and ATR inputs', () => {
    const closedEma = candlesFromCloses([1, 2, 3]);
    const emaWithOpen = calculateEma([...closedEma, candle(3, 100, false)], 3);
    expect(expectAvailable(emaWithOpen).points.map((point) => point.value)).toEqual([2]);

    const closedRsi = Array.from({ length: 15 }, (_, index) => candle(index, index + 1));
    const rsiWithOpen = calculateRsiWilder([...closedRsi, candle(15, 1, false)]);
    expect(expectAvailable(rsiWithOpen).points[0]!.value).toBe(100);

    const closedAtr = Array.from({ length: 14 }, (_, index) => candle(index, 100));
    const atrWithOpen = calculateAtrWilder([
      ...closedAtr,
      { ...candle(14, 90, false), high: 150, low: 1 },
    ]);
    expect(expectAvailable(atrWithOpen).points.map((point) => point.value)).toEqual([2]);
  });
});
