import { DEFAULT_STRATEGY_PARAMETERS, resolveStrategyParameters } from './strategyParameters';

// Configs persisted before a parameter existed reach resolveStrategyParameters without that
// field (stored JSON is cast on read, never re-parsed through Zod). Resolution must fall back
// to the value those configs were created under — resolving to `undefined` silently breaks
// downstream numeric comparisons (e.g. `candlePosition >= undefined` is always false, which
// made confirmation permanently impossible for pre-parameterization configs).
describe('resolveStrategyParameters backward compatibility', () => {
  const legacyParameters = {
    minRewardRisk: 2,
    premiumScoreThreshold: 70,
    atrLocationTolerance: 0.35,
    atrTriggerBuffer: 0.05,
    atrStopBuffer: 0.25,
    atrInvalidationBuffer: 0.1,
    crossMarketPrimaryInstruments: ['us500', 'us30'] as const,
    setupScoreWeights: DEFAULT_STRATEGY_PARAMETERS.setupScoreWeights,
  };

  it('fills defaults for fields absent from configs persisted before those parameters existed', () => {
    const resolved = resolveStrategyParameters(legacyParameters);

    expect(resolved.confirmationClosePositionThreshold).toBe(0.6);
    expect(resolved.invalidationAnchor).toBe('deepest');
  });

  it('preserves explicitly stored values over the defaults', () => {
    const resolved = resolveStrategyParameters({
      ...legacyParameters,
      confirmationClosePositionThreshold: 0.55,
      invalidationAnchor: 'traded_zone',
    });

    expect(resolved.confirmationClosePositionThreshold).toBe(0.55);
    expect(resolved.invalidationAnchor).toBe('traded_zone');
  });
});
