import { gradeForScore } from '../schemas/analysis';
import type { CrossMarketInput, EntryDirection, EventRiskState, PatienceFilterResult } from './patienceFilter';
import { DEFAULT_STRATEGY_PARAMETERS, type ResolvedStrategyParameters } from './strategyParameters';
import type { TechnicalContext } from './technicalContext';
import type { TradePlan } from './tradePlan';

export type SetupScoreCategory = { name: string; earned: number; maximum: number; status: 'available' | 'partial' | 'unavailable'; reasons: string[] };
export type SetupScore = { total: number; grade: ReturnType<typeof gradeForScore>; categories: SetupScoreCategory[]; direction: EntryDirection; status: 'available' | 'partial' | 'unavailable'; sourceCandleTime: string | null; reasons: string[]; warnings: string[] };
export type SetupScoreInput = { direction: EntryDirection; technicalContext: TechnicalContext; tradePlan: TradePlan; patienceFilter: PatienceFilterResult; crossMarket: CrossMarketInput; eventRisk: EventRiskState };

const category = (name: string, maximum: number, earned: number, reasons: string[], status: SetupScoreCategory['status'] = 'available'): SetupScoreCategory => ({ name, maximum, earned: Math.max(0, Math.min(maximum, earned)), status, reasons });

export function calculateSetupScore(input: SetupScoreInput, params: ResolvedStrategyParameters = DEFAULT_STRATEGY_PARAMETERS): SetupScore {
  const { direction, technicalContext: context, tradePlan: plan, patienceFilter: patience } = input;
  const weights = params.setupScoreWeights;
  const bull = direction === 'long';
  const regime = context.canonicalDailyRegime;
  const structure = context.canonicalH4Structure;
  const aligned = bull ? ['strong_bullish', 'defensive_bullish'].includes(regime) : ['strong_bearish', 'defensive_bearish'].includes(regime);
  const strong = bull ? regime === 'strong_bullish' : regime === 'strong_bearish';
  const directionalStructure = bull ? ['bullish_trend', 'bullish_breakout'].includes(structure) : ['bearish_trend', 'bearish_breakout'].includes(structure);
  const trend = category('Trend alignment', weights.trend, regime === 'unavailable' ? 0 : strong && directionalStructure ? weights.trend : aligned ? weights.trend * 0.75 : regime === 'neutral' ? weights.trend * 0.4 : 0, [aligned ? 'Directional regime aligns with the score direction' : 'Regime is mixed or contradictory']);
  const structurePoints = directionalStructure ? weights.structure : structure.includes('pullback') ? weights.structure * 0.8 : structure.includes('reversal') ? weights.structure * 0.5 : structure === 'consolidation' ? weights.structure * 0.25 : 0;
  const structureCategory = category('H4 structure quality', weights.structure, structurePoints, [structure]);
  const rsi = context.indicatorSnapshot.rsi14.value;
  const emaAligned = bull ? (context.indicatorSnapshot.ema5.value ?? 0) > (context.indicatorSnapshot.ema8.value ?? Infinity) && (context.indicatorSnapshot.ema8.value ?? 0) > (context.indicatorSnapshot.ema13.value ?? Infinity) : (context.indicatorSnapshot.ema5.value ?? Infinity) < (context.indicatorSnapshot.ema8.value ?? 0) && (context.indicatorSnapshot.ema8.value ?? Infinity) < (context.indicatorSnapshot.ema13.value ?? 0);
  const momentum = category('Momentum', weights.momentum, rsi === null ? 0 : emaAligned && (bull ? rsi >= 50 : rsi <= 50) ? weights.momentum : rsi >= 45 && rsi <= 55 ? weights.momentum * (8 / 15) : weights.momentum * (4 / 15), [emaAligned ? 'EMA momentum aligns' : 'Momentum is mixed'], rsi === null ? 'unavailable' : 'available');
  const location = category('Entry location', weights.location, plan.locationStatus === 'acceptable' ? weights.location : plan.locationStatus === 'not_reached' ? weights.location * 0.6 : plan.locationStatus === 'too_extended' ? weights.location * 0.2 : 0, [plan.locationStatus]);
  const primary = params.crossMarketPrimaryInstruments.map((key) => input.crossMarket[key][direction]);
  const cross = category('Cross-market confirmation', weights.crossMarket, primary.includes('contradicting') ? 0 : primary.length > 0 && primary.every((value) => value === 'confirming') ? weights.crossMarket : primary.includes('confirming') ? weights.crossMarket * 0.8 : weights.crossMarket * 0.4, [primary.join(',')]);
  const event = category('Event risk', weights.eventRisk, input.eventRisk === 'clear' ? weights.eventRisk : input.eventRisk === 'unknown' ? weights.eventRisk * 0.4 : input.eventRisk === 'blocking' ? 0 : weights.eventRisk * 0.2, [input.eventRisk]);
  const rr = plan.estimatedRewardRisk;
  const rewardRisk = category('Reward-to-risk', weights.rewardRisk, rr === null ? 0 : rr < 1 ? 0 : rr < 1.5 ? weights.rewardRisk * 0.3 : rr < 2 ? weights.rewardRisk * 0.6 : rr < 3 ? weights.rewardRisk * 0.8 : weights.rewardRisk, [rr === null ? 'unavailable' : `R:R ${rr}`], rr === null ? 'unavailable' : 'available');
  // Descriptive only: this score never changes the Patience Filter or strategy action.
  const readiness = category('Patience Filter readiness', weights.patienceReadiness, patience.status === 'allowed' ? weights.patienceReadiness : patience.status === 'waiting' ? weights.patienceReadiness * 0.4 : 0, [patience.status]);
  const categories = [trend, structureCategory, momentum, location, cross, event, rewardRisk, readiness];
  const total = Math.max(0, Math.min(100, categories.reduce((sum, item) => sum + item.earned, 0)));
  const unavailable = context.status === 'unavailable' || plan.status === 'unavailable';
  const partial = categories.some((item) => item.status !== 'available');
  return { total, grade: gradeForScore(total), categories, direction, status: unavailable ? 'unavailable' : partial ? 'partial' : 'available', sourceCandleTime: plan.sourceCandleTime, reasons: categories.flatMap((item) => item.reasons), warnings: [...context.warnings, ...plan.warnings, ...(patience.status !== 'allowed' ? ['Patience Filter remains authoritative'] : [])] };
}
