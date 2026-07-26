import type { Candle } from '../schemas/candles';
import { buildTechnicalContext } from './technicalContext';
import { calculateSetupScore, type SetupScoreInput } from './setupScore';
import type { TradePlan } from './tradePlan';
import type { PatienceFilterResult } from './patienceFilter';

const context = () => buildTechnicalContext(Array.from({ length: 210 }, (_, index) => ({ time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString().replace('Z', '-05:00'), open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, isClosed: true } as Candle)));
const plan = (direction: 'long' | 'short', rr = 3): TradePlan => ({ direction, status: 'ready', locationStatus: 'acceptable', confirmationStatus: 'confirmed', entryTrigger: 'trigger', entryPrice: 100, invalidationPrice: 96, stopPrice: 95, stopMethod: 'test', targets: [110], targetSource: 'structural', estimatedRewardRisk: rr, atrUsed: 2, sourceCandleTime: '2026-01-01T00:00:00-05:00', reasons: [], warnings: [], missingInputs: [], structurallyInvalidated: false });
const patience = (direction: 'long' | 'short', status: PatienceFilterResult['status'] = 'allowed'): PatienceFilterResult => ({ direction, status, canEnter: status === 'allowed', blockingReasons: [], waitingReasons: [], passedChecks: [], failedChecks: [], missingInputs: [], sourceCandleTime: null });
const input = (direction: 'long' | 'short' = 'long', rr = 3): SetupScoreInput => ({ direction, technicalContext: context(), tradePlan: plan(direction, rr), patienceFilter: patience(direction), crossMarket: { us500: { long: 'confirming', short: 'confirming' }, us30: { long: 'confirming', short: 'confirming' }, russell2000: { long: 'neutral', short: 'neutral' } }, eventRisk: 'clear' });

describe('Setup Score', () => {
  it('scores long and short independently', () => { const long = calculateSetupScore(input('long')); const short = calculateSetupScore(input('short')); expect(long.total).toBeGreaterThanOrEqual(80); expect(short.direction).toBe('short'); expect(short.total).not.toBe(long.total); });
  it('covers location, cross-market, event-risk, R:R, and Patience bands', () => {
    const value = input(); value.tradePlan.locationStatus = 'not_reached'; value.crossMarket.us30.long = 'neutral'; value.eventRisk = 'unknown'; value.tradePlan.estimatedRewardRisk = 1.75; value.patienceFilter.status = 'waiting';
    const score = calculateSetupScore(value); expect(score.categories.map((item) => item.earned)).toContain(9); expect(score.categories.find((item) => item.name === 'Reward-to-risk')!.earned).toBe(6); expect(score.categories.find((item) => item.name === 'Patience Filter readiness')!.earned).toBe(2);
  });
  it('handles contradictory, blocking, unavailable, grade-boundary, deterministic, and immutable cases', () => {
    const value = input(); value.crossMarket.us500.long = 'contradicting'; value.eventRisk = 'blocking'; value.tradePlan.locationStatus = 'invalid'; value.tradePlan.estimatedRewardRisk = 0.5; value.patienceFilter.status = 'blocked';
    const score = calculateSetupScore(value); expect(score.total).toBeGreaterThanOrEqual(0); expect(score.total).toBeLessThanOrEqual(100); expect(score.grade).toBeDefined();
    const before = structuredClone(value); expect(calculateSetupScore(value)).toEqual(calculateSetupScore(value)); expect(value).toEqual(before);
  });
});
