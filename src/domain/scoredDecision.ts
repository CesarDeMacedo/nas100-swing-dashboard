import type { PatienceFilterResult } from './patienceFilter';
import type { SetupScore } from './setupScore';
import type { StrategyDecision } from './strategyDecision';
import type { TradePlan } from './tradePlan';

export type PremiumSetupState = 'confirmed_entry' | 'high_quality_forming' | 'high_quality_waiting_confirmation' | 'high_quality_blocked' | 'below_threshold' | 'unavailable';
export type ScoredDecision = { selectedScore: number | null; selectedGrade: SetupScore['grade'] | null; selectedDirection: 'long' | 'short' | 'none'; longScore: SetupScore; shortScore: SetupScore; action: StrategyDecision['action']; setupStatus: StrategyDecision['setupStatus']; isActionable: boolean; premiumSetupEligible: boolean; premiumSetupState: PremiumSetupState; primaryScoreReason: string; reasons: string[]; warnings: string[]; sourceCandleTime: string | null };

export function selectOfficialSetupScore(input: { decision: StrategyDecision; longScore: SetupScore; shortScore: SetupScore; longPlan: TradePlan; shortPlan: TradePlan; longPatience: PatienceFilterResult; shortPatience: PatienceFilterResult }): ScoredDecision {
  const { decision, longScore, shortScore } = input;
  const biasDirection = decision.bias.startsWith('bullish') ? 'long' : decision.bias.startsWith('bearish') ? 'short' : 'none';
  const direction = decision.direction !== 'none' ? decision.direction : decision.action === 'WAIT' && biasDirection !== 'none' ? biasDirection : longScore.total >= shortScore.total ? 'long' : 'short';
  const selected = direction === 'long' ? longScore : shortScore;
  const plan = direction === 'long' ? input.longPlan : input.shortPlan;
  const patience = direction === 'long' ? input.longPatience : input.shortPatience;
  const actionable = (decision.action === 'BUY' || decision.action === 'SELL') && patience.status === 'allowed' && plan.status === 'ready' && (plan.estimatedRewardRisk ?? 0) >= 2;
  const unavailable = selected.status === 'unavailable';
  const eligible = !unavailable && selected.total >= 70;
  const premiumSetupState: PremiumSetupState = unavailable ? 'unavailable' : !eligible ? 'below_threshold' : actionable ? 'confirmed_entry' : decision.action === 'WAIT_FOR_NEXT_4H_CLOSE' ? 'high_quality_waiting_confirmation' : decision.action === 'NO_TRADE' || decision.setupStatus === 'blocked' ? 'high_quality_blocked' : 'high_quality_forming';
  const primaryScoreReason = premiumSetupState === 'confirmed_entry' ? `${direction === 'long' ? 'Long' : 'Short'} setup is confirmed and all Patience Filter gates passed.` : premiumSetupState === 'high_quality_waiting_confirmation' ? 'Score is above 70, but the next completed H4 candle must confirm the setup.' : premiumSetupState === 'high_quality_blocked' ? 'The setup scores well technically, but safety rules block entry.' : premiumSetupState === 'high_quality_forming' ? `High-quality ${direction} setup is forming, but entry conditions remain incomplete.` : unavailable ? 'Setup score is unavailable.' : 'The current setup remains below the premium threshold.';
  return { selectedScore: unavailable ? null : selected.total, selectedGrade: unavailable ? null : selected.grade, selectedDirection: unavailable ? 'none' : direction, longScore, shortScore, action: decision.action, setupStatus: decision.setupStatus, isActionable: actionable, premiumSetupEligible: eligible, premiumSetupState, primaryScoreReason, reasons: selected.reasons, warnings: [...selected.warnings, ...(actionable ? [] : ['Setup Score does not authorize entry'])], sourceCandleTime: selected.sourceCandleTime };
}
