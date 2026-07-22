import currentAnalysis from '../../mock/current-analysis.json';

import { parseAnalysis } from './analysis';
import {
  normalizeAction,
  normalizeAnalysisInput,
  normalizeTimeframe,
  normalizeTimestamp,
} from './normalization';

describe('incoming data normalization', () => {
  it.each([
    ['4H', 'H4'],
    ['H4', 'H4'],
    [' h4 ', 'H4'],
  ])('normalizes timeframe %s to %s', (input, expected) => {
    expect(normalizeTimeframe(input)).toBe(expected);
  });

  it.each([
    ['NO TRADE', 'NO_TRADE'],
    ['wait-for-pullback', 'WAIT_FOR_PULLBACK'],
    ['WAIT FOR NEXT H4 CLOSE', 'WAIT_FOR_NEXT_4H_CLOSE'],
  ])('normalizes action label %s to %s', (input, expected) => {
    expect(normalizeAction(input)).toBe(expected);
  });

  it('normalizes valid timestamps to UTC RFC 3339 and preserves invalid timestamps', () => {
    expect(normalizeTimestamp('2026-07-21T21:00:00-04:00')).toBe('2026-07-22T01:00:00.000Z');
    expect(normalizeTimestamp('not-a-timestamp')).toBe('not-a-timestamp');
  });

  it('defaults optional narrative and event arrays without inventing trading facts', () => {
    const source = structuredClone(currentAnalysis) as Record<string, unknown>;
    delete source.whyNoEntry;
    delete source.whatToDoNext;
    delete source.marketContext;
    delete source.eventRisk;

    const normalized = normalizeAnalysisInput(source) as Record<string, unknown>;

    expect(normalized.whyNoEntry).toEqual([]);
    expect(normalized.whatToDoNext).toEqual([]);
    expect(normalized.marketContext).toEqual([]);
    expect(normalized.eventRisk).toEqual([]);
    expect(normalized.currentPrice).toBe(currentAnalysis.currentPrice);
    expect(normalized.score).toBe(currentAnalysis.score);
    expect(normalized.latestCandleStatus).toBe(currentAnalysis.latestCandleStatus);
  });

  it('normalizes legacy label casing before schema validation', () => {
    const source = {
      ...structuredClone(currentAnalysis),
      timeframe: '4H',
      action: 'wait for pullback',
      dataFreshness: 'mock',
      status: 'setup forming',
    };

    const result = parseAnalysis(source);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.analysis.timeframe).toBe('H4');
      expect(result.analysis.action).toBe('WAIT_FOR_PULLBACK');
      expect(result.analysis.dataFreshness).toBe('MOCK');
      expect(result.analysis.status).toBe('SETUP_FORMING');
    }
  });

  it('does not invent required score, price, indicator, or candle-status values', () => {
    const source = structuredClone(currentAnalysis) as Record<string, unknown>;
    delete source.score;
    delete source.currentPrice;
    delete source.indicators;
    delete source.latestCandleStatus;

    expect(parseAnalysis(source).success).toBe(false);
  });
});
