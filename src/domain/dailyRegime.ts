import type { Candle } from '../schemas/candles';
import type { DailyRegimeClassification } from '../schemas/enums';
import {
  calculateEma,
  calculateLatestIndicatorSnapshot,
  type LatestIndicatorValue,
} from './indicators';

export const DAILY_REGIME_SLOPE_LOOKBACK = 5;
export const DAILY_REGIME_SLOPE_TOLERANCE = 0.01;

export type EmaSlopeDirection = 'positive' | 'negative' | 'flat' | 'unavailable';

export type EmaSlope = {
  direction: EmaSlopeDirection;
  lookback: number;
  tolerance: number;
  latestValue: number | null;
  comparisonValue: number | null;
};

export type DailyRegimeInputsUsed = {
  currentPrice: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  ema20Slope: EmaSlopeDirection;
  ema50Slope: EmaSlopeDirection;
  ema200Slope: EmaSlopeDirection;
};

export type DailyRegimeResult = {
  regime: DailyRegimeClassification;
  status: 'available' | 'unavailable';
  sourceCandleTime: string | null;
  reasons: string[];
  inputsUsed: DailyRegimeInputsUsed;
  missingInputs: string[];
};

export function calculateEmaSlope(
  candles: readonly Candle[],
  period: number,
  lookback = DAILY_REGIME_SLOPE_LOOKBACK,
  tolerance = DAILY_REGIME_SLOPE_TOLERANCE,
): EmaSlope {
  const result = calculateEma(candles, period);
  if (result.status === 'unavailable' || result.points.length <= lookback) {
    return {
      direction: 'unavailable',
      lookback,
      tolerance,
      latestValue: null,
      comparisonValue: null,
    };
  }

  const latest = result.points.at(-1)!;
  const comparison = result.points.at(-(lookback + 1))!;
  const difference = latest.value - comparison.value;
  const direction =
    Math.abs(difference) <= tolerance ? 'flat' : difference > 0 ? 'positive' : 'negative';

  return {
    direction,
    lookback,
    tolerance,
    latestValue: latest.value,
    comparisonValue: comparison.value,
  };
}

const missingIndicator = (indicator: LatestIndicatorValue, name: string) =>
  indicator.status === 'available' && indicator.value !== null ? [] : [name];

const unavailableResult = (
  sourceCandleTime: string | null,
  inputsUsed: DailyRegimeInputsUsed,
  missingInputs: string[],
): DailyRegimeResult => ({
  regime: 'unavailable',
  status: 'unavailable',
  sourceCandleTime,
  reasons: ['Required daily regime inputs are unavailable'],
  inputsUsed,
  missingInputs,
});

export function classifyDailyRegime(
  candles: readonly Candle[],
  currentPrice: unknown,
): DailyRegimeResult {
  const snapshot = calculateLatestIndicatorSnapshot(candles, currentPrice);
  const ema20Slope = calculateEmaSlope(candles, 20);
  const ema50Slope = calculateEmaSlope(candles, 50);
  const ema200Slope = calculateEmaSlope(candles, 200);
  const currentPriceValue =
    typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0
      ? currentPrice
      : null;
  const inputsUsed: DailyRegimeInputsUsed = {
    currentPrice: currentPriceValue,
    ema20: snapshot.ema20.value,
    ema50: snapshot.ema50.value,
    ema200: snapshot.ema200.value,
    rsi14: snapshot.rsi14.value,
    ema20Slope: ema20Slope.direction,
    ema50Slope: ema50Slope.direction,
    ema200Slope: ema200Slope.direction,
  };
  const missingInputs = [
    ...(currentPriceValue === null ? ['currentPrice'] : []),
    ...missingIndicator(snapshot.ema20, 'ema20'),
    ...missingIndicator(snapshot.ema50, 'ema50'),
    ...missingIndicator(snapshot.ema200, 'ema200'),
    ...missingIndicator(snapshot.rsi14, 'rsi14'),
    ...(ema20Slope.direction === 'unavailable' ? ['ema20Slope'] : []),
    ...(ema50Slope.direction === 'unavailable' ? ['ema50Slope'] : []),
    ...(ema200Slope.direction === 'unavailable' ? ['ema200Slope'] : []),
  ];

  if (missingInputs.length > 0) {
    return unavailableResult(snapshot.latestCompletedCandleTime, inputsUsed, missingInputs);
  }

  const price = currentPriceValue!;
  const ema20 = snapshot.ema20.value!;
  const ema50 = snapshot.ema50.value!;
  const ema200 = snapshot.ema200.value!;
  const rsi14 = snapshot.rsi14.value!;

  const strongBullish =
    price > ema20 &&
    ema20 > ema50 &&
    ema50 > ema200 &&
    ema20Slope.direction === 'positive' &&
    ema50Slope.direction === 'positive' &&
    (ema200Slope.direction === 'positive' || ema200Slope.direction === 'flat') &&
    rsi14 >= 55;
  if (strongBullish) {
    return {
      regime: 'strong_bullish',
      status: 'available',
      sourceCandleTime: snapshot.latestCompletedCandleTime,
      reasons: [
        'Price is above EMA20, EMA50, and EMA200',
        'EMA20 and EMA50 slopes are positive; EMA200 slope is non-negative',
        'RSI14 is at or above 55',
      ],
      inputsUsed,
      missingInputs,
    };
  }

  const strongBearish =
    price < ema20 &&
    ema20 < ema50 &&
    ema50 < ema200 &&
    ema20Slope.direction === 'negative' &&
    ema50Slope.direction === 'negative' &&
    (ema200Slope.direction === 'negative' || ema200Slope.direction === 'flat') &&
    rsi14 <= 45;
  if (strongBearish) {
    return {
      regime: 'strong_bearish',
      status: 'available',
      sourceCandleTime: snapshot.latestCompletedCandleTime,
      reasons: [
        'Price is below EMA20, EMA50, and EMA200',
        'EMA20 and EMA50 slopes are negative; EMA200 slope is non-positive',
        'RSI14 is at or below 45',
      ],
      inputsUsed,
      missingInputs,
    };
  }

  if (price > ema50 && price > ema200 && ema50 >= ema200) {
    return {
      regime: 'defensive_bullish',
      status: 'available',
      sourceCandleTime: snapshot.latestCompletedCandleTime,
      reasons: ['Price is above EMA50 and EMA200', 'Bullish alignment is incomplete'],
      inputsUsed,
      missingInputs,
    };
  }

  if (price < ema50 && price < ema200 && ema50 <= ema200) {
    return {
      regime: 'defensive_bearish',
      status: 'available',
      sourceCandleTime: snapshot.latestCompletedCandleTime,
      reasons: ['Price is below EMA50 and EMA200', 'Bearish alignment is incomplete'],
      inputsUsed,
      missingInputs,
    };
  }

  return {
    regime: 'neutral',
    status: 'available',
    sourceCandleTime: snapshot.latestCompletedCandleTime,
    reasons: [
      'Moving-average alignment is mixed or price is between EMA50 and EMA200',
      'EMA slopes do not support a directional regime',
    ],
    inputsUsed,
    missingInputs,
  };
}
