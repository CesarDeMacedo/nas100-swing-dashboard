import type { PriceZone } from '../schemas/analysis';
import type { Candle } from '../schemas/candles';
import type { ConfirmationCandle, EntryDirection, EntryLocation } from './patienceFilter';
import { DEFAULT_STRATEGY_PARAMETERS, type ResolvedStrategyParameters } from './strategyParameters';
import type { TechnicalContext } from './technicalContext';

/** @deprecated kept for reference/tests; live values now come from ResolvedStrategyParameters (see strategyParameters.ts) */
export const TRADE_PLAN_LOCATION_ATR_TOLERANCE = 0.35;
export const TRADE_PLAN_TRIGGER_ATR_BUFFER = 0.05;
export const TRADE_PLAN_STOP_ATR_BUFFER = 0.25;
export const TRADE_PLAN_INVALIDATION_ATR_BUFFER = 0.1;

export type TradePlanStatus = 'ready' | 'forming' | 'invalid' | 'unavailable';

export type TradePlanInput = {
  direction: EntryDirection;
  technicalContext: TechnicalContext;
  latestCandle: Candle | null;
  preferredEntryZone?: PriceZone;
  supportZones: readonly PriceZone[];
  resistanceZones: readonly PriceZone[];
};

export type TradePlan = {
  direction: EntryDirection;
  status: TradePlanStatus;
  locationStatus: EntryLocation;
  confirmationStatus: ConfirmationCandle;
  entryTrigger: string;
  entryPrice: number | null;
  invalidationPrice: number | null;
  stopPrice: number | null;
  stopMethod: string | null;
  targets: number[];
  estimatedRewardRisk: number | null;
  atrUsed: number | null;
  sourceCandleTime: string | null;
  reasons: string[];
  warnings: string[];
  missingInputs: string[];
  structurallyInvalidated: boolean;
};

const uniqueSorted = (values: number[], direction: EntryDirection, entry: number) =>
  [...new Set(values.map((value) => Number(value.toFixed(10))))]
    .filter((value) => (direction === 'long' ? value > entry : value < entry))
    .sort((left, right) =>
      direction === 'long' ? left - right : right - left,
    );

const candlePosition = (candle: Candle) =>
  candle.high === candle.low ? 0.5 : (candle.close - candle.low) / (candle.high - candle.low);

