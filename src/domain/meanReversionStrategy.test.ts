import {
  DEFAULT_MEAN_REVERSION_PARAMETERS,
  runMeanReversionBacktest,
  simpleMovingAverage,
  wilderAtr,
  wilderRsi,
  type MeanReversionCandle,
  type MeanReversionParameters,
} from './meanReversionStrategy';

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

describe('mean reversion indicators', () => {
  it('computes Wilder RSI matching a hand-calculated example', () => {
    // closes 10, 11, 10.5, 11.5 with period 2: seed avgGain=0.5 avgLoss=0.25 -> RSI=66.67;
    // next change +1 -> avgGain=0.75 avgLoss=0.125 -> RS=6 -> RSI=85.71.
    const rsi = wilderRsi([10, 11, 10.5, 11.5], 2);
    expect(rsi[0]).toBeNull();
    expect(rsi[1]).toBeNull();
    expect(rsi[2]).toBeCloseTo(66.6667, 3);
    expect(rsi[3]).toBeCloseTo(85.7143, 3);
  });

  it('computes SMA and ATR with correct warmup boundaries', () => {
    const sma = simpleMovingAverage([1, 2, 3, 4], 3);
    expect(sma).toEqual([null, null, 2, 3]);

    const atr = wilderAtr(series([100, 102, 104]), 2);
    expect(atr[1]).toBeNull();
    // TR(1)=max(2, |103-100|, |101-100|)=3, TR(2)=max(2, |105-102|, |103-102|)=3 -> seed 3.
    expect(atr[2]).toBeCloseTo(3, 6);
  });
});

const double7Params = (
  overrides: Partial<MeanReversionParameters> = {},
): MeanReversionParameters => ({
  ...DEFAULT_MEAN_REVERSION_PARAMETERS,
  kind: 'double7',
  smaFilterPeriod: 5,
  lookbackEntryLow: 3,
  lookbackExitHigh: 3,
  atrPeriod: 2,
  ...overrides,
});

describe('double7 walker', () => {
  // Strong uptrend so the 5-bar SMA lags below price, then a 3-bar closing low that stays
  // above the SMA (the entry), then a recovery that prints a 3-bar closing high (the exit).
  const closes = [100, 105, 110, 115, 120, 119, 118, 119, 121];

  it('enters on an N-bar closing low above the SMA filter and exits on an N-bar closing high', () => {
    const { trades, summary } = runMeanReversionBacktest(series(closes), double7Params());

    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      entryPrice: 118,
      exitPrice: 119,
      exitReason: 'signal',
      barsHeld: 1,
    });
    expect(trades[0]!.pctReturn).toBeCloseTo(1 / 118, 10);
    expect(summary).toMatchObject({ trades: 1, wins: 1, losses: 0, openAtEnd: 0 });
  });

  it('is zero-lookahead: appending future bars never changes already-closed trades', () => {
    const full = runMeanReversionBacktest(series([...closes, 90, 140, 80]), double7Params());
    const prefix = runMeanReversionBacktest(series(closes), double7Params());

    expect(full.trades[0]).toEqual(prefix.trades[0]);
  });

  it('honors the entry range without changing indicator warmup', () => {
    const candles = series(closes);
    const { trades } = runMeanReversionBacktest(candles, double7Params(), {
      rangeStart: candles.at(-1)!.time,
    });

    expect(trades).toHaveLength(0);
  });

  it('exits intrabar at the protective stop when configured, before the signal exit', () => {
    // Same entry at 118 (ATR-based stop), then a crash bar whose low pierces the stop.
    const crash = [...closes.slice(0, 7), 100];
    const { trades } = runMeanReversionBacktest(
      series(crash),
      double7Params({ protectiveStopAtrMultiple: 1 }),
    );

    expect(trades).toHaveLength(1);
    expect(trades[0]!.exitReason).toBe('protective_stop');
    expect(trades[0]!.exitPrice).toBeLessThan(118);
    expect(trades[0]!.pctReturn).toBeLessThan(0);
  });

  it('reports a still-open position at end of data instead of inventing an exit', () => {
    const { trades, summary } = runMeanReversionBacktest(
      series(closes.slice(0, 7)),
      double7Params(),
    );

    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      entryPrice: 118,
      exitReason: 'end_of_data',
      exitPrice: null,
      pctReturn: null,
    });
    expect(summary.openAtEnd).toBe(1);
  });
});

describe('rsi2 walker', () => {
  // Long flat warmup keeps the SMA far below, then a rally, a sharp 2-bar dip (RSI(2)
  // collapses while price stays above the SMA), then a surge (RSI(2) spikes -> exit).
  const closes = [...Array.from({ length: 30 }, () => 100), 130, 132, 118, 106, 131, 140];
  const params = (overrides: Partial<MeanReversionParameters> = {}): MeanReversionParameters => ({
    ...DEFAULT_MEAN_REVERSION_PARAMETERS,
    kind: 'rsi2',
    smaFilterPeriod: 20,
    rsiEntryThreshold: 20,
    rsiExitThreshold: 80,
    atrPeriod: 2,
    ...overrides,
  });

  it('enters below the RSI entry threshold above the SMA and exits above the exit threshold', () => {
    const candles = series(closes);
    const { trades } = runMeanReversionBacktest(candles, params());

    expect(trades).toHaveLength(1);
    const trade = trades[0]!;
    const entryIndex = candles.findIndex((candle) => candle.time === trade.entryTime);
    const exitIndex = candles.findIndex((candle) => candle.time === trade.exitTime);
    const rsi = wilderRsi(closes, 2);
    const sma = simpleMovingAverage(closes, 20);
    expect(rsi[entryIndex]!).toBeLessThan(20);
    expect(closes[entryIndex]!).toBeGreaterThan(sma[entryIndex]!);
    expect(rsi[exitIndex]!).toBeGreaterThan(80);
    expect(exitIndex).toBeGreaterThan(entryIndex);
    expect(trade.pctReturn).toBeCloseTo(
      (closes[exitIndex]! - closes[entryIndex]!) / closes[entryIndex]!,
      10,
    );
  });
});
