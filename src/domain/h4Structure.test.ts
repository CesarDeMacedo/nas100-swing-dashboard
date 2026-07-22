import type { Candle } from '../schemas/candles';
import { calculateLatestIndicatorSnapshot } from './indicators';
import { classifyH4Structure, findConfirmedSwingPoints } from './h4Structure';

const candle = (index: number, close: number): Candle => ({
  time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString().replace('Z', '-05:00'),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  isClosed: true,
});

const trendCandles = (direction: 'up' | 'down', length = 67): Candle[] => {
  const pattern = direction === 'up' ? [0, 4, 1, -3, 0, 3] : [0, -4, -1, 3, 0, -3];
  return Array.from({ length }, (_, index) => {
    const base = direction === 'up' ? 100 + index * 2 : 400 - index * 2;
    return candle(index, base + pattern[index % pattern.length]!);
  });
};

const confirmedTrendCandles = (direction: 'up' | 'down'): Candle[] => {
  const base = trendCandles(direction, 62);
  return appendCloses(base, direction === 'up' ? [223, 224, 225] : [277, 276, 275]);
};

const appendCloses = (candles: Candle[], closes: number[]) => [
  ...candles,
  ...closes.map((close, index) => candle(candles.length + index, close)),
];

describe('H4 structure classification', () => {
  it('classifies bullish and bearish trends with deterministic reasons', () => {
    const bullish = confirmedTrendCandles('up');
    const bearish = confirmedTrendCandles('down');

    expect(classifyH4Structure(bullish)).toMatchObject({
      structure: 'bullish_trend',
      status: 'available',
      sourceCandleTime: bullish.at(-1)!.time,
      reasons: [
        'EMA5, EMA8, and EMA13 are bullishly aligned',
        'Confirmed swings show higher highs and higher lows',
      ],
    });
    expect(classifyH4Structure(bearish).structure).toBe('bearish_trend');
  });

  it('classifies bullish and bearish pullbacks', () => {
    const bullishBase = confirmedTrendCandles('up');
    const bearishBase = confirmedTrendCandles('down');
    const bullishPullback = appendCloses(bullishBase, [222, 219, 216, 213]);
    const bearishPullback = appendCloses(bearishBase, [278, 281, 284, 287]);

    expect(classifyH4Structure(bullishPullback).structure).toBe('bullish_pullback');
    expect(classifyH4Structure(bearishPullback).structure).toBe('bearish_pullback');
  });

  it('classifies consolidation when short-term prices and EMAs are compressed', () => {
    const candles = Array.from({ length: 67 }, (_, index) => candle(index, 100));

    expect(classifyH4Structure(candles).structure).toBe('consolidation');
  });

  it('classifies bullish and bearish breakouts from completed closes', () => {
    const bullishBase = confirmedTrendCandles('up');
    const bearishBase = confirmedTrendCandles('down');
    const bullishBreakout = appendCloses(bullishBase, [300]);
    const bearishBreakout = appendCloses(bearishBase, [200]);

    expect(classifyH4Structure(bullishBreakout).structure).toBe('bullish_breakout');
    expect(classifyH4Structure(bearishBreakout).structure).toBe('bearish_breakout');
  });

  it('classifies bullish and bearish reversal attempts before confirmed trend structure', () => {
    const bullishReversal = appendCloses(confirmedTrendCandles('down'), [282, 285, 288, 290]);
    const bearishReversal = appendCloses(confirmedTrendCandles('up'), [220, 216, 213, 211]);

    expect(classifyH4Structure(bullishReversal).structure).toBe('bullish_reversal_attempt');
    expect(classifyH4Structure(bearishReversal).structure).toBe('bearish_reversal_attempt');
  });

  it('is unavailable when required EMA inputs are insufficient', () => {
    const candles = trendCandles('up', 49);
    const result = classifyH4Structure(candles);

    expect(result).toMatchObject({ structure: 'unavailable', status: 'unavailable' });
    expect(result.missingInputs).toContain('ema50');
  });

  it('excludes open candles and preserves the latest completed timestamp', () => {
    const candles = confirmedTrendCandles('up');
    const expected = classifyH4Structure(candles);
    const withOpen = [
      ...candles,
      { ...candles.at(-1)!, time: '2026-12-31T01:00:00-05:00', close: 1, high: 2, low: 1, isClosed: false },
    ];

    expect(classifyH4Structure(withOpen)).toEqual(expected);
  });

  it('finds confirmed swing highs and lows but excludes edge candles', () => {
    const candles = [
      candle(0, 10),
      candle(1, 11),
      candle(2, 15),
      candle(3, 11),
      candle(4, 8),
      candle(5, 12),
      candle(6, 10),
      candle(7, 20),
    ];
    const swings = findConfirmedSwingPoints(candles);

    expect(swings.highs.map((point) => point.index)).toEqual([2]);
    expect(swings.lows.map((point) => point.index)).toEqual([4]);
    expect(swings.highs.some((point) => point.index === 7)).toBe(false);
  });

  it('requires the 0.10 ATR breakout buffer', () => {
    const base = confirmedTrendCandles('up');
    const recentHigh = findConfirmedSwingPoints(base).highs.at(-1)!.price;
    const atr = calculateLatestIndicatorSnapshot(base, base.at(-1)!.close).atr14.value!;
    const belowBuffer = appendCloses(base, [recentHigh + atr * 0.05]);
    const aboveBuffer = appendCloses(base, [recentHigh + atr * 5]);

    expect(classifyH4Structure(belowBuffer).structure).not.toBe('bullish_breakout');
    expect(classifyH4Structure(aboveBuffer).structure).toBe('bullish_breakout');
  });

  it('is deterministic and does not mutate input candles', () => {
    const candles = confirmedTrendCandles('up');
    const before = structuredClone(candles);

    expect(classifyH4Structure(candles)).toEqual(classifyH4Structure(candles));
    expect(candles).toEqual(before);
  });
});
