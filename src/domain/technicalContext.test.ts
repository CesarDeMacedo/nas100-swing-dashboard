import currentAnalysis from '../../mock/current-analysis.json';
import candleDataset from '../../mock/nas100-h4-candles.json';
import type { Candle } from '../schemas/candles';
import {
  buildTechnicalContext,
  compareTechnicalContextToFixture,
  mapCanonicalDailyRegimeToLegacy,
  mapCanonicalH4StructureToLegacy,
} from './technicalContext';

const fixtureCandles = candleDataset.candles as Candle[];

const longCandles = (length = 210): Candle[] =>
  Array.from({ length }, (_, index) => {
    const close = 100 + index;
    return {
      time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString().replace('Z', '-05:00'),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      isClosed: true,
    };
  });

describe('technical context', () => {
  it('builds a ready context from complete indicator and classifier inputs', () => {
    const candles = longCandles();
    const context = buildTechnicalContext(candles);

    expect(context).toMatchObject({
      status: 'ready',
      latestCandleStatus: 'COMPLETED',
      sourceCandleTime: candles.at(-1)!.time,
    });
    expect(context.indicatorSnapshot.ema200.status).toBe('available');
  });

  it('builds a partial context when EMA200 is unavailable', () => {
    const context = buildTechnicalContext(fixtureCandles);

    expect(context.status).toBe('partial');
    expect(context.warnings).toContain('EMA200 is unavailable');
    expect(context.warnings).toContain('Daily regime is unavailable');
  });

  it('is unavailable without a completed candle', () => {
    const context = buildTechnicalContext([{ ...fixtureCandles[0]!, isClosed: false }]);

    expect(context).toMatchObject({
      status: 'unavailable',
      latestCandleStatus: 'OPEN',
      sourceCandleTime: null,
    });
    expect(context.warnings).toContain('Latest candle is open and excluded from technical context');
  });

  it('maps canonical daily and H4 classifications to legacy report values', () => {
    expect(mapCanonicalDailyRegimeToLegacy('strong_bullish')).toBe('BULLISH');
    expect(mapCanonicalDailyRegimeToLegacy('defensive_bearish')).toBe('DEFENSIVE_BEARISH');
    expect(mapCanonicalH4StructureToLegacy('bullish_breakout')).toBe('BREAKOUT');
    expect(mapCanonicalH4StructureToLegacy('bearish_reversal_attempt')).toBe('UNKNOWN');
  });

  it('rejects unsupported canonical mapping values safely', () => {
    expect(mapCanonicalDailyRegimeToLegacy('unavailable')).toBeNull();
    expect(mapCanonicalDailyRegimeToLegacy('not_a_regime')).toBeNull();
    expect(mapCanonicalH4StructureToLegacy('unavailable')).toBeNull();
    expect(mapCanonicalH4StructureToLegacy('not_a_structure')).toBeNull();
  });

  it('propagates the latest completed source candle and excludes a later open candle', () => {
    const expected = buildTechnicalContext(fixtureCandles);
    const withOpen = [
      ...fixtureCandles,
      { ...fixtureCandles.at(-1)!, time: '2026-07-22T01:00:00-04:00', isClosed: false },
    ];
    const context = buildTechnicalContext(withOpen);

    expect(context.sourceCandleTime).toBe(fixtureCandles.at(-1)!.time);
    expect(context.indicatorSnapshot).toEqual(expected.indicatorSnapshot);
    expect(context.warnings).toContain('Latest candle is open and excluded from technical context');
  });

  it('is deterministic and does not mutate its input', () => {
    const source = longCandles();
    const before = structuredClone(source);

    expect(buildTechnicalContext(source)).toEqual(buildTechnicalContext(source));
    expect(source).toEqual(before);
  });

  it('reports fixture differences without requiring static fixture parity', () => {
    const context = buildTechnicalContext(fixtureCandles);
    const comparison = compareTechnicalContextToFixture(context, currentAnalysis);

    expect(comparison.dailyRegime.fixture).toBe(currentAnalysis.dailyRegime);
    expect(comparison.h4Structure.fixture).toBe(currentAnalysis.h4Structure);
    expect(comparison.indicators.ema5.fixture).toBe(currentAnalysis.indicators.ema5);
    expect(comparison.indicators.ema5.difference).toEqual(expect.any(Number));
  });
});
