// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { buildDashboardState } from '../../../src/application/buildDashboardState';
import { buildOandaMultiTimeframeInputs, type CrossMarketH4Results } from '../../../src/service/oandaRun';
import type { OandaCandle, OandaDailyCandleResult, OandaH4CandleResult } from '../../../src/providers/oanda/types';
import { generateReplayFrames } from '../replayEngine';
import { cutSeriesAt } from '../replayWindow';

const H4_MS = 4 * 60 * 60 * 1000;
const START = Date.parse('2025-01-05T00:00:00.000Z'); // a Sunday, so weekday math stays simple

/** A deterministic, non-flat synthetic H4 series — enough candles to warm up every indicator
 * (EMA200 needs >=200 closed candles), with OHLC values that always satisfy
 * `high >= max(open, close)` and `low <= min(open, close)` so `normalizeCandle`-style
 * invariants hold even though this bypasses OANDA normalization entirely. */
function makeSyntheticH4Series(count: number, instrument = 'NAS100_USD'): OandaCandle[] {
  const candles: OandaCandle[] = [];
  let close = 20000;
  for (let index = 0; index < count; index += 1) {
    const drift = Math.sin(index / 9) * 12 + (index % 5 === 0 ? 6 : -2);
    const open = close;
    close = open + drift;
    const high = Math.max(open, close) + 5;
    const low = Math.min(open, close) - 5;
    candles.push({
      time: new Date(START + index * H4_MS).toISOString(),
      open,
      high,
      low,
      close,
      isClosed: true,
      volume: 100,
      instrument,
      timeframe: 'H4',
      source: 'oanda-v20',
    });
  }
  return candles;
}

const asH4Result = (candles: OandaCandle[]): OandaH4CandleResult => ({
  provider: 'oanda-v20',
  environment: 'practice',
  instrument: 'NAS100_USD',
  timeframe: 'H4',
  candles: candles as OandaH4CandleResult['candles'],
});

const emptyDaily: OandaDailyCandleResult = { provider: 'oanda-v20', environment: 'practice', instrument: 'NAS100_USD', timeframe: 'D', candles: [] };
const noCrossMarket: CrossMarketH4Results = {};

const buildStateAt = (h4Candles: OandaCandle[], simulatedNowIso: string) => {
  const cut = cutSeriesAt(h4Candles, simulatedNowIso);
  const inputs = buildOandaMultiTimeframeInputs(asH4Result(cut), emptyDaily, simulatedNowIso, noCrossMarket, []);
  return buildDashboardState(inputs.analysis, inputs.candles, inputs.technicalContext);
};

describe('cutSeriesAt zero-lookahead guarantee', () => {
  it('produces byte-identical pipeline output whether or not future candles exist beyond the cutoff', () => {
    const full = makeSyntheticH4Series(260);
    const cutoffIndex = 220;
    const cutoffIso = full[cutoffIndex]!.time;

    const stateA = buildStateAt(full, cutoffIso);

    const extended = [...full, ...makeSyntheticH4Series(20, 'NAS100_USD').map((candle, index) => ({
      ...candle,
      time: new Date(Date.parse(full.at(-1)!.time) + (index + 1) * H4_MS).toISOString(),
    }))];
    const stateB = buildStateAt(extended, cutoffIso);

    expect(stateB).toEqual(stateA);
  });

  it('is monotonic: cutting at a later instant never returns fewer candles, and never returns a candle past the cutoff', () => {
    const full = makeSyntheticH4Series(50);
    let previousLength = 0;
    for (const candle of full) {
      const cut = cutSeriesAt(full, candle.time);
      expect(cut.length).toBeGreaterThanOrEqual(previousLength);
      expect(cut.every((c) => c.time <= candle.time)).toBe(true);
      previousLength = cut.length;
    }
  });

  it('never yields a replay frame whose series extend past its own simulatedNowIso', () => {
    const full = makeSyntheticH4Series(230);
    const crossMarket: CrossMarketH4Results = { us500: asH4Result(makeSyntheticH4Series(230, 'SPX500_USD')) };
    let frameCount = 0;
    for (const frame of generateReplayFrames({ h4: asH4Result(full), daily: emptyDaily, crossMarketH4: crossMarket }, 210)) {
      frameCount += 1;
      expect(frame.h4Source.candles.at(-1)!.time).toBe(frame.simulatedNowIso);
      expect(frame.h4Source.candles.every((c) => c.time <= frame.simulatedNowIso)).toBe(true);
      expect(frame.dailySource.candles.every((c) => c.time <= frame.simulatedNowIso)).toBe(true);
      for (const result of Object.values(frame.crossMarketH4)) {
        expect(result?.candles.every((c) => c.time <= frame.simulatedNowIso)).toBe(true);
      }
    }
    expect(frameCount).toBeGreaterThan(0);
  });
});
