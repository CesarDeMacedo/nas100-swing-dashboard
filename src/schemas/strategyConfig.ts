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
    {
      message: 'setupScoreWeights must sum to exactly 100',
      params: { code: 'SETUP_SCORE_WEIGHTS_MUST_SUM_TO_100' },
    },
  );

/** Which decision engine a strategy runs.
 * - 'pipeline': the original Daily Regime -> H4 Structure -> Trade Plan -> Patience Filter
 *   pipeline. `minRewardRisk` (>= 2.0) applies in full.
 * - 'rsi2' / 'double7': Connors-style condition-exit mean-reversion engines
 *   (src/domain/meanReversionStrategy.ts). These have NO planned target price, so the planned
 *   reward-to-risk floor is structurally inapplicable and is NOT consulted — an explicit,
 *   user-approved carve-out limited to these kinds; the pipeline keeps its floor untouched. */
export const StrategyKindSchema = z.enum(['pipeline', 'rsi2', 'double7']);
export type StrategyKind = z.infer<typeof StrategyKindSchema>;

export const MeanReversionParametersSchema = z.object({
  timeframe: z.enum(['D', 'H4']).default('D'),
  smaFilterPeriod: z.number().int().positive().default(200),
  rsiPeriod: z.number().int().positive().default(2),
  rsiEntryThreshold: z.number().min(0).max(100).default(5),
  rsiExitThreshold: z.number().min(0).max(100).default(65),
  lookbackEntryLow: z.number().int().positive().default(7),
  lookbackExitHigh: z.number().int().positive().default(7),
  protectiveStopAtrMultiple: z.number().positive().nullable().default(null),
  atrPeriod: z.number().int().positive().default(14),
  maxBarsHeld: z.number().int().positive().nullable().default(null),
});
export type MeanReversionConfigParameters = z.infer<typeof MeanReversionParametersSchema>;

/** The full parameter payload for a strategy version. `minRewardRisk` is a floor, never a
 * target — validated >= 2.0 here (the one Zod choke point every write path shares) in
 * addition to the SQLite CHECK constraint on the normalized `min_reward_risk` column, which
 * exists as defense-in-depth, not as the primary enforcement mechanism. It governs the
 * 'pipeline' strategy kind; the mean-reversion kinds are condition-exit systems with no
 * planned target and never read it (see StrategyKindSchema). */
export const StrategyParametersSchema = z.object({
  minRewardRisk: z.number().min(2.0, 'minRewardRisk must be >= 2.0'),
  premiumScoreThreshold: z.number().min(0).max(100),
  atrLocationTolerance: z.number().positive(),
  atrTriggerBuffer: z.number().positive(),
  atrStopBuffer: z.number().positive(),
  atrInvalidationBuffer: z.number().positive(),
  // Below 0.5 the long/short bar (threshold / 1-threshold) would stop meaning "closed toward
  // the favorable extreme" at all — 0.5 is the floor where both sides collapse to the midpoint.
  confirmationClosePositionThreshold: z
    .number()
    .min(0.5, 'confirmationClosePositionThreshold must be >= 0.5')
    .max(1.0),
  // An empty array is a deliberate opt-out of the primary cross-market gate entirely (see
  // patienceFilter.ts) — not a mistake, so no .min(1) floor here.
  crossMarketPrimaryInstruments: z.array(CrossMarketInstrumentKeySchema),
  // Defaulted (not required) so configs persisted before this parameter existed keep parsing;
  // 'deepest' is the behavior they were created under (see strategyParameters.ts).
  invalidationAnchor: z.enum(['deepest', 'traded_zone']).default('deepest'),
  // Defaulted so every pre-existing config remains a 'pipeline' strategy unchanged.
  strategyKind: StrategyKindSchema.default('pipeline'),
  // Present (with defaults) on every config for schema uniformity; only consulted when
  // strategyKind is 'rsi2' or 'double7'. The literal default mirrors
  // DEFAULT_MEAN_REVERSION_PARAMETERS (src/domain/meanReversionStrategy.ts).
  meanReversion: MeanReversionParametersSchema.default({
    timeframe: 'D',
    smaFilterPeriod: 200,
    rsiPeriod: 2,
    rsiEntryThreshold: 5,
    rsiExitThreshold: 65,
    lookbackEntryLow: 7,
    lookbackExitHigh: 7,
    protectiveStopAtrMultiple: null,
    atrPeriod: 14,
    maxBarsHeld: null,
  }),
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
