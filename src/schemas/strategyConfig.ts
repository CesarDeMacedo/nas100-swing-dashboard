import { z } from 'zod';

import { NonEmptyStringSchema } from './primitives';

export const StrategyStatusSchema = z.enum(['draft', 'active', 'archived']);
export type StrategyStatus = z.infer<typeof StrategyStatusSchema>;

export const CrossMarketInstrumentKeySchema = z.enum(['us500', 'us30', 'russell2000']);

export const SetupScoreWeightsSchema = z
  .object({
    trend: z.number().min(0),
    structure: z.number().min(0),
    momentum: z.number().min(0),
    location: z.number().min(0),
    crossMarket: z.number().min(0),
    eventRisk: z.number().min(0),
    rewardRisk: z.number().min(0),
    patienceReadiness: z.number().min(0),
  })
  .refine(
    (weights) =>
      weights.trend +
        weights.structure +
        weights.momentum +
        weights.location +
        weights.crossMarket +
        weights.eventRisk +
        weights.rewardRisk +
        weights.patienceReadiness ===
      100,
    { message: 'setupScoreWeights must sum to exactly 100', params: { code: 'SETUP_SCORE_WEIGHTS_MUST_SUM_TO_100' } },
  );

/** The full parameter payload for a strategy version. `minRewardRisk` is a floor, never a
 * target — validated >= 2.0 here (the one Zod choke point every write path shares) in
 * addition to the SQLite CHECK constraint on the normalized `min_reward_risk` column, which
 * exists as defense-in-depth, not as the primary enforcement mechanism. */
export const StrategyParametersSchema = z.object({
  minRewardRisk: z.number().min(2.0, 'minRewardRisk must be >= 2.0'),
  premiumScoreThreshold: z.number().min(0).max(100),
  atrLocationTolerance: z.number().positive(),
  atrTriggerBuffer: z.number().positive(),
  atrStopBuffer: z.number().positive(),
  atrInvalidationBuffer: z.number().positive(),
  // Below 0.5 the long/short bar (threshold / 1-threshold) would stop meaning "closed toward
  // the favorable extreme" at all — 0.5 is the floor where both sides collapse to the midpoint.
  confirmationClosePositionThreshold: z.number().min(0.5, 'confirmationClosePositionThreshold must be >= 0.5').max(1.0),
  crossMarketPrimaryInstruments: z.array(CrossMarketInstrumentKeySchema).min(1),
  setupScoreWeights: SetupScoreWeightsSchema,
  // Out of scope for v1 replay (event-risk history isn't fetched/replayed yet), but present
  // for forward-compatibility since a "strategy" is expected to eventually own these too.
  eventRisk: z.object({
    blockingWindowMinutes: z.number().positive(),
    minImpact: z.enum(['High', 'Medium', 'Low']),
  }),
});
export type StrategyParameters = z.infer<typeof StrategyParametersSchema>;

export const StrategyConfigInputSchema = z.object({
  name: NonEmptyStringSchema,
  parameters: StrategyParametersSchema,
});
export type StrategyConfigInput = z.infer<typeof StrategyConfigInputSchema>;

export const StrategyConfigSchema = z.object({
  id: NonEmptyStringSchema,
  strategyId: NonEmptyStringSchema,
  version: z.number().int().positive(),
  name: NonEmptyStringSchema,
  status: StrategyStatusSchema,
  parameters: StrategyParametersSchema,
  createdAt: NonEmptyStringSchema,
});
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;
