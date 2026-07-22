import type { Candle } from '../schemas/candles';
import type { H4StructureClassification } from '../schemas/enums';
import { calculateLatestIndicatorSnapshot } from './indicators';

export const H4_SWING_WINDOW = 2;
export const H4_BREAKOUT_ATR_BUFFER = 0.1;
export const H4_EMA_CLUSTER_ATR_THRESHOLD = 0.2;
export const H4_COMPRESSED_RANGE_ATR_RATIO = 4;
export const H4_RECENT_RANGE_CANDLES = 10;

export type SwingPoint = {
  time: string;
  price: number;
  index: number;
};

export type H4SwingPoints = {
  highs: SwingPoint[];
  lows: SwingPoint[];
};

export type H4StructureInputsUsed = {
  currentPrice: number | null;
  ema5: number | null;
  ema8: number | null;
  ema13: number | null;
  ema20: number | null;
  ema21: number | null;
  ema50: number | null;
  rsi14: number | null;
  atr14: number | null;
  distanceFromEma20: number | null;
};

export type H4StructureResult = {
  structure: H4StructureClassification;
  status: 'available' | 'unavailable';
  sourceCandleTime: string | null;
  reasons: string[];
  recentSwingHigh: number | null;
  recentSwingLow: number | null;
  inputsUsed: H4StructureInputsUsed;
  missingInputs: string[];
};

const completedCandles = (candles: readonly Candle[]) => candles.filter((candle) => candle.isClosed);

export function findConfirmedSwingPoints(
  candles: readonly Candle[],
  window = H4_SWING_WINDOW,
): H4SwingPoints {
  const input = completedCandles(candles);
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let index = window; index < input.length - window; index += 1) {
    const candidate = input[index]!;
    const before = input.slice(index - window, index);
    const after = input.slice(index + 1, index + window + 1);

    if (before.every((candle) => candidate.high > candle.high) && after.every((candle) => candidate.high > candle.high)) {
      highs.push({ time: candidate.time, price: candidate.high, index });
    }
    if (before.every((candle) => candidate.low < candle.low) && after.every((candle) => candidate.low < candle.low)) {
      lows.push({ time: candidate.time, price: candidate.low, index });
    }
  }

  return { highs, lows };
}

const directionFromSwings = (points: SwingPoint[]) => {
  if (points.length < 2) return 'mixed' as const;
  const latest = points.at(-1)!;
  const previous = points.at(-2)!;
  if (latest.price > previous.price) return 'higher' as const;
  if (latest.price < previous.price) return 'lower' as const;
  return 'mixed' as const;
};

