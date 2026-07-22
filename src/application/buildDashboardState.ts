import type { AnalysisReport } from '../schemas/analysis';
import type { CandleDataset } from '../schemas/candles';
import { buildTechnicalContext } from '../domain/technicalContext';
import { calculateTradePlan, tradePlanToPatienceInputs } from '../domain/tradePlan';
import { evaluatePatienceFilter, type CrossMarketInput, type EventRiskState } from '../domain/patienceFilter';
import { decideStrategy } from '../domain/strategyDecision';
import { calculateSetupScore } from '../domain/setupScore';
import { selectOfficialSetupScore } from '../domain/scoredDecision';

export type DashboardState = { instrument: string; displayName: string; timeframe: string; generatedAt: string; sourceCandleTime: string | null; dataFreshness: AnalysisReport['dataFreshness']; action: AnalysisReport['action']; actionLabel: string; direction: 'long' | 'short' | 'none'; bias: string; setupStatus: string; marketRegime: string; h4Structure: string; score: number | null; grade: string | null; premiumSetupState: string; isActionable: boolean; currentPrice: number; changePercent: number; entryTrigger: string | null; entryPrice: number | null; invalidationPrice: number | null; stopPrice: number | null; targets: number[]; estimatedRewardRisk: number | null; primaryReason: string; reasons: string[]; warnings: string[]; whyNoEntry: string[]; whatToDoNext: string[]; marketContext: string[]; supportZones: AnalysisReport['supportZones']; resistanceZones: AnalysisReport['resistanceZones']; preferredEntryZone: AnalysisReport['preferredEntryZone']; candles: CandleDataset['candles']; dataHealth: AnalysisReport['dataHealth']; };

const confirmation = (value: string) => value === 'CONFIRMING' ? 'confirming' : value === 'CONTRADICTING' ? 'contradicting' : value === 'UNAVAILABLE' ? 'unknown' : 'neutral';
const actionLabel = (action: AnalysisReport['action']) => {
  const labels: Record<AnalysisReport['action'], string> = {
    BUY: 'BUY SETUP CONFIRMED',
    SELL: 'SELL SETUP CONFIRMED',
    WAIT: 'WAIT',
    NO_TRADE: 'NO TRADE',
    WAIT_FOR_PULLBACK: 'WAIT FOR PULLBACK',
    WAIT_FOR_NEXT_4H_CLOSE: 'WAIT FOR NEXT 4H CLOSE',
  };

  return labels[action];
};

export function buildDashboardState(analysis: AnalysisReport, candleDataset: CandleDataset): DashboardState {
  const technicalContext = buildTechnicalContext(candleDataset.candles);
  const latestCandle = candleDataset.candles.at(-1) ?? null;
  const longPlan = calculateTradePlan({ direction: 'long', technicalContext, latestCandle, preferredEntryZone: analysis.preferredEntryZone, supportZones: analysis.supportZones, resistanceZones: analysis.resistanceZones });
  const shortPlan = calculateTradePlan({ direction: 'short', technicalContext, latestCandle, preferredEntryZone: analysis.preferredEntryZone, supportZones: analysis.supportZones, resistanceZones: analysis.resistanceZones });
  const crossMarket: CrossMarketInput = { us500: { long: confirmation(analysis.crossMarket.us500.confirmation), short: confirmation(analysis.crossMarket.us500.confirmation) }, us30: { long: confirmation(analysis.crossMarket.us30.confirmation), short: confirmation(analysis.crossMarket.us30.confirmation) }, russell2000: { long: confirmation(analysis.crossMarket.russell2000.confirmation), short: confirmation(analysis.crossMarket.russell2000.confirmation) } };
  const eventRisk: EventRiskState = analysis.eventRisk.some((event) => event.blocksEntry) ? 'blocking' : analysis.eventRisk.every((event) => event.status === 'AVAILABLE') ? 'clear' : 'unknown';
  const longPatience = evaluatePatienceFilter('long', { technicalContext, dataFreshness: analysis.dataFreshness, providerStatus: analysis.dataHealth.providerStatus, eventRisk, crossMarket, ...tradePlanToPatienceInputs(longPlan) });
  const shortPatience = evaluatePatienceFilter('short', { technicalContext, dataFreshness: analysis.dataFreshness, providerStatus: analysis.dataHealth.providerStatus, eventRisk, crossMarket, ...tradePlanToPatienceInputs(shortPlan) });
  const decision = decideStrategy({ technicalContext, longPlan, shortPlan, longPatience, shortPatience });
  const longScore = calculateSetupScore({ direction: 'long', technicalContext, tradePlan: longPlan, patienceFilter: longPatience, crossMarket, eventRisk });
  const shortScore = calculateSetupScore({ direction: 'short', technicalContext, tradePlan: shortPlan, patienceFilter: shortPatience, crossMarket, eventRisk });
  const scored = selectOfficialSetupScore({ decision, longScore, shortScore, longPlan, shortPlan, longPatience, shortPatience });
  return { instrument: analysis.instrument, displayName: analysis.displayName, timeframe: analysis.timeframe, generatedAt: analysis.generatedAt, sourceCandleTime: decision.sourceCandleTime, dataFreshness: analysis.dataFreshness, action: decision.action, actionLabel: actionLabel(decision.action), direction: decision.direction, bias: decision.bias, setupStatus: decision.setupStatus, marketRegime: technicalContext.canonicalDailyRegime, h4Structure: technicalContext.canonicalH4Structure, score: scored.selectedScore, grade: scored.selectedGrade, premiumSetupState: scored.premiumSetupState, isActionable: scored.isActionable, currentPrice: analysis.currentPrice, changePercent: analysis.changePercent, entryTrigger: decision.entryTrigger, entryPrice: decision.entryPrice, invalidationPrice: decision.invalidationPrice, stopPrice: decision.stopPrice, targets: decision.targets, estimatedRewardRisk: decision.estimatedRewardRisk, primaryReason: decision.primaryReason, reasons: decision.reasons, warnings: [...decision.warnings, ...scored.warnings], whyNoEntry: analysis.whyNoEntry, whatToDoNext: analysis.whatToDoNext, marketContext: analysis.marketContext, supportZones: analysis.supportZones, resistanceZones: analysis.resistanceZones, preferredEntryZone: analysis.preferredEntryZone, candles: candleDataset.candles, dataHealth: analysis.dataHealth };
}
