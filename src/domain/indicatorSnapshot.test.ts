import currentAnalysis from '../../mock/current-analysis.json';
import candleDataset from '../../mock/nas100-h4-candles.json';
import longCandleDataset from '../../mock/nas100-h4-candles-long.json';
import { CandleDatasetSchema, type Candle } from '../schemas/candles';
import {
  calculateLatestIndicatorSnapshot,
  compareSnapshotToFixtureIndicators,
  latestCompletedCandle,
} from './indicators';

const closedCandles = candleDataset.candles as Candle[];
const longClosedCandles = longCandleDataset.candles as Candle[];

describe('latest indicator snapshot', () => {
  it('selects the latest completed candle', () => {
    const candles = [
      ...closedCandles,
      { ...closedCandles.at(-1)!, time: '2026-07-22T01:00:00-04:00', isClosed: false },
    ];

    expect(latestCompletedCandle(candles)?.time).toBe('2026-07-21T21:00:00-04:00');
  });

  it('returns available values for the current fixture where sufficient data exists', () => {
    const snapshot = calculateLatestIndicatorSnapshot(closedCandles, currentAnalysis.currentPrice);

    expect(snapshot.latestCompletedCandleTime).toBe('2026-07-21T21:00:00-04:00');
    expect(snapshot.ema5).toMatchObject({ status: 'available', period: 5 });
    expect(snapshot.ema50).toMatchObject({ status: 'available', period: 50 });
    expect(snapshot.rsi14).toMatchObject({ status: 'available', period: 14 });
    expect(snapshot.atr14).toMatchObject({ status: 'available', period: 14 });
    expect(snapshot.distanceFromEma20Atr.status).toBe('available');
  });

  it('returns insufficient_data for EMA200 using the 90-candle fixture', () => {
    const snapshot = calculateLatestIndicatorSnapshot(closedCandles, currentAnalysis.currentPrice);

    expect(snapshot.ema200).toEqual({
      value: null,
      period: 200,
      status: 'insufficient_data',
      sourceCandleTime: null,
    });
  });

  it('validates the long synthetic fixture and makes EMA200 available', () => {
    const parsed = CandleDatasetSchema.safeParse(longCandleDataset);
    const latestCandle = longClosedCandles.at(-1);

    expect(parsed.success).toBe(true);
    expect(longClosedCandles).toHaveLength(222);
    expect(longClosedCandles.every((candle) => candle.isClosed)).toBe(true);

    const snapshot = calculateLatestIndicatorSnapshot(
      longClosedCandles,
      latestCandle?.close ?? Number.NaN,
    );

    expect(snapshot.ema200.status).toBe('available');
    expect(snapshot.ema200.period).toBe(200);
    expect(snapshot.ema200.value).toEqual(expect.any(Number));
    expect(snapshot.ema200.sourceCandleTime).toBe(latestCandle?.time);
  });

  it('keeps long-history EMA200 calculations deterministic without mutating input', () => {
    const input = structuredClone(longClosedCandles);
    const before = structuredClone(input);
    const currentPrice = input.at(-1)?.close ?? Number.NaN;

    const first = calculateLatestIndicatorSnapshot(input, currentPrice);
    const second = calculateLatestIndicatorSnapshot(input, currentPrice);

    expect(first.ema200).toEqual(second.ema200);
    expect(input).toEqual(before);
  });

  it('calculates distance from EMA20 in ATR units without rounding', () => {
    const snapshot = calculateLatestIndicatorSnapshot(closedCandles, currentAnalysis.currentPrice);

    expect(snapshot.distanceFromEma20Atr.value).toBeCloseTo(
      (currentAnalysis.currentPrice - snapshot.ema20.value!) / snapshot.atr14.value!,
      12,
    );
    expect(snapshot.distanceFromEma20Atr.sourceCandleTime).toBe(snapshot.ema20.sourceCandleTime);
  });

  it('returns invalid_input for zero ATR14 and invalid current price', () => {
    const flatCandles = Array.from({ length: 20 }, (_, index) => ({
      time: `2026-02-${String(index + 1).padStart(2, '0')}T01:00:00-05:00`,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      isClosed: true,
    })) as Candle[];

    expect(calculateLatestIndicatorSnapshot(flatCandles, 100).distanceFromEma20Atr.status).toBe(
      'invalid_input',
    );
    expect(calculateLatestIndicatorSnapshot(closedCandles, Number.NaN).distanceFromEma20Atr.status).toBe(
      'invalid_input',
    );
  });

  it('excludes an open candle from every calculated value', () => {
    const snapshot = calculateLatestIndicatorSnapshot(closedCandles, currentAnalysis.currentPrice);
    const withOpen = calculateLatestIndicatorSnapshot(
      [
        ...closedCandles,
        { ...closedCandles.at(-1)!, time: '2026-07-22T01:00:00-04:00', close: 1, isClosed: false },
      ],
      currentAnalysis.currentPrice,
    );

    expect(withOpen).toEqual(snapshot);
  });

  it('is deterministic and does not mutate input candles', () => {
    const source = structuredClone(closedCandles);
    const before = structuredClone(source);

    expect(calculateLatestIndicatorSnapshot(source, currentAnalysis.currentPrice)).toEqual(
      calculateLatestIndicatorSnapshot(source, currentAnalysis.currentPrice),
    );
    expect(source).toEqual(before);
  });

  it('reports fixture differences without requiring a match', () => {
    const snapshot = calculateLatestIndicatorSnapshot(closedCandles, currentAnalysis.currentPrice);
    const comparison = compareSnapshotToFixtureIndicators(snapshot, currentAnalysis.indicators);

    expect(comparison.ema5).toMatchObject({ status: 'available', fixtureValue: 29018 });
    expect(comparison.ema200).toMatchObject({
      status: 'insufficient_data',
      calculatedValue: null,
      fixtureValue: 27850,
      difference: null,
    });
    expect(typeof comparison.ema5.difference).toBe('number');
  });
});