export function classifyH4Structure(candles: readonly Candle[]): H4StructureResult {
  const input = completedCandles(candles);
  const latest = input.at(-1);
  const currentPrice = latest?.close ?? null;
  const snapshot = calculateLatestIndicatorSnapshot(input, currentPrice);
  const inputsUsed: H4StructureInputsUsed = {
    currentPrice,
    ema5: snapshot.ema5.value,
    ema8: snapshot.ema8.value,
    ema13: snapshot.ema13.value,
    ema20: snapshot.ema20.value,
    ema21: snapshot.ema21.value,
    ema50: snapshot.ema50.value,
    rsi14: snapshot.rsi14.value,
    atr14: snapshot.atr14.value,
    distanceFromEma20: snapshot.distanceFromEma20Atr.value,
  };
  const required = [
    ['currentPrice', currentPrice],
    ['ema5', snapshot.ema5.value],
    ['ema8', snapshot.ema8.value],
    ['ema13', snapshot.ema13.value],
    ['ema20', snapshot.ema20.value],
    ['ema21', snapshot.ema21.value],
    ['ema50', snapshot.ema50.value],
    ['rsi14', snapshot.rsi14.value],
  ] as const;
  const missingInputs = required
    .filter(([, value]) => value === null)
    .map(([name]) => name);

  if (missingInputs.length > 0) {
    return {
      structure: 'unavailable',
      status: 'unavailable',
      sourceCandleTime: latest?.time ?? null,
      reasons: ['Required H4 structure inputs are unavailable'],
      recentSwingHigh: null,
      recentSwingLow: null,
      inputsUsed,
      missingInputs,
    };
  }

  const swings = findConfirmedSwingPoints(input);
  const recentSwingHigh = swings.highs.at(-1)?.price ?? null;
  const recentSwingLow = swings.lows.at(-1)?.price ?? null;
  const highDirection = directionFromSwings(swings.highs);
  const lowDirection = directionFromSwings(swings.lows);
  const price = currentPrice!;
  const ema5 = snapshot.ema5.value!;
  const ema8 = snapshot.ema8.value!;
  const ema13 = snapshot.ema13.value!;
  const ema20 = snapshot.ema20.value!;
  const ema21 = snapshot.ema21.value!;
  const ema50 = snapshot.ema50.value!;
  const rsi14 = snapshot.rsi14.value!;
  const atr14 = snapshot.atr14.value;
  const shortBullish = ema5 > ema8 && ema8 > ema13;
  const shortBearish = ema5 < ema8 && ema8 < ema13;
  const higherStructure = highDirection === 'higher' && lowDirection === 'higher';
  const lowerStructure = highDirection === 'lower' && lowDirection === 'lower';

  if (
    atr14 !== null &&
    recentSwingHigh !== null &&
    price > recentSwingHigh + atr14 * H4_BREAKOUT_ATR_BUFFER &&
    rsi14 >= 45
  ) {
    return available('bullish_breakout', ['Completed close is above the confirmed swing high by 0.10 ATR']);
  }

  if (
    atr14 !== null &&
    recentSwingLow !== null &&
    price < recentSwingLow - atr14 * H4_BREAKOUT_ATR_BUFFER &&
    rsi14 <= 55
  ) {
    return available('bearish_breakout', ['Completed close is below the confirmed swing low by 0.10 ATR']);
  }

  if (shortBullish && (price > ema20 || price > ema21) && higherStructure && rsi14 >= 45) {
    return available('bullish_trend', [
      'EMA5, EMA8, and EMA13 are bullishly aligned',
      'Confirmed swings show higher highs and higher lows',
    ]);
  }

  if (shortBearish && (price < ema20 || price < ema21) && lowerStructure && rsi14 <= 55) {
    return available('bearish_trend', [
      'EMA5, EMA8, and EMA13 are bearishly aligned',
      'Confirmed swings show lower highs and lower lows',
    ]);
  }

  const nearEma = atr14 !== null && Math.min(Math.abs(price - ema20), Math.abs(price - ema21)) <= atr14;
  if ((ema20 < ema50 || lowerStructure) && (price > ema20 || price > ema21) && ema5 > ema8) {
    return available('bullish_reversal_attempt', [
      'Price reclaimed EMA20 and EMA21',
      'Short-term EMA momentum is improving without confirmed bullish structure',
    ]);
  }

  if ((ema20 > ema50 || higherStructure) && (price < ema20 || price < ema21) && ema5 < ema8) {
    return available('bearish_reversal_attempt', [
      'Price lost EMA20 and EMA21',
      'Short-term EMA momentum is weakening without confirmed bearish structure',
    ]);
  }

  if (
    (ema20 >= ema50 || higherStructure) &&
    nearEma &&
    (price >= ema20 || price >= ema21) &&
    !shortBullish &&
    (ema5 < ema8 || ema8 < ema13) &&
    !lowerStructure
  ) {
    return available('bullish_pullback', [
      'Broader H4 structure remains bullish',
      'Price retraced toward EMA20 or EMA21',
    ]);
  }

  if (
    (ema20 <= ema50 || lowerStructure) &&
    nearEma &&
    (price <= ema20 || price <= ema21) &&
    !shortBearish &&
    (ema5 > ema8 || ema8 > ema13) &&
    !higherStructure
  ) {
    return available('bearish_pullback', [
      'Broader H4 structure remains bearish',
      'Price retraced toward EMA20 or EMA21',
    ]);
  }

  const recentCandles = input.slice(-H4_RECENT_RANGE_CANDLES);
  const recentRange = Math.max(...recentCandles.map((candle) => candle.high)) - Math.min(...recentCandles.map((candle) => candle.low));
  const emaClustered =
    atr14 !== null && Math.max(ema5, ema8, ema13) - Math.min(ema5, ema8, ema13) <= atr14 * H4_EMA_CLUSTER_ATR_THRESHOLD;
  const compressed = atr14 !== null && recentRange <= atr14 * H4_COMPRESSED_RANGE_ATR_RATIO;
  const mixedSwings = highDirection === 'mixed' || lowDirection === 'mixed';
  const consolidationReasons =
    compressed && emaClustered && mixedSwings
      ? ['Recent range is compressed to four ATRs or less', 'Short-term EMAs are clustered']
      : ['No confirmed trend, breakout, pullback, or reversal structure dominates'];

  return available('consolidation', consolidationReasons);

  function available(
    structure: Exclude<H4StructureClassification, 'unavailable'>,
    reasons: string[],
  ): H4StructureResult {
    return {
      structure,
      status: 'available',
      sourceCandleTime: latest!.time,
      reasons,
      recentSwingHigh,
      recentSwingLow,
      inputsUsed,
      missingInputs,
    };
  }
}
