/** Live evaluator for the mean-reversion strategy kinds (rsi2/double7). Read-only: it inspects
 * completed candles and an active MR-kind strategy config and reports where that strategy
 * currently stands (ENTER/HOLD/EXIT/FLAT) plus a suggested stop and position size. Nothing here
 * places an order or feeds the pipeline's entry-authorization path — this is a parallel,
 * analysis-only surface (see docs/MR_LIVE_INTEGRATION_PLAN.md).
 */

import {
  runMeanReversionBacktest,
  simpleMovingAverage,
  wilderAtr,
  type MeanReversionCandle,
  type MeanReversionParameters,
} from '../domain/meanReversionStrategy';
import { resolveStrategyParameters, type StrategyKind } from '../domain/strategyParameters';
import type { MeanReversionSignal } from '../persistence/analysisRepository';
import type { OandaCandle } from '../providers/oanda/types';
import type { StrategyConfig } from '../schemas/strategyConfig';

export type { MeanReversionSignal } from '../persistence/analysisRepository';

/** Prop-desk decision from the strategy-definition session (docs/MR_LIVE_INTEGRATION_PLAN.md):
 * 0.73% per trade against a 3% internal drawdown target (4% hard desk limit). */
export const DEFAULT_MR_RISK_PER_TRADE_PCT = 0.73;

export type MeanReversionEvaluation = {
  strategyConfigId: string;
  strategyId: string;
  version: number;
  instrument: string;
  timeframe: 'D' | 'H4';
  evaluatedAt: string;
  referenceCandleTime: string;
  referenceClose: number;
  signal: MeanReversionSignal;
  /** entryPrice - protectiveStopAtrMultiple * atrAtEntry, only while a position is tracked
   * (ENTER/HOLD) and the strategy is configured with a protective stop. */
  stopPrice: number | null;
  /** ATR(atrPeriod) as of the reference (most recent completed) bar. */
  atr: number | null;
  /** SMA(smaFilterPeriod) as of the reference bar. */
  smaFilterValue: number | null;
  aboveSmaFilter: boolean | null;
  riskPerTradePct: number;
  accountSize: number | null;
  /** Only computed on ENTER/HOLD with a configured stop and a known account size. */
  suggestedRiskAmount: number | null;
  suggestedPositionSizeUnits: number | null;
};

export type MeanReversionEvaluationContext = {
  strategyConfigId: string;
  strategyId: string;
  version: number;
  instrument: string;
  riskPerTradePct?: number;
  /** null/undefined means "unknown" — the evaluation still reports the stop and signal, just no
   * position size, per the plan ("if unset, report size in % only"). */
  accountSize?: number | null;
  now?: () => Date;
};

/** Given completed candles (ascending time, at least one bar) and the MR engine params that
 * produced them, derives the current signal by running the same zero-lookahead backtest engine
 * over the series and inspecting its last trade — no separate "live" code path to drift from the
 * backtested one. */
export function evaluateMeanReversionSignal(
  candles: readonly MeanReversionCandle[],
  params: MeanReversionParameters,
  context: MeanReversionEvaluationContext,
): MeanReversionEvaluation {
  if (candles.length === 0) {
    throw new Error('evaluateMeanReversionSignal requires at least one completed candle.');
  }

  const lastCandle = candles[candles.length - 1]!;
  const { trades } = runMeanReversionBacktest(candles, params);
  const closes = candles.map((candle) => candle.close);
  const smaSeries = simpleMovingAverage(closes, params.smaFilterPeriod);
  const atrSeries = wilderAtr(candles, params.atrPeriod);
  const smaFilterValue = smaSeries[smaSeries.length - 1] ?? null;
  const atr = atrSeries[atrSeries.length - 1] ?? null;

  const lastTrade = trades.at(-1) ?? null;
  const isOpen = lastTrade !== null && lastTrade.exitTime === null;

  let signal: MeanReversionSignal;
  let stopPrice: number | null = null;
  let stopDistance: number | null = null;

  if (isOpen) {
    signal = lastTrade!.entryTime === lastCandle.time ? 'ENTER' : 'HOLD';
    if (
      params.protectiveStopAtrMultiple !== null &&
      lastTrade!.atrAtEntry !== null &&
      lastTrade!.atrAtEntry > 0
    ) {
      stopDistance = params.protectiveStopAtrMultiple * lastTrade!.atrAtEntry;
      stopPrice = lastTrade!.entryPrice - stopDistance;
    }
  } else {
    signal = lastTrade !== null && lastTrade.exitTime === lastCandle.time ? 'EXIT' : 'FLAT';
  }

  const riskPerTradePct = context.riskPerTradePct ?? DEFAULT_MR_RISK_PER_TRADE_PCT;
  const accountSize = context.accountSize ?? null;
  const suggestedRiskAmount = accountSize !== null ? accountSize * (riskPerTradePct / 100) : null;
  const suggestedPositionSizeUnits =
    suggestedRiskAmount !== null && stopDistance !== null && stopDistance > 0
      ? suggestedRiskAmount / stopDistance
      : null;

  return {
    strategyConfigId: context.strategyConfigId,
    strategyId: context.strategyId,
    version: context.version,
    instrument: context.instrument,
    timeframe: params.timeframe,
    evaluatedAt: (context.now ?? (() => new Date()))().toISOString(),
    referenceCandleTime: lastCandle.time,
    referenceClose: lastCandle.close,
    signal,
    stopPrice,
    atr,
    smaFilterValue,
    aboveSmaFilter: smaFilterValue === null ? null : lastCandle.close > smaFilterValue,
    riskPerTradePct,
    accountSize,
    suggestedRiskAmount,
    suggestedPositionSizeUnits,
  };
}

