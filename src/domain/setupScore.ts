import { gradeForScore } from '../schemas/analysis';
import type { CrossMarketInput, EntryDirection, EventRiskState, PatienceFilterResult } from './patienceFilter';
import type { TechnicalContext } from './technicalContext';
import type { TradePlan } from './tradePlan';

export type SetupScoreCategory = { name: string; earned: number; maximum: number; status: 'available' | 'partial' | 'unavailable'; reasons: string[] };
export type SetupScore = { total: number; grade: ReturnType<typeof gradeForScore>; categories: SetupScoreCategory[]; direction: EntryDirection; status: 'available' | 'partial' | 'unavailable'; sourceCandleTime: string | null; reasons: string[]; warnings: string[] };
export type SetupScoreInput = { direction: EntryDirection; technicalContext: TechnicalContext; tradePlan: TradePlan; patienceFilter: PatienceFilterResult; crossMarket: CrossMarketInput; eventRisk: EventRiskState };

const category = (name: string, maximum: number, earned: number, reasons: string[], status: SetupScoreCategory['status'] = 'available'): SetupScoreCategory => ({ name, maximum, earned: Math.max(0, Math.min(maximum, earned)), status, reasons });

export function calculateSetupScore(input: SetupScoreInput): SetupScore {
  const { direction, technicalContext: context, tradePlan: plan, patienceFilter: patience } = input;
  const bull = direction === 'long';
  const regime = context.canonicalDailyRegime;
  const structure = context.canonicalH4Structure;
  const aligned = bull ? ['strong_bullish', 'defensive_bullish'].includes(regime) : ['strong_bearish', 'defensive_bearish'].includes(regime);
  const strong = bull ? regime === 'strong_bullish' : regime === 'strong_bearish';
  const directionalStructure = bull ? ['bullish_trend', 'bullish_breakout'].includes(structure) : ['bearish_trend', 'bearish_breakout'].includes(structure);
  const trend = category('Trend alignment', 20, regime === 'unavailable' ? 0 : strong && directionalStructure ? 20 : aligned ? 15 : regime === 'neutral' ? 8 : 0, [aligned ? 'Directional regime aligns with the score direction' : 'Regime is mixed or contradictory']);
  const structurePoints = directionalStructure ? 20 : structure.includes('pullback') ? 16 : structure.includes('reversal') ? 10 : structure === 'consolidation' ? 5 : 0;
  const structureCategory = category('H4 structure quality', 20, structurePoints, [structure]);
  const rsi = context.indicatorSnapshot.rsi14.value;
  const emaAligned = bull ? (context.indicatorSnapshot.ema5.value ?? 0) > (context.indicatorSnapshot.ema8.value ?? Infinity) && (context.indicatorSnapshot.ema8.value ?? 0) > (context.indicatorSnapshot.ema13.value ?? Infinity) : (context.indicatorSnapshot.ema5.value ?? Infinity) < (context.indicatorSnapshot.ema8.value ?? 0) && (context.indicatorSnapshot.ema8.value ?? Infinity) < (context.indicatorSnapshot.ema13.value ?? 0);
  const momentum = category('Momentum', 15, rsi === null ? 0 : emaAligned && (bull ? rsi >= 50 : rsi <= 50) ? 15 : rsi >= 45 && rsi <= 55 ? 8 : 4, [emaAligned ? 'EMA momentum aligns' : 'Momentum is mixed'], rsi === null ? 'unavailable' : 'available');
  const location = category('Entry location', 15, plan.locationStatus === 'acceptable' ? 15 : plan.locationStatus === 'not_reached' ? 9 : plan.locationStatus === 'too_extended' ? 3 : 0, [plan.locationStatus]);
  const primary = [input.crossMarket.us500[direction], input.crossMarket.us30[direction]];
  const cross = category('Cross-market confirmation', 10, primary.includes('contradicting') ? 0 : primary.filter((value) => value === 'confirming').length === 2 ? 10 : primary.includes('confirming') ? 8 : 4, [primary.join(',')]);
  const event = category('Event risk', 5, input.eventRisk === 'clear' ? 5 : input.eventRisk === 'unknown' ? 2 : input.eventRisk === 'blocking' ? 0 : 1, [input.eventRisk]);
  const rr = plan.estimatedRewardRisk;
  const rewardRisk = category('Reward-to-risk', 10, rr === null ? 0 : rr < 1 ? 0 : rr < 1.5 ? 3 : rr < 2 ? 6 : rr < 3 ? 8 : 10, [rr === null ? 'unavailable' : `R:R ${rr}`], rr === null ? 'unavailable' : 'available');
  // Descriptive only: this score never changes the Patience Filter or strategy action.
  const readiness = category('Patience Filter readiness', 5, patience.status === 'allowed' ? 5 : patience.status === 'waiting' ? 2 : 0, [patience.status]);
  const categories = [trend, structureCategory, momentum, location, cross, event, rewardRisk, readiness];
  const total = Math.max(0, Math.min(100, categories.reduce((sum, item) => sum + item.earned, 0)));
  const unavailable = context.status === 'unavailable' || plan.status === 'unavailable';
  const partial = categories.some((item) => item.status !== 'available');
  return { total, grade: gradeForScore(total), categories, direction, status: unavailable ? 'unavailable' : partial ? 'partial' : 'available', sourceCandleTime: plan.sourceCandleTime, reasons: categories.flatMap((item) => item.reasons), warnings: [...context.warnings, ...plan.warnings, ...(patience.status !== 'allowed' ? ['Patience Filter remains authoritative'] : [])] };
}
