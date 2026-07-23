import { describe, expect, it } from 'vitest';

import type { Candle } from '../schemas/candles';
import { calculateMarketLevels, MARKET_LEVEL_INVALIDATION_ATR_BUFFER, MARKET_LEVEL_ZONE_ATR_BUFFER } from './marketLevels';

const candles = (): Candle[] => Array.from({ length: 22 }, (_, index) => {
  const time = new Date(Date.UTC(2026, 6, 1, index * 4)).toISOString();
  const low = index === 5 ? 90 : 98;
  const high = index === 12 ? 120 : 108;
  return { time, open: 102, high, low, close: index === 21 ? 105 : 103, isClosed: index !== 21, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20' };
});

describe('deterministic H4 market levels', () => {
  it('uses completed confirmed swings only and leaves input unchanged', () => {
    const input = candles();
    const before = structuredClone(input);
    const result = calculateMarketLevels(input, 'long');

    expect(input).toEqual(before);
    expect(result.supportZones[0]).toMatchObject({ type: 'SUPPORT', lockedByUser: false });
    expect(result.resistanceZones[0]).toMatchObject({ type: 'RESISTANCE', lockedByUser: false });
    expect(JSON.stringify(result)).not.toContain('2026-07-04T12:00:00.000Z');
  });

  it('applies centralized ATR widths, sorts zones, and deduplicates overlapping swings', () => {
    const result = calculateMarketLevels(candles(), 'long');
    const support = result.supportZones[0]!;

    expect((support.high - support.low) / result.atrUsed!).toBeCloseTo(MARKET_LEVEL_ZONE_ATR_BUFFER * 2);
    expect(result.supportZones.map((item) => (item.low + item.high) / 2)).toEqual([...result.supportZones.map((item) => (item.low + item.high) / 2)].sort((left, right) => right - left));
    expect(result.resistanceZones.map((item) => (item.low + item.high) / 2)).toEqual([...result.resistanceZones.map((item) => (item.low + item.high) / 2)].sort((left, right) => left - right));
  });

  it('calculates directional preferred entries and informational invalidation candidates', () => {
    const long = calculateMarketLevels(candles(), 'long');
    const short = calculateMarketLevels(candles(), 'short');

    expect(long.preferredEntryZone).toMatchObject({ type: 'ENTRY' });
    expect(long.invalidationCandidate).toBeCloseTo(long.preferredEntryZone!.low - long.atrUsed! * MARKET_LEVEL_INVALIDATION_ATR_BUFFER);
    expect(short.preferredEntryZone).toMatchObject({ type: 'ENTRY' });
    expect(short.invalidationCandidate).toBeCloseTo(short.preferredEntryZone!.high + short.atrUsed! * MARKET_LEVEL_INVALIDATION_ATR_BUFFER);
    expect(calculateMarketLevels(candles(), 'none')).toMatchObject({ preferredEntryZone: null, invalidationCandidate: null });
  });

  it('fails safely with insufficient history or missing ATR', () => {
    expect(calculateMarketLevels(candles().slice(0, 5), 'long')).toMatchObject({ supportZones: [], resistanceZones: [], preferredEntryZone: null });
    const flat = candles().map((candle) => ({ ...candle, high: 100, low: 100, open: 100, close: 100 }));
    expect(calculateMarketLevels(flat, 'long')).toMatchObject({ supportZones: [], resistanceZones: [], preferredEntryZone: null, atrUsed: null });
  });
});