const isMeanReversionKind = (kind: StrategyKind): kind is 'rsi2' | 'double7' =>
  kind === 'rsi2' || kind === 'double7';

/** Completed-only candle mapping shared with the backtest CLI's convention (scripts/backtest/
 * runMeanReversionBacktest.ts) — never evaluate on an open bar. */
export const completedMeanReversionCandles = (
  candles: readonly OandaCandle[],
): MeanReversionCandle[] =>
  candles
    .filter((candle) => candle.isClosed)
    .map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));

/** Reads the optional live account-size env var (plan: `NAS100_MR_ACCOUNT_SIZE`). Absent/invalid
 * means "unknown" — evaluations still report the stop and signal, just no position size. */
export const resolveMrAccountSize = (env: NodeJS.ProcessEnv = process.env): number | null => {
  const raw = env.NAS100_MR_ACCOUNT_SIZE;
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Reads the optional risk-per-trade env var (`NAS100_MR_RISK_PER_TRADE_PCT`, in percent, e.g.
 * "1.9"). Absent/invalid falls back to DEFAULT_MR_RISK_PER_TRADE_PCT. Account-level like the
 * account size — sizing is a property of the desk's drawdown rules, not of a strategy config.
 * Capped at 5 as a sanity bound: no drawdown rule this app has been sized for supports more. */
export const resolveMrRiskPerTradePct = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env.NAS100_MR_RISK_PER_TRADE_PCT;
  if (raw === undefined) return DEFAULT_MR_RISK_PER_TRADE_PCT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 5
    ? parsed
    : DEFAULT_MR_RISK_PER_TRADE_PCT;
};

/** Top-level entry point for the scheduler hook: resolves an active strategy config's engine
 * parameters, picks its configured timeframe's candle series, and evaluates it. Returns null for
 * non-MR strategy kinds (nothing to evaluate) or when the required timeframe's candles aren't
 * available yet — never throws for those expected, non-error cases. */
export function evaluateStrategyConfigLive(
  strategy: StrategyConfig,
  instrument: string,
  candlesByTimeframe: { D?: readonly OandaCandle[]; H4?: readonly OandaCandle[] },
  options: { riskPerTradePct?: number; accountSize?: number | null; now?: () => Date } = {},
): MeanReversionEvaluation | null {
  const resolved = resolveStrategyParameters(strategy.parameters);
  if (!isMeanReversionKind(resolved.strategyKind)) return null;

  const params: MeanReversionParameters = {
    kind: resolved.strategyKind,
    ...resolved.meanReversion,
  };
  const source = candlesByTimeframe[params.timeframe];
  if (!source) return null;
  const candles = completedMeanReversionCandles(source);
  if (candles.length === 0) return null;

  return evaluateMeanReversionSignal(candles, params, {
    strategyConfigId: strategy.id,
    strategyId: strategy.strategyId,
    version: strategy.version,
    instrument,
    riskPerTradePct: options.riskPerTradePct,
    accountSize: options.accountSize,
    now: options.now,
  });
}
