/** Connors-style short-term mean-reversion strategies (long-only, as documented for equity
 * indices): RSI-2 (buy RSI(2) < threshold above the long SMA, exit RSI(2) > threshold) and
 * Double Seven (buy an N-bar closing low above the long SMA, exit on an N-bar closing high).
 *
 * These are condition-exit strategies: there is no planned target price, so the pipeline's
 * minimum planned reward-to-risk floor does not apply to them BY DESIGN — that floor is a
 * property of the target-vs-stop pipeline mode, not of this family. They are implemented for
 * the isolated backtest harness; nothing here feeds the production entry-authorization path.
 *
 * Entry semantics follow the literature: the signal is computed on a COMPLETED bar and the
 * entry is booked at that bar's close (Connors' "buy on close"). That is a mild idealization —
 * live execution would fill seconds after the close — and it is the same convention the
 * published backtest numbers use, so results stay comparable.
 */

export type MeanReversionKind = 'rsi2' | 'double7';

export type MeanReversionCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MeanReversionParameters = {
  kind: MeanReversionKind;
  /** Which cached series the harness should feed this strategy. The published results are all
   * daily-bar results; 'H4' exists to test the timeframe-transfer hypothesis explicitly. */
  timeframe: 'D' | 'H4';
  /** Long-term trend filter: only enter when close > SMA(this period). 200 in the literature
   * (daily bars). The filter is the only structural protection the original systems carry. */
  smaFilterPeriod: number;
  rsiPeriod: number;
  rsiEntryThreshold: number;
  rsiExitThreshold: number;
  /** double7: enter when the close is the lowest close of this many bars (inclusive). */
  lookbackEntryLow: number;
  /** double7: exit when the close is the highest close of this many bars (inclusive). */
  lookbackExitHigh: number;
  /** Optional protective stop at entry - multiple * ATR(atrPeriod). The originals trade with
   * NO stop (Connors documented stops degrading these systems); null preserves that. Non-null
   * exists so the harness can quantify what a safety stop costs on this instrument. */
  protectiveStopAtrMultiple: number | null;
  atrPeriod: number;
  /** Optional time-based exit (bars held after entry). null = none, as in the literature. */
  maxBarsHeld: number | null;
};

export const DEFAULT_MEAN_REVERSION_PARAMETERS: Omit<MeanReversionParameters, 'kind'> = {
  timeframe: 'D',
  smaFilterPeriod: 200,
  rsiPeriod: 2,
  rsiEntryThreshold: 5,
  rsiExitThreshold: 65,
  lookbackEntryLow: 7,
  lookbackExitHigh: 7,
  protectiveStopAtrMultiple: null,
  atrPeriod: 14,
  maxBarsHeld: null,
};

export type MeanReversionExitReason = 'signal' | 'protective_stop' | 'timeout' | 'end_of_data';

export type MeanReversionTrade = {
  entryTime: string;
  entryPrice: number;
  exitTime: string | null;
  exitPrice: number | null;
  exitReason: MeanReversionExitReason | null;
  barsHeld: number | null;
  atrAtEntry: number | null;
  /** (exit - entry) / entry; null while the trade is still open at end of data. */
  pctReturn: number | null;
  /** (exit - entry) / atrAtEntry — a comparable "R-like" unit for a family with no stop. */
  atrMultipleReturn: number | null;
};

export type MeanReversionSummary = {
  totalBars: number;
  evaluatedBars: number;
  trades: number;
  wins: number;
  losses: number;
  openAtEnd: number;
  winRate: number | null;
  avgPctReturn: number | null;
  /** Compounded return over closed trades, full notional per trade (the literature's convention). */
  compoundedPctReturn: number | null;
  profitFactor: number | null;
  /** Worst peak-to-trough drawdown of the compounded, trade-close equity curve. */
  maxDrawdownPct: number | null;
  avgBarsHeld: number | null;
  /** Fraction of evaluated bars spent in a position. */
  exposure: number | null;
  avgAtrMultipleReturn: number | null;
};

/** Wilder-smoothed RSI. Returns an array aligned to `closes`; indices before there is enough
 * history are null. */
