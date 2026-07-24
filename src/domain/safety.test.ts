import { parseAnalysis } from './analysis';
import { actionFixtures } from './fixtures';

/**
 * Dedicated coverage for src/domain/safety.ts — the final gate that converts a
 * structurally valid but unsafe BUY/SELL into a non-actionable state. Complements the
 * broader parsing tests in analysis.test.ts by exercising every SafetyReason branch,
 * including the ones not reached there (invalid-data, unknown-candle) and the
 * fully-safe passthrough.
 */
describe('enforceAnalysisSafety', () => {
  it('leaves a fully safe, actionable BUY untouched with no safetyReason', () => {
    const result = parseAnalysis(actionFixtures.BUY);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.analysis.action).toBe('BUY');
    expect(result.analysis.safetyReason).toBeUndefined();
    expect(result.analysis.originalAction).toBeUndefined();
  });

  it('blocks required market data that is missing or invalid', () => {
    const missing = structuredClone(actionFixtures.BUY) as Record<string, unknown>;
    missing.dataFreshness = 'MISSING';
    const invalid = structuredClone(actionFixtures.BUY) as Record<string, unknown>;
    invalid.dataFreshness = 'INVALID';

    const missingResult = parseAnalysis(missing);
    const invalidResult = parseAnalysis(invalid);

    expect(missingResult.success && missingResult.analysis.action).toBe('NO_TRADE');
    expect(missingResult.success && missingResult.analysis.safetyReason).toBe('invalid-data');
    expect(missingResult.success && missingResult.analysis.originalAction).toBe('BUY');
    expect(invalidResult.success && invalidResult.analysis.action).toBe('NO_TRADE');
    expect(invalidResult.success && invalidResult.analysis.safetyReason).toBe('invalid-data');
  });

  it('waits for an unconfirmed candle close distinctly from an open candle', () => {
    const fixture = structuredClone(actionFixtures.BUY) as Record<string, unknown>;
    fixture.latestCandleStatus = 'UNKNOWN';
    fixture.dataHealth = { ...(fixture.dataHealth as Record<string, unknown>), latestCandleClosed: false };

    const result = parseAnalysis(fixture);

    expect(result.success && result.analysis.action).toBe('WAIT_FOR_NEXT_4H_CLOSE');
    expect(result.success && result.analysis.safetyReason).toBe('unknown-candle');
  });

  it('never downgrades a non-entry action for candle, event-risk, or R:R reasons', () => {
    const waitFixture = structuredClone(actionFixtures.WAIT) as Record<string, unknown>;
    waitFixture.latestCandleStatus = 'OPEN';
    waitFixture.dataHealth = { ...(waitFixture.dataHealth as Record<string, unknown>), latestCandleClosed: false };
    delete waitFixture.eventRisk;
    waitFixture.estimatedRR = 0;

    const result = parseAnalysis(waitFixture);

    expect(result.success && result.analysis.action).toBe('WAIT');
    expect(result.success && result.analysis.safetyReason).toBeUndefined();
  });

  it('treats a missing estimatedRR the same as one below the 2.0 minimum', () => {
    const fixture = structuredClone(actionFixtures.BUY) as Record<string, unknown>;
    delete fixture.estimatedRR;

    const result = parseAnalysis(fixture);

    expect(result.success && result.analysis.action).toBe('WAIT');
    expect(result.success && result.analysis.safetyReason).toBe('reward-risk');
  });

  it('prepends the safety message without duplicating it on repeated evaluation', () => {
    const fixture = structuredClone(actionFixtures.BUY) as Record<string, unknown>;
    fixture.latestCandleStatus = 'OPEN';
    fixture.dataHealth = { ...(fixture.dataHealth as Record<string, unknown>), latestCandleClosed: false };
    fixture.whyNoEntry = ['An open H4 candle cannot authorize an entry.', 'Existing unrelated reason.'];

    const result = parseAnalysis(fixture);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const occurrences = result.analysis.whyNoEntry.filter((reason) => reason === 'An open H4 candle cannot authorize an entry.');
    expect(occurrences).toHaveLength(1);
    expect(result.analysis.whyNoEntry[0]).toBe('An open H4 candle cannot authorize an entry.');
  });
});
