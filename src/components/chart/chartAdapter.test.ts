import candleDataset from '../../../mock/nas100-h4-candles.json';

import { parseAnalysis } from '../../domain/analysis';
import { parseCandleDataset } from '../../domain/candles';
import { currentAnalysisSource } from '../../domain/fixtures';
import {
  formatChartPrice,
  mapPriceLines,
  mapPriceZones,
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