export function wilderRsi(closes: readonly number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function simpleMovingAverage(closes: readonly number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i]!;
    if (i >= period) sum -= closes[i - period]!;
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

/** Wilder-smoothed ATR aligned to `candles`; null until enough history exists. */
export function wilderAtr(
  candles: readonly MeanReversionCandle[],
  period: number,
): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return result;
  const trueRange = (i: number) => {
    const candle = candles[i]!;
    if (i === 0) return candle.high - candle.low;
    const previousClose = candles[i - 1]!.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  };
  let atr = 0;
  for (let i = 1; i <= period; i += 1) atr += trueRange(i);
  atr /= period;
  result[period] = atr;
  for (let i = period + 1; i < candles.length; i += 1) {
    atr = (atr * (period - 1) + trueRange(i)) / period;
    result[i] = atr;
  }
  return result;
}

/** For 'double7': the closing price the NEXT bar would need to reach or exceed to trigger the
 * strategy's signal exit (an N-bar closing high) — the same window `isHighestClose` would
 * compare a new bar at `closes.length` against. Purely advisory/display: this family has no
 * fixed target price (exit is a condition re-evaluated on every completed bar, not a level),
 * so this is the closest thing to "where do I watch for the exit" that can be shown ahead of
 * time. Returns null when there isn't enough closed history for the window yet, or when
 * lookbackExitHigh <= 1 (a 1-bar lookback's "window" would be empty by construction). */
export function computeDouble7ExitWatchPrice(
  closes: readonly number[],
  lookbackExitHigh: number,
): number | null {
  if (lookbackExitHigh <= 1 || closes.length < lookbackExitHigh - 1) return null;
  const window = closes.slice(closes.length - (lookbackExitHigh - 1));
  return Math.max(...window);
}

const isLowestClose = (closes: readonly number[], index: number, lookback: number) => {
  if (index < lookback - 1) return false;
  const current = closes[index]!;
  for (let i = index - lookback + 1; i < index; i += 1) if (closes[i]! < current) return false;
  return true;
};

const isHighestClose = (closes: readonly number[], index: number, lookback: number) => {
  if (index < lookback - 1) return false;
  const current = closes[index]!;
  for (let i = index - lookback + 1; i < index; i += 1) if (closes[i]! > current) return false;
  return true;
};

export type MeanReversionBacktestOptions = {
  /** Only trades whose ENTRY bar time is inside [rangeStart, rangeEnd] are taken. Indicators
   * always warm up on the full series that precedes the range — restricting the series itself
   * would silently change SMA/RSI values at the range boundary. */
  rangeStart?: string;
  rangeEnd?: string;
};

/** Single-pass, zero-lookahead walker. Every decision at bar i uses only bars <= i; an entry
 * booked at bar i's close is first eligible to exit at bar i+1. */
