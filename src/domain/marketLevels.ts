import type { PriceZone } from '../schemas/analysis';
import type { Candle } from '../schemas/candles';
import { calculateLatestIndicatorSnapshot } from './indicators';
import { findConfirmedSwingPoints } from './h4Structure';

export const MARKET_LEVEL_ZONE_ATR_BUFFER = 0.2;
export const MARKET_LEVEL_INVALIDATION_ATR_BUFFER = 0.1;
/** Confirmed swings are filtered by price only (not recency), so a long enough candle history
 * (e.g. years of backtest data) can surface a swing from long ago as a "support"/"resistance"
 * candidate. Capping to the N nearest-to-price zones — after the existing proximity sort —
 * keeps `invalidationBase` in tradePlan.ts anchored to structurally relevant, nearby levels
 * regardless of how much history the caller passes in. */
export const MARKET_LEVEL_MAX_ZONES = 5;

export type MarketLevelDirection = 'long' | 'short' | 'none';

export type MarketLevels = {
  supportZones: PriceZone[];
  resistanceZones: PriceZone[];
  preferredEntryZone: PriceZone | null;
  invalidationCandidate: number | null;
  atrUsed: number | null;
  warnings: string[];
};

const completed = (candles: readonly Candle[]) => candles.filter((candle) => candle.isClosed);
const zone = (type: 'SUPPORT' | 'RESISTANCE', level: number, time: string, atr: number): PriceZone => {
  const buffer = atr * MARKET_LEVEL_ZONE_ATR_BUFFER;
  const side = type === 'SUPPORT' ? 'support' : 'resistance';
  return {
    id: `oanda-h4-${side}-${time}`,
    type,
    low: level - buffer,
    high: level + buffer,
    label: `Confirmed H4 ${side}`,
    source: `OANDA H4 confirmed swing ${type === 'SUPPORT' ? 'low' : 'high'} at ${time}`,
    confidence: 70,
    lockedByUser: false,
  };
};

const deduplicate = (zones: PriceZone[], atr: number) =>
  zones.reduce<PriceZone[]>((result, candidate) => {
    const midpoint = (candidate.low + candidate.high) / 2;
    const duplicate = result.some((existing) => Math.abs(((existing.low + existing.high) / 2) - midpoint) <= atr * MARKET_LEVEL_ZONE_ATR_BUFFER * 2);
    return duplicate ? result : [...result, candidate];
  }, []);

const preferred = (zones: PriceZone[], direction: MarketLevelDirection, ema20: number | null, ema21: number | null, atr: number): PriceZone | null => {
  if (direction === 'none') return null;
  const nearEma = zones.filter((item) => [ema20, ema21].some((ema) => ema !== null && Math.min(Math.abs(ema - item.low), Math.abs(ema - item.high)) <= atr));
  const selected = nearEma[0] ?? zones[0];
  if (!selected) return null;
  return { ...selected, id: `${selected.id}-entry`, type: 'ENTRY', label: `Preferred ${direction} H4 entry zone`, source: `${selected.source}; deterministic ${direction} pullback level` };
};

export function calculateMarketLevels(candles: readonly Candle[], direction: MarketLevelDirection): MarketLevels {
  const input = completed(candles);
  const latest = input.at(-1);
  if (!latest) return { supportZones: [], resistanceZones: [], preferredEntryZone: null, invalidationCandidate: null, atrUsed: null, warnings: ['No completed H4 candles are available for market levels.'] };
  const snapshot = calculateLatestIndicatorSnapshot(input, latest.close);
  const atr = snapshot.atr14.value;
  if (atr === null || atr <= 0) return { supportZones: [], resistanceZones: [], preferredEntryZone: null, invalidationCandidate: null, atrUsed: null, warnings: ['ATR14 is unavailable; deterministic H4 market levels were not calculated.'] };
  const swings = findConfirmedSwingPoints(input);
  if (swings.highs.length === 0 && swings.lows.length === 0) return { supportZones: [], resistanceZones: [], preferredEntryZone: null, invalidationCandidate: null, atrUsed: atr, warnings: ['No confirmed H4 swing levels are available.'] };

  const supports = deduplicate(
    swings.lows.filter((swing) => swing.price <= latest.close + atr * MARKET_LEVEL_ZONE_ATR_BUFFER).map((swing) => zone('SUPPORT', swing.price, swing.time, atr)).sort((left, right) => latest.close - ((left.low + left.high) / 2) - (latest.close - ((right.low + right.high) / 2))),
    atr,
  ).slice(0, MARKET_LEVEL_MAX_ZONES);
  const resistances = deduplicate(
    swings.highs.filter((swing) => swing.price >= latest.close - atr * MARKET_LEVEL_ZONE_ATR_BUFFER).map((swing) => zone('RESISTANCE', swing.price, swing.time, atr)).sort((left, right) => ((left.low + left.high) / 2) - latest.close - (((right.low + right.high) / 2) - latest.close)),
    atr,
  ).slice(0, MARKET_LEVEL_MAX_ZONES);
  const selected = preferred(direction === 'long' ? supports : direction === 'short' ? resistances : [], direction, snapshot.ema20.value, snapshot.ema21.value, atr);
  const invalidationCandidate = selected === null ? null : direction === 'long' ? selected.low - atr * MARKET_LEVEL_INVALIDATION_ATR_BUFFER : selected.high + atr * MARKET_LEVEL_INVALIDATION_ATR_BUFFER;
  const warnings = [
    ...(supports.length === 0 ? ['No confirmed H4 support zone is available below or near current price.'] : []),
    ...(resistances.length === 0 ? ['No confirmed H4 resistance zone is available above or near current price.'] : []),
    ...(selected === null ? ['No valid directional H4 preferred entry zone is available.'] : []),
  ];
  return { supportZones: supports, resistanceZones: resistances, preferredEntryZone: selected, invalidationCandidate, atrUsed: atr, warnings };
}