export function calculateTradePlan(input: TradePlanInput, params: ResolvedStrategyParameters = DEFAULT_STRATEGY_PARAMETERS): TradePlan {
  const { direction, technicalContext: context, latestCandle } = input;
  const atr = context.indicatorSnapshot.atr14.value;
  const ema20 = context.indicatorSnapshot.ema20.value;
  const ema21 = context.indicatorSnapshot.ema21.value;
  const sourceCandleTime = latestCandle?.isClosed ? latestCandle.time : context.sourceCandleTime;
  const currentPrice = latestCandle?.isClosed ? latestCandle.close : null;
  const missingInputs = [
    ...(currentPrice === null ? ['latestCompletedCandle'] : []),
    ...(atr === null || atr <= 0 ? ['atr14'] : []),
    ...(ema20 === null ? ['ema20'] : []),
    ...(ema21 === null ? ['ema21'] : []),
  ];
  if (missingInputs.length > 0) {
    return unavailable();
  }

  const zones = direction === 'long'
    ? [input.preferredEntryZone, ...input.supportZones].filter(Boolean) as PriceZone[]
    : [input.preferredEntryZone, ...input.resistanceZones].filter(Boolean) as PriceZone[];
  const nearZone = zones.find((zone) => currentPrice! >= zone.low && currentPrice! <= zone.high) ??
    zones.find((zone) => Math.min(Math.abs(currentPrice! - zone.low), Math.abs(currentPrice! - zone.high)) <= atr! * params.atrLocationTolerance);
  const nearEma = Math.min(Math.abs(currentPrice! - ema20!), Math.abs(currentPrice! - ema21!)) <= atr! * params.atrLocationTolerance;
  const bearishStructure = ['bearish_trend', 'bearish_breakout'].includes(context.canonicalH4Structure);
  const bullishStructure = ['bullish_trend', 'bullish_breakout'].includes(context.canonicalH4Structure);
  const candidates = direction === 'long'
    ? [...zones.map((zone) => zone.low), context.h4Structure.recentSwingLow].filter((value): value is number => value !== null)
    : [...zones.map((zone) => zone.high), context.h4Structure.recentSwingHigh].filter((value): value is number => value !== null);
  const invalidationBase = candidates.length ? (direction === 'long' ? Math.min(...candidates) : Math.max(...candidates)) : null;
  const invalidationPrice = invalidationBase === null ? null : direction === 'long'
    ? invalidationBase - atr! * params.atrInvalidationBuffer
    : invalidationBase + atr! * params.atrInvalidationBuffer;
  const structurallyInvalidated = invalidationPrice !== null && (direction === 'long' ? currentPrice! < invalidationPrice : currentPrice! > invalidationPrice);
  const incompatibleStructure = direction === 'long' ? bearishStructure : bullishStructure;
  const tooExtended = direction === 'long'
    ? currentPrice! > Math.max(ema20!, ema21!) + atr! * params.atrLocationTolerance && !nearZone
    : currentPrice! < Math.min(ema20!, ema21!) - atr! * params.atrLocationTolerance && !nearZone;
  const locationStatus: EntryLocation = structurallyInvalidated || incompatibleStructure
    ? 'invalid'
    : nearZone || nearEma
      ? 'acceptable'
      : tooExtended
        ? 'too_extended'
        : 'not_reached';

  const boundary = direction === 'long' ? nearZone?.high ?? Math.max(ema20!, ema21!) : nearZone?.low ?? Math.min(ema20!, ema21!);
  const confirmed = latestCandle!.isClosed &&
    (direction === 'long'
      ? latestCandle!.close > latestCandle!.open && candlePosition(latestCandle!) >= 0.6 && latestCandle!.close >= boundary
      : latestCandle!.close < latestCandle!.open && candlePosition(latestCandle!) <= 0.4 && latestCandle!.close <= boundary) &&
    !structurallyInvalidated;
  const confirmationStatus: ConfirmationCandle = !latestCandle!.isClosed
    ? 'open'
    : structurallyInvalidated
      ? 'invalid'
      : confirmed
        ? 'confirmed'
        : 'missing';
  const entryPrice = confirmed ? direction === 'long'
    ? latestCandle!.high + atr! * params.atrTriggerBuffer
    : latestCandle!.low - atr! * params.atrTriggerBuffer : null;
  const entryTrigger = confirmed
    ? direction === 'long' ? 'Enter above the completed bullish H4 confirmation high.' : 'Enter below the completed bearish H4 confirmation low.'
    : direction === 'long' ? 'Wait for a completed bullish H4 close above support.' : 'Wait for a completed bearish H4 close below resistance.';
  const stopPrice = invalidationPrice === null || entryPrice === null ? null : direction === 'long'
    ? invalidationPrice - atr! * params.atrStopBuffer
    : invalidationPrice + atr! * params.atrStopBuffer;
  const levelZones = direction === 'long' ? input.resistanceZones.map((zone) => zone.low) : input.supportZones.map((zone) => zone.high);
  const swingTarget = direction === 'long' ? context.h4Structure.recentSwingHigh : context.h4Structure.recentSwingLow;
  let targets = entryPrice === null ? [] : uniqueSorted([...levelZones, ...(swingTarget === null ? [] : [swingTarget])], direction, entryPrice);
  if (entryPrice !== null && stopPrice !== null && targets.length < 2) {
    const risk = Math.abs(entryPrice - stopPrice);
    targets = uniqueSorted([...targets, direction === 'long' ? entryPrice + risk * 2 : entryPrice - risk * 2, direction === 'long' ? entryPrice + risk * 3 : entryPrice - risk * 3], direction, entryPrice);
  }
  const firstTarget = targets[0];
  const risk = entryPrice === null || stopPrice === null ? null : direction === 'long' ? entryPrice - stopPrice : stopPrice - entryPrice;
  const reward = entryPrice === null || firstTarget === undefined ? null : direction === 'long' ? firstTarget - entryPrice : entryPrice - firstTarget;
  const estimatedRewardRisk = risk !== null && reward !== null && risk > 0 && reward > 0 ? reward / risk : null;
  const warnings = [
    ...(estimatedRewardRisk !== null && estimatedRewardRisk < params.minRewardRisk ? [`Estimated reward-to-risk is below ${params.minRewardRisk.toFixed(1)}`] : []),
    ...(context.latestCandleStatus !== 'COMPLETED' ? ['Technical context latest candle is not completed'] : []),
  ];
  const status: TradePlanStatus = locationStatus === 'invalid' || structurallyInvalidated || (entryPrice !== null && (stopPrice === null || estimatedRewardRisk === null || estimatedRewardRisk < params.minRewardRisk))
    ? 'invalid'
    : locationStatus !== 'acceptable' || confirmationStatus !== 'confirmed'
      ? 'forming'
      : 'ready';
  return {
    direction, status, locationStatus, confirmationStatus, entryTrigger, entryPrice, invalidationPrice, stopPrice,
    stopMethod: stopPrice === null ? null : `Structural invalidation plus ${params.atrStopBuffer} ATR`,
    targets, estimatedRewardRisk, atrUsed: atr, sourceCandleTime,
    reasons: [
      ...(locationStatus === 'acceptable' ? ['Entry location is within the approved ATR or zone tolerance'] : []),
      ...(confirmationStatus === 'confirmed' ? ['Latest completed H4 candle confirms the direction'] : []),
    ], warnings, missingInputs, structurallyInvalidated,
  };

  function unavailable(): TradePlan {
    return { direction, status: 'unavailable', locationStatus: 'unknown', confirmationStatus: latestCandle?.isClosed ? 'unknown' : 'open', entryTrigger: 'Required trade-plan inputs are unavailable.', entryPrice: null, invalidationPrice: null, stopPrice: null, stopMethod: null, targets: [], estimatedRewardRisk: null, atrUsed: atr, sourceCandleTime, reasons: [], warnings: [], missingInputs, structurallyInvalidated: false };
  }
}

export function tradePlanToPatienceInputs(plan: TradePlan) {
  return {
    entryLocation: plan.locationStatus,
    confirmationCandle: plan.confirmationStatus,
    estimatedRR: plan.estimatedRewardRisk,
    structurallyInvalidated: plan.structurallyInvalidated,
    stop: plan.stopPrice,
    targets: plan.targets,
  };
}
