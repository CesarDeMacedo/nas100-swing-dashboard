import currentAnalysis from '../../mock/current-analysis.json';

import { parseAnalysis } from './analysis';
import {
  actionFixtures,
  invalidAnalysisFixture,
  invalidDataHealthFixture,
  lowRewardRiskFixture,
  missingEventRiskFixture,
  openCandleFixture,
  staleDataFixture,
  staleSellFixture,
  unsupportedVersionFixture,
} from './fixtures';

describe('analysis parsing and safety enforcement', () => {
  it('validates and normalizes the committed analysis mock', () => {
    const result = parseAnalysis(currentAnalysis);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.analysis.id).toBe(currentAnalysis.id);
      expect(result.analysis.action).toBe('WAIT_FOR_PULLBACK');
      expect(result.analysis.latestCandleStatus).toBe('COMPLETED');
      expect(result.analysis.timeframe).toBe('H4');
    }
  });

  it('keeps structurally safe BUY and SELL fixtures actionable', () => {
    const buy = parseAnalysis(actionFixtures.BUY);
    const sell = parseAnalysis(actionFixtures.SELL);

    expect(buy.success && buy.analysis.action).toBe('BUY');
    expect(sell.success && sell.analysis.action).toBe('SELL');
  });

  it('accepts a valid WAIT report without entry requirements', () => {
    const result = parseAnalysis(actionFixtures.WAIT);

    expect(result.success && result.analysis.action).toBe('WAIT');
  });

  it('blocks BUY from an open H4 candle', () => {
    const result = parseAnalysis(openCandleFixture);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.analysis.originalAction).toBe('BUY');
      expect(result.analysis.action).toBe('WAIT_FOR_NEXT_4H_CLOSE');
      expect(result.analysis.safetyReason).toBe('open-candle');
    }
  });

  it('forces stale BUY and SELL input to NO_TRADE', () => {
    const buy = parseAnalysis(staleDataFixture);
    const sell = parseAnalysis(staleSellFixture);

    expect(buy.success && buy.analysis.action).toBe('NO_TRADE');
    expect(sell.success && sell.analysis.action).toBe('NO_TRADE');
  });

  it('blocks entry below the minimum reward-to-risk', () => {
    const result = parseAnalysis(lowRewardRiskFixture);

    expect(result.success && result.analysis.action).toBe('WAIT');
    expect(result.success && result.analysis.safetyReason).toBe('reward-risk');
  });

  it('blocks entry when no validated target is available', () => {
    const fixture = {
      ...(structuredClone(actionFixtures.BUY) as Record<string, unknown>),
      targets: [],
    };
    const result = parseAnalysis(fixture);

    expect(result.success && result.analysis.action).toBe('WAIT');
    expect(result.success && result.analysis.safetyReason).toBe('missing-targets');
  });

  it('blocks entry when data health is invalid', () => {
    const result = parseAnalysis(invalidDataHealthFixture);

    expect(result.success && result.analysis.action).toBe('NO_TRADE');
    expect(result.success && result.analysis.safetyReason).toBe('invalid-data-health');
  });

  it('blocks entry when provider status is unavailable', () => {
    const fixture = structuredClone(actionFixtures.BUY) as Record<string, unknown>;
    fixture.dataHealth = {
      ...(fixture.dataHealth as Record<string, unknown>),
      providerStatus: 'UNAVAILABLE',
    };
    const result = parseAnalysis(fixture);

    expect(result.success && result.analysis.action).toBe('NO_TRADE');
    expect(result.success && result.analysis.safetyReason).toBe('invalid-data-health');
  });

  it('blocks entry when event-risk information is missing', () => {
    const result = parseAnalysis(missingEventRiskFixture);

    expect(result.success && result.analysis.action).toBe('WAIT');
    expect(result.success && result.analysis.safetyReason).toBe('event-risk-unavailable');
  });

  it('blocks entry when an event has blocking severity', () => {
    const fixture = structuredClone(actionFixtures.BUY) as Record<string, unknown>;
    const events = fixture.eventRisk as Array<Record<string, unknown>>;
    fixture.eventRisk = [{ ...events[0], severity: 'BLOCKING', blocksEntry: false }];
    const result = parseAnalysis(fixture);

    expect(result.success && result.analysis.action).toBe('WAIT');
    expect(result.success && result.analysis.safetyReason).toBe('event-risk-blocking');
  });

  it('rejects unsupported future schema versions', () => {
    expect(parseAnalysis(unsupportedVersionFixture).success).toBe(false);
  });

  it('rejects an invalid analysis object', () => {
    expect(parseAnalysis(invalidAnalysisFixture).success).toBe(false);
  });
});
