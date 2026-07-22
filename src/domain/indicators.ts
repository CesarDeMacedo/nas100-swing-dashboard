import type { Candle } from '../schemas/candles';

export type IndicatorPoint = {
  time: string;
  value: number;
};

export type IndicatorUnavailable = {
  status: 'unavailable';
  reason: 'INSUFFICIENT_CLOSED_CANDLES';
  requiredClosedCandleCount: number;
  availableClosedCandleCount: number;
};

export type IndicatorAvailable = {
  status: 'available';
  points: IndicatorPoint[];
  closedCandleCount: number;
};

export type IndicatorSeriesResult = IndicatorAvailable | IndicatorUnavailable;

export type LatestIndicatorStatus = 'available' | 'insufficient_data' | 'invalid_input';

export type LatestIndicatorValue = {
  value: number | null;
  period: number | null;
  status: LatestIndicatorStatus;
  sourceCandleTime: string | null;
};

export type LatestIndicatorSnapshot = {
  latestCompletedCandleTime: string | null;
  ema5: LatestIndicatorValue;
  ema8: LatestIndicatorValue;
  ema13: LatestIndicatorValue;
  ema20: LatestIndicatorValue;
  ema21: LatestIndicatorValue;
  ema50: LatestIndicatorValue;
  ema200: LatestIndicatorValue;
  rsi14: LatestIndicatorValue;
  atr14: LatestIndicatorValue;
  distanceFromEma20Atr: LatestIndicatorValue;
};

export type FixtureIndicatorValues = Partial<{
  ema5: number;
  ema8: number;
  ema13: number;
  ema20: number;
  ema21: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  atr14: number;
  distanceFromEma20Atr: number;
}>;

export type IndicatorFixtureComparison = Record<
  keyof FixtureIndicatorValues,
  {
    status: LatestIndicatorStatus;
    calculatedValue: number | null;
    fixtureValue: number | undefined;
    difference: number | null;
  }
>;

const assertPeriod = (period: number) => {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError('Indicator period must be a positive integer.');
  }
};

const closedCandles = (candles: readonly Candle[]) => candles.filter((candle) => candle.isClosed);

export const latestCompletedCandle = (candles: readonly Candle[]) =>
  closedCandles(candles).at(-1);

const unavailable = (requiredClosedCandleCount: number, availableClosedCandleCount: number) => ({
  status: 'unavailable' as const,
  reason: 'INSUFFICIENT_CLOSED_CANDLES' as const,
  requiredClosedCandleCount,
  availableClosedCandleCount,
});

export function calculateEma(
  candles: readonly Candle[],
  period: number,
): IndicatorSeriesResult {
  assertPeriod(period);

  const input = closedCandles(candles);
  if (input.length < period) return unavailable(period, input.length);

  const multiplier = 2 / (period + 1);
  let ema = input.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  const points: IndicatorPoint[] = [{ time: input[period - 1]!.time, value: ema }];

  for (let index = period; index < input.length; index += 1) {
    const candle = input[index]!;
    ema = (candle.close - ema) * multiplier + ema;
    points.push({ time: candle.time, value: ema });
  }

  return { status: 'available', points, closedCandleCount: input.length };
}

export function calculateRsiWilder(
  candles: readonly Candle[],
  period = 14,
): IndicatorSeriesResult {
  assertPeriod(period);

  const input = closedCandles(candles);
  const requiredClosedCandleCount = period + 1;
  if (input.length < requiredClosedCandleCount) {
    return unavailable(requiredClosedCandleCount, input.length);
  }

  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = input[index]!.close - input[index - 1]!.close;
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }

  averageGain /= period;
  averageLoss /= period;

  const toRsi = () => {
    if (averageLoss === 0 && averageGain === 0) return 50;
    if (averageLoss === 0) return 100;
    if (averageGain === 0) return 0;
    return 100 - 100 / (1 + averageGain / averageLoss);
  };

  const points: IndicatorPoint[] = [{ time: input[period]!.time, value: toRsi() }];

  for (let index = period + 1; index < input.length; index += 1) {
    const change = input[index]!.close - input[index - 1]!.close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    points.push({ time: input[index]!.time, value: toRsi() });
  }

  return { status: 'available', points, closedCandleCount: input.length };
}

