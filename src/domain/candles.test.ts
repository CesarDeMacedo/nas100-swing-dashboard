import candleDataset from '../../mock/nas100-h4-candles.json';

import { CandleDatasetSchema, CandleSchema, parseCandleDataset } from './candles';

const cloneDataset = () => structuredClone(candleDataset);

describe('candle dataset validation', () => {
  it('validates the deterministic synthetic H4 dataset', () => {
    const result = parseCandleDataset(candleDataset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.dataset.candles).toHaveLength(90);
      expect(result.dataset.isSynthetic).toBe(true);
      expect(result.dataset.schemaVersion).toBe('1.0.0');
      expect(result.dataset.timeframe).toBe('H4');
      expect(result.dataset.candles.at(-1)?.isClosed).toBe(true);
    }
  });

  it('requires the completed-candle field', () => {
    const candle = structuredClone(candleDataset.candles[0]) as Record<string, unknown>;
    delete candle.isClosed;

    expect(CandleSchema.safeParse(candle).success).toBe(false);
  });

  it('rejects candles that are not chronologically ordered', () => {
    const dataset = cloneDataset();
    [dataset.candles[4], dataset.candles[5]] = [dataset.candles[5], dataset.candles[4]];

    expect(CandleDatasetSchema.safeParse(dataset).success).toBe(false);
  });

  it('rejects duplicate candle timestamps', () => {
    const dataset = cloneDataset();
    dataset.candles[10]!.time = dataset.candles[9]!.time;
    const result = CandleDatasetSchema.safeParse(dataset);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('unique'))).toBe(true);
    }
  });

  it('rejects inconsistent OHLC values', () => {
    const dataset = cloneDataset();
    dataset.candles[12]!.high = dataset.candles[12]!.low - 1;

    expect(CandleDatasetSchema.safeParse(dataset).success).toBe(false);
  });

  it('rejects an unsupported candle dataset version', () => {
    const dataset = cloneDataset() as { schemaVersion: string } & ReturnType<typeof cloneDataset>;
    dataset.schemaVersion = '2.0.0';

    expect(parseCandleDataset(dataset).success).toBe(false);
  });
});
