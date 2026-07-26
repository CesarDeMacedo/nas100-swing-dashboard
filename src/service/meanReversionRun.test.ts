import { describe, expect, it } from 'vitest';

import {
  computeDouble7ExitWatchPrice,
  runMeanReversionBacktest,
  wilderAtr,
  type MeanReversionCandle,
  type MeanReversionParameters,
} from '../domain/meanReversionStrategy';
import type { StrategyConfig } from '../schemas/strategyConfig';
import {
  DEFAULT_MR_RISK_PER_TRADE_PCT,
  evaluateMeanReversionSignal,
  evaluateStrategyConfigLive,
  resolveMrAccountSize,
} from './meanReversionRun';

const bar = (
  index: number,
  close: number,
  overrides: Partial<MeanReversionCandle> = {},
): MeanReversionCandle => ({
  time: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  ...overrides,
});

const series = (closes: number[]) => closes.map((close, index) => bar(index, close));

// Same shape/values as the "enters on an N-bar closing low ... exits on an N-bar closing high"
// fixture in src/domain/meanReversionStrategy.test.ts: entry at index 6 (close 118), exit at
// index 7 (close 119). Extended with a HOLD bar (index 7 = 115, no exit) and a post-exit FLAT
// bar (index 8 = 121, no re-entry) for the evaluator-specific scenarios below.
const UPTREND_THEN_DIP = [100, 105, 110, 115, 120, 119, 118];
const UPTREND_THEN_EXIT = [...UPTREND_THEN_DIP, 119];
const UPTREND_THEN_HOLD = [...UPTREND_THEN_DIP, 115];
const UPTREND_THEN_FLAT_AGAIN = [...UPTREND_THEN_EXIT, 121];

const double7Params = (
  overrides: Partial<MeanReversionParameters> = {},
): MeanReversionParameters => ({
  kind: 'double7',
  timeframe: 'D',
  smaFilterPeriod: 5,
  rsiPeriod: 2,
  rsiEntryThreshold: 5,
  rsiExitThreshold: 65,
  lookbackEntryLow: 3,
  lookbackExitHigh: 3,
  protectiveStopAtrMultiple: null,
  atrPeriod: 2,
  maxBarsHeld: null,
  ...overrides,
});

const context = (overrides: Partial<Parameters<typeof evaluateMeanReversionSignal>[2]> = {}) => ({
  strategyConfigId: 'strategy:1',
  strategyId: 'strategy',
  version: 1,
  instrument: 'NAS100_USD',
  now: () => new Date('2026-01-10T00:00:00.000Z'),
  ...overrides,
});