export function runMeanReversionBacktest(
  candles: readonly MeanReversionCandle[],
  params: MeanReversionParameters,
  options: MeanReversionBacktestOptions = {},
): { trades: MeanReversionTrade[]; summary: MeanReversionSummary } {
  const closes = candles.map((candle) => candle.close);
  const sma = simpleMovingAverage(closes, params.smaFilterPeriod);
  const rsi = params.kind === 'rsi2' ? wilderRsi(closes, params.rsiPeriod) : null;
  const atr = wilderAtr(candles, params.atrPeriod);
  const rangeStart = options.rangeStart ?? '';
  const rangeEnd = options.rangeEnd ?? '￿';

  const trades: MeanReversionTrade[] = [];
  let open: {
    entryIndex: number;
    entryPrice: number;
    atrAtEntry: number | null;
    stopPrice: number | null;
  } | null = null;
  let evaluatedBars = 0;
  let barsInPosition = 0;

  const closeTrade = (
    exitIndex: number,
    exitPrice: number,
    exitReason: MeanReversionExitReason,
  ) => {
    const position = open!;
    const pctReturn = (exitPrice - position.entryPrice) / position.entryPrice;
    trades.push({
      entryTime: candles[position.entryIndex]!.time,
      entryPrice: position.entryPrice,
      exitTime: candles[exitIndex]!.time,
      exitPrice,
      exitReason,
      barsHeld: exitIndex - position.entryIndex,
      atrAtEntry: position.atrAtEntry,
      pctReturn,
      atrMultipleReturn:
        position.atrAtEntry === null || position.atrAtEntry <= 0
          ? null
          : (exitPrice - position.entryPrice) / position.atrAtEntry,
    });
    open = null;
  };

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i]!;
    if (candle.time > rangeEnd && open === null) break;
    const inRange = candle.time >= rangeStart && candle.time <= rangeEnd;
    if (inRange) evaluatedBars += 1;

    if (open !== null) {
      if (inRange) barsInPosition += 1;
      // Protective stop is checked intrabar and FIRST — a bar that pierces the stop exits at
      // the stop (or at the open when the bar already opened through it), even if the same
      // bar's close would have satisfied the signal exit. Conservative by construction.
      if (open.stopPrice !== null && candle.low <= open.stopPrice) {
        closeTrade(i, Math.min(candle.open, open.stopPrice), 'protective_stop');
        continue;
      }
      const signalExit =
        params.kind === 'rsi2'
          ? rsi![i] !== null && rsi![i]! > params.rsiExitThreshold
          : isHighestClose(closes, i, params.lookbackExitHigh);
      if (signalExit) {
        closeTrade(i, candle.close, 'signal');
        continue;
      }
      if (params.maxBarsHeld !== null && i - open.entryIndex >= params.maxBarsHeld) {
        closeTrade(i, candle.close, 'timeout');
        continue;
      }
      continue;
    }

    if (candle.time < rangeStart || candle.time > rangeEnd) continue;
    const smaValue = sma[i];
    if (smaValue === null || candle.close <= smaValue) continue;
    const entrySignal =
      params.kind === 'rsi2'
        ? rsi![i] !== null && rsi![i]! < params.rsiEntryThreshold
        : isLowestClose(closes, i, params.lookbackEntryLow);
    if (!entrySignal) continue;

    const atrAtEntry = atr[i];
    open = {
      entryIndex: i,
      entryPrice: candle.close,
      atrAtEntry,
      stopPrice:
        params.protectiveStopAtrMultiple !== null && atrAtEntry !== null && atrAtEntry > 0
          ? candle.close - params.protectiveStopAtrMultiple * atrAtEntry
          : null,
    };
  }

  if (open !== null) {
    const position: { entryIndex: number; entryPrice: number; atrAtEntry: number | null } = open;
    trades.push({
      entryTime: candles[position.entryIndex]!.time,
      entryPrice: position.entryPrice,
      exitTime: null,
      exitPrice: null,
      exitReason: 'end_of_data',
      barsHeld: null,
      atrAtEntry: position.atrAtEntry,
      pctReturn: null,
      atrMultipleReturn: null,
    });
  }

  return { trades, summary: summarize(trades, candles.length, evaluatedBars, barsInPosition) };
}

function summarize(
  trades: MeanReversionTrade[],
  totalBars: number,
  evaluatedBars: number,
  barsInPosition: number,
): MeanReversionSummary {
  const closed = trades.filter((trade) => trade.pctReturn !== null);
  const wins = closed.filter((trade) => trade.pctReturn! > 0);
  const losses = closed.filter((trade) => trade.pctReturn! <= 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.pctReturn!, 0);
  const grossLoss = -losses.reduce((sum, trade) => sum + trade.pctReturn!, 0);

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const trade of closed) {
    equity *= 1 + trade.pctReturn!;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }

  const withAtr = closed.filter((trade) => trade.atrMultipleReturn !== null);
  return {
    totalBars,
    evaluatedBars,
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    openAtEnd: trades.length - closed.length,
    winRate: closed.length === 0 ? null : wins.length / closed.length,
    avgPctReturn:
      closed.length === 0
        ? null
        : closed.reduce((sum, trade) => sum + trade.pctReturn!, 0) / closed.length,
    compoundedPctReturn: closed.length === 0 ? null : equity - 1,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : null) : grossWin / grossLoss,
    maxDrawdownPct: closed.length === 0 ? null : maxDrawdown,
    avgBarsHeld:
      closed.length === 0
        ? null
        : closed.reduce((sum, trade) => sum + trade.barsHeld!, 0) / closed.length,
    exposure: evaluatedBars === 0 ? null : barsInPosition / evaluatedBars,
    avgAtrMultipleReturn:
      withAtr.length === 0
        ? null
        : withAtr.reduce((sum, trade) => sum + trade.atrMultipleReturn!, 0) / withAtr.length,
  };
}
