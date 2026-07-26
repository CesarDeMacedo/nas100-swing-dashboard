export type CrossMarketInstrumentKey = 'us500' | 'us30' | 'russell2000';

export type SetupScoreWeights = {
  trend: number;
  structure: number;
  momentum: number;
  location: number;
  crossMarket: number;
  eventRisk: number;
  rewardRisk: number;
  patienceReadiness: number;
};

export type ResolvedStrategyParameters = {
  minRewardRisk: number;
  premiumScoreThreshold: number;
  atrLocationTolerance: number;
  atrTriggerBuffer: number;
  atrStopBuffer: number;
  atrInvalidationBuffer: number;
  crossMarketPrimaryInstruments: readonly CrossMarketInstrumentKey[];
  setupScoreWeights: SetupScoreWeights;
};

/** A persisted strategy's `parameters` (see `src/schemas/strategyConfig.ts`) carries a few
 * fields the pipeline doesn't consume yet (`eventRisk.*`, out of scope until historical
 * event-risk replay exists — see docs). This strips down to exactly what `ResolvedStrategyParameters`
 * needs, so callers never have to know about the persistence-layer shape. */
export const resolveStrategyParameters = (parameters: {
  minRewardRisk: number;
  premiumScoreThreshold: number;
  atrLocationTolerance: number;
  atrTriggerBuffer: number;
  atrStopBuffer: number;
  atrInvalidationBuffer: number;
  crossMarketPrimaryInstruments: readonly CrossMarketInstrumentKey[];
  setupScoreWeights: SetupScoreWeights;
}): ResolvedStrategyParameters => ({
  minRewardRisk: parameters.minRewardRisk,
  premiumScoreThreshold: parameters.premiumScoreThreshold,
  atrLocationTolerance: parameters.atrLocationTolerance,
  atrTriggerBuffer: parameters.atrTriggerBuffer,
  atrStopBuffer: parameters.atrStopBuffer,
  atrInvalidationBuffer: parameters.atrInvalidationBuffer,
  crossMarketPrimaryInstruments: parameters.crossMarketPrimaryInstruments,
  setupScoreWeights: parameters.setupScoreWeights,
});

/** Mirrors today's hardcoded constants exactly, so any caller that omits `params`
 * behaves byte-identically to the pre-strategy-config pipeline. */
export const DEFAULT_STRATEGY_PARAMETERS: ResolvedStrategyParameters = {
  minRewardRisk: 2,
  premiumScoreThreshold: 70,
  atrLocationTolerance: 0.35,
  atrTriggerBuffer: 0.05,
  atrStopBuffer: 0.25,
  atrInvalidationBuffer: 0.1,
  crossMarketPrimaryInstruments: ['us500', 'us30'],
  setupScoreWeights: {
    trend: 20,
    structure: 20,
    momentum: 15,
    location: 15,
    crossMarket: 10,
    eventRisk: 5,
    rewardRisk: 10,
    patienceReadiness: 5,
  },
};