export function calculateAtrWilder(
  candles: readonly Candle[],
  period = 14,
): IndicatorSeriesResult {
  assertPeriod(period);

  const input = closedCandles(candles);
  if (input.length < period) return unavailable(period, input.length);

  const trueRanges = input.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;

    const previousClose = input[index - 1]!.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });

  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const points: IndicatorPoint[] = [{ time: input[period - 1]!.time, value: atr }];

  for (let index = period; index < trueRanges.length; index += 1) {
    atr = (atr * (period - 1) + trueRanges[index]!) / period;
    points.push({ time: input[index]!.time, value: atr });
  }

  return { status: 'available', points, closedCandleCount: input.length };
}

const latestValue = (result: IndicatorSeriesResult, period: number): LatestIndicatorValue => {
  if (result.status === 'unavailable') {
    return {
      value: null,
      period,
      status: 'insufficient_data',
      sourceCandleTime: null,
    };
  }

  const point = result.points.at(-1);
  if (!point) {
    return { value: null, period, status: 'insufficient_data', sourceCandleTime: null };
  }

  return { value: point.value, period, status: 'available', sourceCandleTime: point.time };
};

const invalidInput = (period: number | null): LatestIndicatorValue => ({
  value: null,
  period,
  status: 'invalid_input',
  sourceCandleTime: null,
});

export function calculateLatestIndicatorSnapshot(
  candles: readonly Candle[],
  currentPrice: unknown,
): LatestIndicatorSnapshot {
  const ema5 = latestValue(calculateEma(candles, 5), 5);
  const ema8 = latestValue(calculateEma(candles, 8), 8);
  const ema13 = latestValue(calculateEma(candles, 13), 13);
  const ema20 = latestValue(calculateEma(candles, 20), 20);
  const ema21 = latestValue(calculateEma(candles, 21), 21);
  const ema50 = latestValue(calculateEma(candles, 50), 50);
  const ema200 = latestValue(calculateEma(candles, 200), 200);
  const rsi14 = latestValue(calculateRsiWilder(candles, 14), 14);
  const atr14 = latestValue(calculateAtrWilder(candles, 14), 14);

  const distanceFromEma20Atr =
    ema20.status === 'insufficient_data' || atr14.status === 'insufficient_data'
      ? {
          value: null,
          period: null,
          status: 'insufficient_data' as const,
          sourceCandleTime: null,
        }
      : typeof currentPrice !== 'number' || !Number.isFinite(currentPrice) || atr14.value === 0
        ? invalidInput(null)
        : {
            value: (currentPrice - ema20.value!) / atr14.value!,
            period: null,
            status: 'available' as const,
            sourceCandleTime: ema20.sourceCandleTime,
          };

  return {
    latestCompletedCandleTime: latestCompletedCandle(candles)?.time ?? null,
    ema5,
    ema8,
    ema13,
    ema20,
    ema21,
    ema50,
    ema200,
    rsi14,
    atr14,
    distanceFromEma20Atr,
  };
}

export function compareSnapshotToFixtureIndicators(
  snapshot: LatestIndicatorSnapshot,
  fixture: FixtureIndicatorValues,
): IndicatorFixtureComparison {
  const keys = [
    'ema5',
    'ema8',
    'ema13',
    'ema20',
    'ema21',
    'ema50',
    'ema200',
    'rsi14',
    'atr14',
    'distanceFromEma20Atr',
  ] as const;

  return Object.fromEntries(
    keys.map((key) => {
      const calculated = snapshot[key];
      const fixtureValue = fixture[key];
      return [
        key,
        {
          status: calculated.status,
          calculatedValue: calculated.value,
          fixtureValue,
          difference:
            calculated.value === null || fixtureValue === undefined
              ? null
              : calculated.value - fixtureValue,
        },
      ];
    }),
  ) as IndicatorFixtureComparison;
}
