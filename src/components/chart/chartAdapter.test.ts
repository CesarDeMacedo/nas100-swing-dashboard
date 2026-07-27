import candleDataset from '../../../mock/nas100-h4-candles.json';

import { parseAnalysis } from '../../domain/analysis';
import { parseCandleDataset } from '../../domain/candles';
import { currentAnalysisSource } from '../../domain/fixtures';
import type { MeanReversionEvaluation } from '../../serviceClient/localAnalysisService';
import {
  formatChartPrice,
  mapMeanReversionPriceLines,
  mapPriceLines,
  mapPriceZones,
  selectVisibleSavedLevels,
  toChartCandles,
  type ChartPalette,
} from './chartAdapter';

const palette: ChartPalette = {
  positive: '#00aa66',
  negative: '#dd3344',
  warning: '#ffaa00',
  info: '#22bbdd',
  neutral: '#889999',
  surface: '#00111a',
  text: '#ffffff',
};

const analysisResult = parseAnalysis(currentAnalysisSource);
const candleResult = parseCandleDataset(candleDataset);

test('saved levels retain the three nearest relevant zones and report hidden count', () => {
  const source = structuredClone(currentAnalysisSource) as any;
  source.currentPrice = 100;
  source.supportZones = [90, 95, 98, 99].map((high, index) => ({
    id: `s${index}`,
    type: 'SUPPORT',
    low: high - 1,
    high,
    label: `s${index}`,
    source: 'OANDA',
    confidence: 70,
    lockedByUser: false,
  }));
  source.resistanceZones = [101, 105, 110, 120].map((low, index) => ({
    id: `r${index}`,
    type: 'RESISTANCE',
    low,
    high: low + 1,
    label: `r${index}`,
    source: 'OANDA',
    confidence: 70,
    lockedByUser: false,
  }));
  const result = selectVisibleSavedLevels(source);
  expect(result.supports).toHaveLength(3);
  expect(result.resistances).toHaveLength(3);
  expect(result.resistances.map((zone) => zone.low)).toEqual([101, 105, 110]);
  expect(result.hiddenCount).toBe(2);
});

if (!analysisResult.success || !candleResult.success) {
  throw new Error('Approved chart fixtures must validate before adapter tests run.');
}

const analysis = analysisResult.analysis;
const candles = candleResult.dataset.candles;

describe('Lightweight Charts adapter', () => {
  it('maps application candles to chronological chart data', () => {
    const output = toChartCandles(candles);

    expect(output).toHaveLength(90);
    expect(output[0]).toMatchObject({
      open: candles[0]?.open,
      high: candles[0]?.high,
      low: candles[0]?.low,
      close: candles[0]?.close,
    });
    expect(Number(output[1]?.time)).toBeGreaterThan(Number(output[0]?.time));
  });

  it('formats NAS100 chart prices to one decimal place', () => {
    expect(formatChartPrice(analysis.currentPrice)).toBe('29,082.0');
  });

  it('maps support, resistance, and preferred-entry zones from analysis data', () => {
    const zones = mapPriceZones(analysis, palette);

    expect(zones.filter((zone) => zone.emphasis === 'support')).toHaveLength(2);
    expect(zones.filter((zone) => zone.emphasis === 'resistance')).toHaveLength(2);
    expect(zones.filter((zone) => zone.emphasis === 'entry')).toHaveLength(1);
    expect(zones.find((zone) => zone.emphasis === 'support')).toMatchObject({
      low: analysis.supportZones[0]?.low,
      high: analysis.supportZones[0]?.high,
    });
  });

  it('maps current price, invalidation, stop, and targets to chart price lines', () => {
    const lines = mapPriceLines(analysis, candles.at(-1)!.close, palette);

    expect(lines.find((line) => line.id === 'analysis-current-price')?.price).toBe(
      analysis.currentPrice,
    );
    expect(lines.find((line) => line.id === 'invalidation')?.price).toBe(analysis.invalidation);
    expect(lines.find((line) => line.id === 'stop')?.price).toBe(analysis.stop);
    expect(lines.filter((line) => line.id.startsWith('target-')).map((line) => line.price)).toEqual(
      analysis.targets,
    );
  });

  it('adds a distinct completed-close line when analysis price differs', () => {
    const lines = mapPriceLines(analysis, analysis.currentPrice - 12, palette);

    expect(lines.find((line) => line.id === 'completed-candle-close')).toMatchObject({
      price: analysis.currentPrice - 12,
      title: 'Completed close',
    });
  });
});

