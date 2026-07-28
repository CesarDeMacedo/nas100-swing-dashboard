import type { DataFreshness, ProviderStatus } from '../schemas/enums';
import { DEFAULT_STRATEGY_PARAMETERS, type ResolvedStrategyParameters } from './strategyParameters';
import type { TechnicalContext } from './technicalContext';

export type EntryDirection = 'long' | 'short';
export type PatienceFilterStatus = 'allowed' | 'blocked' | 'waiting' | 'unavailable';
export type EntryLocation = 'acceptable' | 'too_extended' | 'not_reached' | 'invalid' | 'unknown';
export type ConfirmationCandle = 'confirmed' | 'missing' | 'invalid' | 'open' | 'unknown';
export type EventRiskState = 'clear' | 'blocking' | 'unknown' | 'invalid';
export type DirectionalConfirmation = 'confirming' | 'contradicting' | 'neutral' | 'unknown';

export type CrossMarketInput = Record<
  'us500' | 'us30' | 'russell2000',
  Record<EntryDirection, DirectionalConfirmation>
>;

export type PatienceFilterInput = {
  technicalContext: TechnicalContext | null;
  dataFreshness: DataFreshness;
  providerStatus: ProviderStatus;
  eventRisk: EventRiskState;
  estimatedRR: number | null;
  entryLocation: EntryLocation;
  confirmationCandle: ConfirmationCandle;
  crossMarket: CrossMarketInput;
  structurallyInvalidated: boolean;
  stop: number | null;
  targets: readonly number[] | null;
};

export type PatienceFilterResult = {
  direction: EntryDirection;
  status: PatienceFilterStatus;
  canEnter: boolean;
  blockingReasons: string[];
  waitingReasons: string[];
  passedChecks: string[];
  failedChecks: string[];
  missingInputs: string[];
  sourceCandleTime: string | null;
};

const availableProviders: readonly ProviderStatus[] = ['HEALTHY', 'MOCK'];
const freshData: readonly DataFreshness[] = ['FRESH', 'MOCK'];

const validPositiveNumber = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export function evaluatePatienceFilter(
  direction: EntryDirection,
  input: PatienceFilterInput,
  params: ResolvedStrategyParameters = DEFAULT_STRATEGY_PARAMETERS,
): PatienceFilterResult {
  const passedChecks: string[] = [];
  const blockingReasons: string[] = [];
  const waitingReasons: string[] = [];
  const missingInputs: string[] = [];
  const context = input.technicalContext;

  if (!context) {
    missingInputs.push('technicalContext');
  } else {
    if (context.latestCandleStatus === 'COMPLETED') passedChecks.push('latest_candle_completed');
    else blockingReasons.push('Latest candle is not completed');

    if (context.status === 'ready') passedChecks.push('technical_context_ready');
    else if (context.status === 'partial') waitingReasons.push('Technical context is incomplete');
    else blockingReasons.push('Technical context is unavailable');
  }

  if (freshData.includes(input.dataFreshness)) passedChecks.push('data_fresh');
  else if (input.dataFreshness === 'STALE') blockingReasons.push('Market data is stale');
  else blockingReasons.push('Market data is unavailable or invalid');

  if (availableProviders.includes(input.providerStatus)) passedChecks.push('provider_available');
  else blockingReasons.push('Market-data provider is unavailable');

  // Event risk is advisory only (not a hard gate): it no longer blocks or delays entry, so the
  // trader can weigh it manually instead of the filter silently withholding the signal.
  if (input.eventRisk === 'clear') passedChecks.push('event_risk_clear');

  if (input.estimatedRR === null || !Number.isFinite(input.estimatedRR)) {
    missingInputs.push('estimatedRR');
  } else if (input.estimatedRR < params.minRewardRisk) {
    blockingReasons.push(`Estimated reward-to-risk is below ${params.minRewardRisk.toFixed(1)}`);
  } else {
    passedChecks.push('minimum_reward_to_risk');
  }

  if (input.entryLocation === 'acceptable') passedChecks.push('entry_location_acceptable');
  else if (input.entryLocation === 'not_reached' || input.entryLocation === 'unknown') {
    waitingReasons.push('Entry location has not been reached');
  } else blockingReasons.push('Entry location is invalid or too extended');

  if (input.confirmationCandle === 'confirmed') passedChecks.push('confirmation_candle_valid');
  else if (
    input.confirmationCandle === 'missing' ||
    input.confirmationCandle === 'open' ||
    input.confirmationCandle === 'unknown'
  ) {
    waitingReasons.push('Confirmation candle is not yet valid');
  } else blockingReasons.push('Confirmation candle is invalid');

  // Cross-market confirmation is advisory only (not a hard gate): a contradicting or incomplete
  // primary signal no longer blocks or delays entry, so the trader can weigh it manually instead
  // of the filter silently withholding the signal.
  const primarySignals = params.crossMarketPrimaryInstruments.map((key) => input.crossMarket[key][direction]);
  if (primarySignals.includes('confirming')) passedChecks.push('primary_cross_market_confirmation');
  const supplementaryInstruments = (['us500', 'us30', 'russell2000'] as const).filter(
    (key) => !params.crossMarketPrimaryInstruments.includes(key),
  );
  if (supplementaryInstruments.some((key) => input.crossMarket[key][direction] === 'confirming')) {
    passedChecks.push('supplementary_cross_market_supportive');
  }

  if (input.structurallyInvalidated) blockingReasons.push('Structural invalidation has occurred');
  else passedChecks.push('no_structural_invalidation');

  const validTargets = input.targets?.length && input.targets.every((target) => validPositiveNumber(target));
  if (!validPositiveNumber(input.stop) || !validTargets) {
    blockingReasons.push('Required stop or target inputs are unavailable or invalid');
  } else {
    passedChecks.push('stop_and_targets_available');
  }

  const failedChecks = [...blockingReasons, ...waitingReasons];
  const status: PatienceFilterStatus =
    missingInputs.length > 0
      ? 'unavailable'
      : blockingReasons.length > 0
        ? 'blocked'
        : waitingReasons.length > 0
          ? 'waiting'
          : 'allowed';

  return {
    direction,
    status,
    canEnter: status === 'allowed',
    blockingReasons,
    waitingReasons,
    passedChecks,
    failedChecks,
    missingInputs,
    sourceCandleTime: context?.sourceCandleTime ?? null,
  };
}
