import {
  DEFAULT_MEAN_REVERSION_PARAMETERS,
  type MeanReversionParameters,
} from './meanReversionStrategy';

export type CrossMarketInstrumentKey = 'us500' | 'us30' | 'russell2000';

export type StrategyKind = 'pipeline' | 'rsi2' | 'double7';

/** Which structural level anchors invalidation (and therefore the stop):
 * - 'deepest': the lowest/highest of ALL candidate levels (every nearby zone plus the recent
 *   swing) — the historical behavior. Risk is measured to the farthest structure while the
 *   first target is the nearest one, so planned R:R systematically undershoots.
 * - 'traded_zone': the zone the entry is actually being taken against (the same `nearZone`
 *   that defines entry location and the confirmation boundary), falling back to the recent
 *   swing when the entry is EMA-anchored. Risk and reward then reference the same structure. */
export type InvalidationAnchor = 'deepest' | 'traded_zone';

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
  /** Minimum normalized close position (0 = closed at the candle's low, 1 = closed at its high)
   * required to confirm a long entry candle. The short side mirrors this at `1 - threshold` (so
   * the default 0.6 keeps today's exact 0.6/0.4 long/short pair) — see tradePlan.ts. */
  confirmationClosePositionThreshold: number;
  crossMarketPrimaryInstruments: readonly CrossMarketInstrumentKey[];
  invalidationAnchor: InvalidationAnchor;
  setupScoreWeights: SetupScoreWeights;
  /** Which decision engine this strategy runs. 'pipeline' is the original gate pipeline (the
   * minRewardRisk floor applies in full); 'rsi2'/'double7' are condition-exit mean-reversion
   * engines that have no planned target and therefore never consult the floor. */
  strategyKind: StrategyKind;
  /** Engine parameters for the mean-reversion kinds; carries defaults on every strategy for
   * uniformity but is only consulted when strategyKind is 'rsi2' or 'double7'. `kind` is
   * intentionally NOT stored here — it is derived from strategyKind at resolution time. */
  meanReversion: Omit<MeanReversionParameters, 'kind'>;
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
  /** Optional because configs persisted before this parameter was extracted don't carry it —
   * their stored JSON bypasses the Zod default on read (`toStrategyConfig` is a raw cast).
   * Without the `?? 0.6` fallback below, such configs resolve this to `undefined` and the
   * confirmation test `candlePosition >= undefined` is permanently false — silently making
   * confirmation (and therefore any signal) impossible for every pre-parameterization config. */
  confirmationClosePositionThreshold?: number;
  crossMarketPrimaryInstruments: readonly CrossMarketInstrumentKey[];
  /** Optional because configs persisted before this parameter existed don't carry it; absent
   * means 'deepest', the behavior those configs were created (and backtested) under. */
  invalidationAnchor?: InvalidationAnchor;
  setupScoreWeights: SetupScoreWeights;
  /** Optional for the same backward-compatibility reason: absent means 'pipeline'. */
  strategyKind?: StrategyKind;
  meanReversion?: Omit<MeanReversionParameters, 'kind'>;
}): ResolvedStrategyParameters => ({
  minRewardRisk: parameters.minRewardRisk,
  premiumScoreThreshold: parameters.premiumScoreThreshold,
  atrLocationTolerance: parameters.atrLocationTolerance,
  atrTriggerBuffer: parameters.atrTriggerBuffer,
  atrStopBuffer: parameters.atrStopBuffer,
  atrInvalidationBuffer: parameters.atrInvalidationBuffer,
  confirmationClosePositionThreshold: parameters.confirmationClosePositionThreshold ?? 0.6,
  crossMarketPrimaryInstruments: parameters.crossMarketPrimaryInstruments,
  invalidationAnchor: parameters.invalidationAnchor ?? 'deepest',
  setupScoreWeights: parameters.setupScoreWeights,
  strategyKind: parameters.strategyKind ?? 'pipeline',
  meanReversion: parameters.meanReversion ?? DEFAULT_MEAN_REVERSION_PARAMETERS,
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
  confirmationClosePositionThreshold: 0.6,
  crossMarketPrimaryInstruments: ['us500', 'us30'],
  invalidationAnchor: 'deepest',
  strategyKind: 'pipeline',
  meanReversion: DEFAULT_MEAN_REVERSION_PARAMETERS,
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
