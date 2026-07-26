import type { CrossMarketH4Results } from '../../src/service/oandaRun';
import type { OandaDailyCandleResult, OandaH4CandleResult } from '../../src/providers/oanda/types';
import { cutSeriesAt } from './replayWindow';

export type FullHistoricalDataset = {
  h4: OandaH4CandleResult;
  daily: OandaDailyCandleResult;
  crossMarketH4: CrossMarketH4Results;
};

export type ReplayFrame = {
  simulatedNowIso: string;
  h4Source: OandaH4CandleResult;
  dailySource: OandaDailyCandleResult;
  crossMarketH4: CrossMarketH4Results;
};

/** EMA200 (part of `technicalContext.ts`'s indicator snapshot) needs at least 200 closed H4
 * candles before it becomes available — skipping fewer would mean every early frame reports
 * "EMA200 is unavailable" and the technical context would only ever be 'partial', not 'ready'.
 * 210 adds a small buffer past that minimum for stability, matching the plan's stated default. */
export const DEFAULT_WARMUP_CANDLES = 210;

const cutCrossMarket = (source: CrossMarketH4Results, simulatedNowIso: string): CrossMarketH4Results =>
  Object.fromEntries(
    Object.entries(source).map(([key, result]) => [key, result === undefined ? undefined : { ...result, candles: cutSeriesAt(result.candles, simulatedNowIso) }]),
  ) as CrossMarketH4Results;

/** Generates one frame per closed NAS100 H4 candle, each cut at that candle's own close time.
 * Every other series (Daily, cross-market H4) is cut independently at the SAME instant, by
 * timestamp — never by index — since the series have different calendars. This is the only
 * place "now" is simulated; callers must feed these frames straight into the unmodified
 * production functions (`buildOandaMultiTimeframeInputs` + `buildDashboardState`) and must
 * never reach into `full` directly for anything beyond the current frame's cutoff. */
export function* generateReplayFrames(full: FullHistoricalDataset, warmupCandles = DEFAULT_WARMUP_CANDLES): Generator<ReplayFrame> {
  const closedH4 = full.h4.candles.filter((candle) => candle.isClosed);
  for (let index = warmupCandles; index < closedH4.length; index += 1) {
    const simulatedNowIso = closedH4[index]!.time;
    yield {
      simulatedNowIso,
      h4Source: { ...full.h4, candles: cutSeriesAt(full.h4.candles, simulatedNowIso) },
      dailySource: { ...full.daily, candles: cutSeriesAt(full.daily.candles, simulatedNowIso) },
      crossMarketH4: cutCrossMarket(full.crossMarketH4, simulatedNowIso),
    };
  }
}
