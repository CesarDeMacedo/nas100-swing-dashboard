import currentAnalysis from '../../mock/current-analysis.json';
import candleDataset from '../../mock/nas100-h4-candles.json';
import type { Candle } from '../schemas/candles';
import { buildTechnicalContext } from './technicalContext';
import { decideStrategy, deriveStrategyBias } from './strategyDecision';
import type { PatienceFilterResult } from './patienceFilter';
import type { TradePlan } from './tradePlan';
import { evaluatePatienceFilter } from './patienceFilter';
import { calculateTradePlan, tradePlanToPatienceInputs } from './tradePlan';
import type { PriceZone } from '../schemas/analysis';

const context = () => buildTechnicalContext(Array.from({ length: 210 }, (_, index) => ({ time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString().replace('Z', '-05:00'), open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, isClosed: true } as Candle)));
const plan = (direction: 'long' | 'short'): TradePlan => ({ direction, status: 'ready', locationStatus: 'acceptable', confirmationStatus: 'confirmed', entryTrigger: 'trigger', entryPrice: 100, invalidationPrice: direction === 'long' ? 96 : 104, stopPrice: direction === 'long' ? 95 : 105, stopMethod: 'test', targets: direction === 'long' ? [110, 115] : [90, 85], estimatedRewardRisk: 2, atrUsed: 2, sourceCandleTime: '2026-01-01T00:00:00-05:00', reasons: [], warnings: [], missingInputs: [], structurallyInvalidated: false });
const patience = (direction: 'long' | 'short', status: PatienceFilterResult['status'] = 'allowed'): PatienceFilterResult => ({ direction, status, canEnter: status === 'allowed', blockingReasons: status === 'blocked' ? ['blocked'] : [], waitingReasons: status === 'waiting' ? ['waiting'] : [], passedChecks: [], failedChecks: [], missingInputs: [], sourceCandleTime: '2026-01-01T00:00:00-05:00' });
const input = () => ({ technicalContext: context(), longPlan: plan('long'), shortPlan: plan('short'), longPatience: patience('long'), shortPatience: patience('short', 'waiting') });

describe('strategy decision', () => {
  it('returns valid BUY and SELL only for the permitted direction', () => {
    expect(decideStrategy(input()).action).toBe('BUY');
    const sell = input(); sell.longPatience = patience('long', 'waiting'); sell.shortPatience = patience('short'); sell.technicalContext.canonicalDailyRegime = 'strong_bearish'; sell.technicalContext.canonicalH4Structure = 'bearish_trend';
    expect(decideStrategy(sell).action).toBe('SELL');
  });
  it('returns NO_TRADE for unavailable context, safety blocks, and conflicting allowed directions', () => {
    const unavailable = input(); unavailable.technicalContext.status = 'unavailable';
    const blocked = input(); blocked.longPatience = patience('long', 'blocked'); blocked.shortPatience = patience('short', 'blocked');
    const conflict = input(); conflict.shortPatience = patience('short'); conflict.technicalContext.canonicalDailyRegime = 'neutral';
    expect(decideStrategy(unavailable).action).toBe('NO_TRADE'); expect(decideStrategy(blocked).action).toBe('NO_TRADE'); expect(decideStrategy(conflict).action).toBe('NO_TRADE');
  });
  it('selects pullback, next-close, and generic wait states', () => {
    const pullback = input(); pullback.longPatience = patience('long', 'waiting'); pullback.longPlan.status = 'forming'; pullback.longPlan.locationStatus = 'not_reached'; pullback.longPlan.confirmationStatus = 'missing';
    const next = input(); next.longPatience = patience('long', 'waiting'); next.longPlan.status = 'forming'; next.longPlan.confirmationStatus = 'missing';
    const wait = input(); wait.longPatience = patience('long', 'waiting'); wait.shortPatience = patience('short', 'waiting'); wait.longPlan.status = 'forming'; wait.shortPlan.status = 'forming'; wait.longPlan.locationStatus = 'unknown'; wait.shortPlan.locationStatus = 'unknown';
    expect(decideStrategy(pullback).action).toBe('WAIT_FOR_PULLBACK'); expect(decideStrategy(next).action).toBe('WAIT_FOR_NEXT_4H_CLOSE'); expect(decideStrategy(wait).action).toBe('WAIT');
  });
  it('blocks invalid geometry and maps deterministic bias', () => {
    const bad = input(); bad.longPlan.stopPrice = 101;
    expect(decideStrategy(bad).action).not.toBe('BUY');
    const values: Array<[typeof bad.technicalContext.canonicalDailyRegime, typeof bad.technicalContext.canonicalH4Structure, string]> = [['strong_bullish', 'bullish_trend', 'bullish'], ['defensive_bullish', 'consolidation', 'bullish_cautious'], ['neutral', 'consolidation', 'neutral'], ['defensive_bearish', 'consolidation', 'bearish_cautious'], ['strong_bearish', 'bearish_trend', 'bearish']];
    values.forEach(([regime, structure, bias]) => { const item = input().technicalContext; item.canonicalDailyRegime = regime; item.canonicalH4Structure = structure; expect(deriveStrategyBias(item)).toBe(bias); });
  });
  it('is deterministic, immutable, and evaluates the current fixture without requiring legacy parity', () => {
    const value = input(); const before = structuredClone(value);
    expect(decideStrategy(value)).toEqual(decideStrategy(value)); expect(value).toEqual(before);
    const fixtureContext = buildTechnicalContext(candleDataset.candles as Candle[]);
    const fixtureCandle = (candleDataset.candles as Candle[]).at(-1)!;
    const longPlan = calculateTradePlan({ direction: 'long', technicalContext: fixtureContext, latestCandle: fixtureCandle, preferredEntryZone: currentAnalysis.preferredEntryZone as unknown as PriceZone, supportZones: currentAnalysis.supportZones as unknown as PriceZone[], resistanceZones: currentAnalysis.resistanceZones as unknown as PriceZone[] });
    const shortPlan = calculateTradePlan({ direction: 'short', technicalContext: fixtureContext, latestCandle: fixtureCandle, preferredEntryZone: currentAnalysis.preferredEntryZone as unknown as PriceZone, supportZones: currentAnalysis.supportZones as unknown as PriceZone[], resistanceZones: currentAnalysis.resistanceZones as unknown as PriceZone[] });
    const crossMarket = { us500: { long: 'neutral', short: 'neutral' }, us30: { long: 'neutral', short: 'neutral' }, russell2000: { long: 'neutral', short: 'neutral' } } as const;
    const longPatience = evaluatePatienceFilter('long', { technicalContext: fixtureContext, dataFreshness: 'MOCK', providerStatus: 'MOCK', eventRisk: 'unknown', crossMarket, ...tradePlanToPatienceInputs(longPlan) });
    const shortPatience = evaluatePatienceFilter('short', { technicalContext: fixtureContext, dataFreshness: 'MOCK', providerStatus: 'MOCK', eventRisk: 'unknown', crossMarket, ...tradePlanToPatienceInputs(shortPlan) });
    const result = decideStrategy({ technicalContext: fixtureContext, longPlan, shortPlan, longPatience, shortPatience });
    expect(result.action).toMatch(/BUY|SELL|WAIT|NO_TRADE|WAIT_FOR_PULLBACK|WAIT_FOR_NEXT_4H_CLOSE/);
    expect(currentAnalysis.action).toBeDefined();
  });
});