describe('evaluateMeanReversionSignal', () => {
  it('reports FLAT before any entry condition has fired', () => {
    const evaluation = evaluateMeanReversionSignal(
      series(UPTREND_THEN_DIP.slice(0, 6)),
      double7Params(),
      context(),
    );
    expect(evaluation.signal).toBe('FLAT');
    expect(evaluation.stopPrice).toBeNull();
  });

  it('reports ENTER when the entry condition fires on the just-completed bar', () => {
    const candles = series(UPTREND_THEN_DIP);
    const evaluation = evaluateMeanReversionSignal(candles, double7Params(), context());
    expect(evaluation.signal).toBe('ENTER');
    expect(evaluation.referenceClose).toBe(118);
    expect(evaluation.referenceCandleTime).toBe(candles.at(-1)!.time);
  });

  it('reports HOLD while a position stays open past its entry bar with no exit yet', () => {
    const candles = series(UPTREND_THEN_HOLD);
    const evaluation = evaluateMeanReversionSignal(candles, double7Params(), context());
    expect(evaluation.signal).toBe('HOLD');
    expect(evaluation.referenceClose).toBe(115);
  });

  it('reports EXIT when the exit condition fires on the just-completed bar', () => {
    const candles = series(UPTREND_THEN_EXIT);
    const evaluation = evaluateMeanReversionSignal(candles, double7Params(), context());
    expect(evaluation.signal).toBe('EXIT');
    expect(evaluation.referenceClose).toBe(119);
  });

  it('reports FLAT again on the bar after an exit, once no new entry has fired', () => {
    const candles = series(UPTREND_THEN_FLAT_AGAIN);
    const evaluation = evaluateMeanReversionSignal(candles, double7Params(), context());
    expect(evaluation.signal).toBe('FLAT');
  });

  it('throws on an empty candle series', () => {
    expect(() => evaluateMeanReversionSignal([], double7Params(), context())).toThrow();
  });

  describe('SMA filter reporting', () => {
    it('reports the reference-bar SMA value and whether close is above it', () => {
      const candles = series(UPTREND_THEN_DIP);
      const evaluation = evaluateMeanReversionSignal(candles, double7Params(), context());
      expect(evaluation.smaFilterValue).not.toBeNull();
      expect(evaluation.aboveSmaFilter).toBe(
        evaluation.referenceClose > evaluation.smaFilterValue!,
      );
    });
  });

  describe('exitWatchPrice', () => {
    it('matches computeDouble7ExitWatchPrice on the reference bar while ENTER', () => {
      const candles = series(UPTREND_THEN_DIP);
      const evaluation = evaluateMeanReversionSignal(candles, double7Params(), context());
      const expected = computeDouble7ExitWatchPrice(
        candles.map((c) => c.close),
        3,
      );

      expect(evaluation.signal).toBe('ENTER');
      expect(evaluation.exitWatchPrice).toBe(expected);
      expect(evaluation.exitWatchPrice).not.toBeNull();
    });

    it('is recomputed off the current reference bar while HOLD (not frozen at entry)', () => {
      const candles = series(UPTREND_THEN_HOLD);
      const evaluation = evaluateMeanReversionSignal(candles, double7Params(), context());
      const expected = computeDouble7ExitWatchPrice(
        candles.map((c) => c.close),
        3,
      );

      expect(evaluation.signal).toBe('HOLD');
      expect(evaluation.exitWatchPrice).toBe(expected);
    });

    it('is null on FLAT (before entry) and on EXIT — there is no position to watch an exit for', () => {
      const beforeEntry = evaluateMeanReversionSignal(
        series(UPTREND_THEN_DIP.slice(0, 6)),
        double7Params(),
        context(),
      );
      const onExit = evaluateMeanReversionSignal(
        series(UPTREND_THEN_EXIT),
        double7Params(),
        context(),
      );

      expect(beforeEntry.signal).toBe('FLAT');
      expect(beforeEntry.exitWatchPrice).toBeNull();
      expect(onExit.signal).toBe('EXIT');
      expect(onExit.exitWatchPrice).toBeNull();
    });

    it('is null for rsi2, even in an open position, since its exit is not a single solvable price level', () => {
      const rsi2Closes = [...Array.from({ length: 30 }, () => 100), 130, 132, 118, 106, 131, 140];
      const rsi2Params: MeanReversionParameters = {
        ...double7Params(),
        kind: 'rsi2',
        smaFilterPeriod: 20,
        rsiEntryThreshold: 20,
        rsiExitThreshold: 80,
        atrPeriod: 2,
      };
      const { trades } = runMeanReversionBacktest(series(rsi2Closes), rsi2Params);
      const entryTime = trades[0]!.entryTime;
      const entryIndex = series(rsi2Closes).findIndex((c) => c.time === entryTime);
      const candlesThroughEntry = series(rsi2Closes).slice(0, entryIndex + 1);

      const evaluation = evaluateMeanReversionSignal(candlesThroughEntry, rsi2Params, context());
      expect(evaluation.signal).toBe('ENTER');
      expect(evaluation.exitWatchPrice).toBeNull();
    });
  });

  describe('stop price and position sizing', () => {
    const params = double7Params({ protectiveStopAtrMultiple: 2 });
    const candles = series(UPTREND_THEN_DIP);
    const expectedAtrAtEntry = wilderAtr(candles, params.atrPeriod).at(-1)!;

    it('computes stopPrice = entryPrice - multiple * ATR(atEntry) while a position is open', () => {
      const evaluation = evaluateMeanReversionSignal(candles, params, context());
      expect(evaluation.signal).toBe('ENTER');
      expect(evaluation.stopPrice).toBeCloseTo(118 - 2 * expectedAtrAtEntry, 10);
    });

    it('sizes the position from riskPerTradePct * accountSize / stop distance', () => {
      const evaluation = evaluateMeanReversionSignal(
        candles,
        params,
        context({ riskPerTradePct: 0.73, accountSize: 10000 }),
      );
      const expectedRiskAmount = 10000 * 0.0073;
      const expectedStopDistance = 2 * expectedAtrAtEntry;
      expect(evaluation.suggestedRiskAmount).toBeCloseTo(expectedRiskAmount, 10);
      expect(evaluation.suggestedPositionSizeUnits).toBeCloseTo(
        expectedRiskAmount / expectedStopDistance,
        10,
      );
    });

    it('defaults riskPerTradePct to 0.73 (the prop-desk decision) when unset', () => {
      const evaluation = evaluateMeanReversionSignal(candles, params, context());
      expect(evaluation.riskPerTradePct).toBe(DEFAULT_MR_RISK_PER_TRADE_PCT);
    });

    it('omits position sizing when account size is unknown', () => {
      const evaluation = evaluateMeanReversionSignal(
        candles,
        params,
        context({ accountSize: null }),
      );
      expect(evaluation.accountSize).toBeNull();
      expect(evaluation.suggestedRiskAmount).toBeNull();
      expect(evaluation.suggestedPositionSizeUnits).toBeNull();
      expect(evaluation.stopPrice).not.toBeNull();
    });

    it('never sizes a position when no protective stop is configured, even with a known account size', () => {
      const evaluation = evaluateMeanReversionSignal(
        candles,
        double7Params(),
        context({ accountSize: 10000 }),
      );
      expect(evaluation.stopPrice).toBeNull();
      expect(evaluation.suggestedPositionSizeUnits).toBeNull();
    });

    it('never sizes a position on FLAT/EXIT, even with a stop-configured strategy and known account size', () => {
      const evaluation = evaluateMeanReversionSignal(
        series(UPTREND_THEN_EXIT),
        params,
        context({ accountSize: 10000 }),
      );
      expect(evaluation.signal).toBe('EXIT');
      expect(evaluation.stopPrice).toBeNull();
      expect(evaluation.suggestedPositionSizeUnits).toBeNull();
    });
  });
});

