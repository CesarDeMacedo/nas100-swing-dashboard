import type { Action } from '../schemas/enums';
import type { PatienceFilterResult } from './patienceFilter';
import { DEFAULT_STRATEGY_PARAMETERS, type ResolvedStrategyParameters } from './strategyParameters';
import type { TechnicalContext } from './technicalContext';
import type { TradePlan } from './tradePlan';

export type StrategyBias = 'bullish' | 'bullish_cautious' | 'neutral' | 'bearish_cautious' | 'bearish';
export type StrategySetupStatus = 'confirmed' | 'forming' | 'waiting_for_pullback' | 'waiting_for_confirmation' | 'blocked' | 'unavailable';
export type StrategyDecision = {
  action: Action;
  direction: 'long' | 'short' | 'none';
  status: 'confirmed' | 'waiting' | 'blocked' | 'unavailable';
  bias: StrategyBias;
  setupStatus: StrategySetupStatus;
  sourceCandleTime: string | null;
  entryTrigger: string | null;
  entryPrice: number | null;
  invalidationPrice: number | null;
  stopPrice: number | null;
  targets: number[];
  estimatedRewardRisk: number | null;
  primaryReason: string;
  reasons: string[];
  warnings: string[];
  blockingReasons: string[];
  waitingReasons: string[];
  technicalContextStatus: TechnicalContext['status'];
  longPlanStatus: TradePlan['status'];
  shortPlanStatus: TradePlan['status'];
  longPatienceStatus: PatienceFilterResult['status'];
  shortPatienceStatus: PatienceFilterResult['status'];
};

export type StrategyDecisionInput = {
  technicalContext: TechnicalContext;
  longPlan: TradePlan;
  shortPlan: TradePlan;
  longPatience: PatienceFilterResult;
  shortPatience: PatienceFilterResult;
};

export function deriveStrategyBias(context: TechnicalContext): StrategyBias {
  const regime = context.canonicalDailyRegime;
  const structure = context.canonicalH4Structure;
  if (regime === 'strong_bullish' && ['bullish_trend', 'bullish_breakout'].includes(structure)) return 'bullish';
  if (regime === 'strong_bearish' && ['bearish_trend', 'bearish_breakout'].includes(structure)) return 'bearish';
  if (regime === 'strong_bullish' || regime === 'defensive_bullish' || structure.startsWith('bullish_')) return 'bullish_cautious';
  if (regime === 'strong_bearish' || regime === 'defensive_bearish' || structure.startsWith('bearish_')) return 'bearish_cautious';
  return 'neutral';
}

const valid = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const geometryValid = (plan: TradePlan, params: ResolvedStrategyParameters) => {
  if (!valid(plan.entryPrice) || !valid(plan.stopPrice) || !valid(plan.invalidationPrice) || plan.targets.length === 0 || plan.estimatedRewardRisk === null || plan.estimatedRewardRisk < params.minRewardRisk) return false;
  if (!plan.targets.every(valid)) return false;
  return plan.direction === 'long'
    ? plan.stopPrice! < plan.entryPrice! && plan.invalidationPrice! > plan.stopPrice! && plan.targets.every((target) => target > plan.entryPrice!)
    : plan.stopPrice! > plan.entryPrice! && plan.invalidationPrice! < plan.stopPrice! && plan.targets.every((target) => target < plan.entryPrice!);
};

export function decideStrategy(input: StrategyDecisionInput, params: ResolvedStrategyParameters = DEFAULT_STRATEGY_PARAMETERS): StrategyDecision {
  const { technicalContext: context, longPlan, shortPlan, longPatience, shortPatience } = input;
  const bias = deriveStrategyBias(context);
  const base = { technicalContextStatus: context.status, longPlanStatus: longPlan.status, shortPlanStatus: shortPlan.status, longPatienceStatus: longPatience.status, shortPatienceStatus: shortPatience.status };
  const reasons = [...longPatience.blockingReasons, ...shortPatience.blockingReasons];
  const waitingReasons = [...longPatience.waitingReasons, ...shortPatience.waitingReasons];
  const noTrade = (reason: string): StrategyDecision => ({ action: 'NO_TRADE', direction: 'none', status: context.status === 'unavailable' ? 'unavailable' : 'blocked', bias, setupStatus: context.status === 'unavailable' ? 'unavailable' : 'blocked', sourceCandleTime: context.sourceCandleTime, entryTrigger: null, entryPrice: null, invalidationPrice: null, stopPrice: null, targets: [], estimatedRewardRisk: null, primaryReason: reason, reasons: [reason], warnings: context.warnings, blockingReasons: reasons, waitingReasons, ...base });
  if (context.status === 'unavailable' || context.latestCandleStatus !== 'COMPLETED') return noTrade('Technical context or latest confirmed candle is unavailable.');
  if (longPatience.status === 'blocked' && shortPatience.status === 'blocked') return noTrade('Both directions are blocked by safety gates.');
  const longAllowed = longPatience.status === 'allowed' && longPlan.status === 'ready' && geometryValid(longPlan, params) && bias !== 'bearish';
  const shortAllowed = shortPatience.status === 'allowed' && shortPlan.status === 'ready' && geometryValid(shortPlan, params) && bias !== 'bullish';
  if (longAllowed && shortAllowed) return noTrade('Long and short directions are simultaneously allowed.');
  const fromPlan = (action: Action, plan: TradePlan, reason: string): StrategyDecision => ({ action, direction: plan.direction, status: action === 'BUY' || action === 'SELL' ? 'confirmed' : 'waiting', bias, setupStatus: action === 'BUY' || action === 'SELL' ? 'confirmed' : plan.locationStatus === 'acceptable' ? 'waiting_for_confirmation' : 'waiting_for_pullback', sourceCandleTime: plan.sourceCandleTime, entryTrigger: plan.entryTrigger, entryPrice: plan.entryPrice, invalidationPrice: plan.invalidationPrice, stopPrice: plan.stopPrice, targets: plan.targets, estimatedRewardRisk: plan.estimatedRewardRisk, primaryReason: reason, reasons: plan.reasons, warnings: [...context.warnings, ...plan.warnings], blockingReasons: reasons, waitingReasons, ...base });
  if (longAllowed) return fromPlan('BUY', longPlan, 'Long setup is valid and all Patience Filter gates passed.');
  if (shortAllowed) return fromPlan('SELL', shortPlan, 'Short setup is valid and all Patience Filter gates passed.');
  const pullback = [longPlan, shortPlan].find((plan) => ['not_reached', 'too_extended'].includes(plan.locationStatus));
  if (pullback) return fromPlan('WAIT_FOR_PULLBACK', pullback, 'Directional context remains intact, but price is outside the preferred pullback location.');
  const confirmation = [longPlan, shortPlan].find((plan) => plan.locationStatus === 'acceptable' && plan.confirmationStatus !== 'confirmed');
  if (confirmation) return fromPlan('WAIT_FOR_NEXT_4H_CLOSE', confirmation, 'Setup location is acceptable, but the next completed H4 candle must confirm.');
  return { action: 'WAIT', direction: 'none', status: 'waiting', bias, setupStatus: 'forming', sourceCandleTime: context.sourceCandleTime, entryTrigger: null, entryPrice: null, invalidationPrice: null, stopPrice: null, targets: [], estimatedRewardRisk: null, primaryReason: 'Context is valid but confirmation remains incomplete.', reasons: [], warnings: context.warnings, blockingReasons: reasons, waitingReasons, ...base };
}