const mrEvaluation = (
  timeframe: 'D' | 'H4',
  overrides: Partial<MeanReversionEvaluation> = {},
): MeanReversionEvaluation => ({
  id: `eval-${timeframe}`,
  strategyConfigId: `strategy:${timeframe}`,
  strategyId: `strategy-${timeframe}`,
  version: 1,
  instrument: 'NAS100_USD',
  timeframe,
  evaluatedAt: '2026-07-26T22:00:00.000Z',
  referenceCandleTime: '2026-07-26T21:00:00.000Z',
  referenceClose: 100,
  signal: 'HOLD',
  stopPrice: 95,
  exitWatchPrice: 110,
  atr: 2,
  smaFilterValue: 90,
  aboveSmaFilter: true,
  riskPerTradePct: 0.75,
  accountSize: 2500,
  suggestedRiskAmount: 18.75,
  suggestedPositionSizeUnits: 3.75,
  persistedAt: '2026-07-26T22:00:00.000Z',
  ...overrides,
});

describe('mapMeanReversionPriceLines', () => {
  it('draws entry, stop, and exit-watch lines for a D1 strategy in HOLD', () => {
    const lines = mapMeanReversionPriceLines([mrEvaluation('D')]);

    expect(lines).toEqual([
      expect.objectContaining({ id: 'mr-entry-D', price: 100, title: 'MR entry (D)' }),
      expect.objectContaining({ id: 'mr-stop-D', price: 95, title: 'MR stop (D)' }),
      expect.objectContaining({ id: 'mr-exit-watch-D', price: 110, title: 'MR exit watch (D)' }),
    ]);
  });

  it('draws entry, stop, and exit-watch lines for an H4 strategy identically — same behavior, timeframe-scoped ids/titles/colors', () => {
    const lines = mapMeanReversionPriceLines([
      mrEvaluation('H4', { referenceClose: 28500, stopPrice: 28200, exitWatchPrice: 29000 }),
    ]);

    expect(lines).toEqual([
      expect.objectContaining({ id: 'mr-entry-H4', price: 28500, title: 'MR entry (H4)' }),
      expect.objectContaining({ id: 'mr-stop-H4', price: 28200, title: 'MR stop (H4)' }),
      expect.objectContaining({
        id: 'mr-exit-watch-H4',
        price: 29000,
        title: 'MR exit watch (H4)',
      }),
    ]);
  });

  it('gives D1 and H4 distinct, non-overlapping colors so simultaneous positions are never visually ambiguous', () => {
    const [dEntry, dStop, dExit] = mapMeanReversionPriceLines([mrEvaluation('D')]);
    const [h4Entry, h4Stop, h4Exit] = mapMeanReversionPriceLines([mrEvaluation('H4')]);

    const allColors = [dEntry, dStop, dExit, h4Entry, h4Stop, h4Exit].map((line) => line!.color);
    expect(new Set(allColors).size).toBe(6);
  });

  it('draws both strategies together without id collisions when D1 and H4 are simultaneously active', () => {
    const lines = mapMeanReversionPriceLines([mrEvaluation('D'), mrEvaluation('H4')]);

    expect(lines).toHaveLength(6);
    expect(new Set(lines.map((line) => line.id)).size).toBe(6);
  });

  it('draws nothing for a strategy that is FLAT or has just EXITed — no stale line for a closed/nonexistent position', () => {
    const flatLines = mapMeanReversionPriceLines([
      mrEvaluation('H4', { signal: 'FLAT', stopPrice: null, exitWatchPrice: null }),
    ]);
    const exitLines = mapMeanReversionPriceLines([
      mrEvaluation('D', { signal: 'EXIT', stopPrice: null, exitWatchPrice: null }),
    ]);

    expect(flatLines).toEqual([]);
    expect(exitLines).toEqual([]);
  });

  it('omits the stop and exit-watch lines individually when their values are null, but keeps the entry line', () => {
    const lines = mapMeanReversionPriceLines([
      mrEvaluation('H4', { stopPrice: null, exitWatchPrice: null }),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: 'mr-entry-H4' });
  });

  it('draws nothing for an empty, null, or undefined evaluation list', () => {
    expect(mapMeanReversionPriceLines([])).toEqual([]);
    expect(mapMeanReversionPriceLines(null)).toEqual([]);
    expect(mapMeanReversionPriceLines(undefined)).toEqual([]);
  });
});