describe('evaluateStrategyConfigLive', () => {
  const baseStrategy = (strategyKind: 'pipeline' | 'rsi2' | 'double7'): StrategyConfig => ({
    id: 'strategy:1',
    strategyId: 'strategy',
    version: 1,
    name: 'test',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    parameters: {
      minRewardRisk: 2,
      premiumScoreThreshold: 70,
      atrLocationTolerance: 0.35,
      atrTriggerBuffer: 0.05,
      atrStopBuffer: 0.25,
      atrInvalidationBuffer: 0.1,
      confirmationClosePositionThreshold: 0.6,
      crossMarketPrimaryInstruments: ['us500', 'us30'],
      invalidationAnchor: 'deepest',
      strategyKind,
      meanReversion: {
        timeframe: 'D',
        smaFilterPeriod: 5,
        rsiPeriod: 2,
        rsiEntryThreshold: 5,
        rsiExitThreshold: 65,
        lookbackEntryLow: 3,
        lookbackExitHigh: 3,
        protectiveStopAtrMultiple: 2,
        atrPeriod: 2,
        maxBarsHeld: null,
      },
      setupScoreWeights: {
        trend: 20,
        structure: 20,
        momentum: 15,
        location: 15,
        crossMarket: 10,
        eventRisk: 5,
        rewardRisk: 10,
        patienceReadiness: 5,
      },
      eventRisk: { blockingWindowMinutes: 60, minImpact: 'High' },
    },
  });

  const oandaCandles = (closes: number[]) =>
    closes.map((close, index) => ({
      time: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      isClosed: true,
      volume: null,
      instrument: 'NAS100_USD',
      timeframe: 'D' as const,
      source: 'oanda-v20' as const,
    }));

  it('returns null for pipeline-kind strategies (nothing to evaluate)', () => {
    const evaluation = evaluateStrategyConfigLive(baseStrategy('pipeline'), 'NAS100_USD', {
      D: oandaCandles(UPTREND_THEN_DIP),
    });
    expect(evaluation).toBeNull();
  });

  it('returns null when the strategy configured timeframe has no candles', () => {
    const evaluation = evaluateStrategyConfigLive(baseStrategy('double7'), 'NAS100_USD', {
      H4: oandaCandles(UPTREND_THEN_DIP),
    });
    expect(evaluation).toBeNull();
  });

  it('filters open candles and evaluates only completed bars', () => {
    const candles = [
      ...oandaCandles(UPTREND_THEN_DIP),
      { ...oandaCandles([200])[0]!, isClosed: false },
    ];
    const evaluation = evaluateStrategyConfigLive(baseStrategy('double7'), 'NAS100_USD', {
      D: candles,
    });
    expect(evaluation).not.toBeNull();
    expect(evaluation!.signal).toBe('ENTER');
    expect(evaluation!.referenceClose).toBe(118);
  });
});

describe('resolveMrAccountSize', () => {
  it('returns null when the env var is unset', () => {
    expect(resolveMrAccountSize({})).toBeNull();
  });

  it('returns null for a non-numeric or non-positive value', () => {
    expect(resolveMrAccountSize({ NAS100_MR_ACCOUNT_SIZE: 'not-a-number' })).toBeNull();
    expect(resolveMrAccountSize({ NAS100_MR_ACCOUNT_SIZE: '-100' })).toBeNull();
    expect(resolveMrAccountSize({ NAS100_MR_ACCOUNT_SIZE: '0' })).toBeNull();
  });

  it('parses a configured positive account size', () => {
    expect(resolveMrAccountSize({ NAS100_MR_ACCOUNT_SIZE: '50000' })).toBe(50000);
  });
});
