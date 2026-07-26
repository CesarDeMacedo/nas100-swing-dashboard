import type { OandaCandle } from '../../src/providers/oanda/types';

export type SignalDirection = 'long' | 'short';
export type SignalStatus = 'pending' | 'filled' | 'cancelled' | 'win' | 'loss' | 'unresolved';

export type SignalOutcome = {
  status: SignalStatus;
  filledAt: string | null;
  resolvedAt: string | null;
  outcomeRR: number | null;
};

/** Walk-forward fill/outcome state machine for one hypothetical signal, starting at the
 * candle AFTER the decision candle. This is the one place a backtest legitimately looks at
 * "future" data relative to the decision — it's evaluating what actually happened next, which
 * is the whole point of a backtest. It must never influence any OTHER signal's decision
 * inputs (those come only from `cutSeriesAt`-cut series, per replayWindow.ts).
 *
 * `entryPrice` is a breakout stop-entry level (see tradePlan.ts), not an immediate fill: the
 * signal is 'pending' until price actually reaches it, and is 'cancelled' if price reaches
 * `invalidationPrice` first (the setup no longer holds). Once 'filled', it resolves to 'win'
 * or 'loss' based on which of `targetPrice`/`stopPrice` is reached first, walking candles
 * strictly one at a time — a candle that fills a pending entry is never also used to resolve
 * that same trade; the earliest a fill can resolve is the NEXT candle after the fill.
 *
 * Same-candle tie-break rule (confirmed decision, not an assumption to revisit lightly):
 * "worse outcome always wins" — if a single candle's high/low range spans both the entry and
 * invalidation levels, treat it as cancelled (invalidation beats fill). If a single candle's
 * range spans both the stop and target, treat it as a loss (stop beats target). OHLC alone
 * can't tell us which was touched first intraday, and assuming the favorable order would
 * systematically and silently inflate the reported win rate — the single most important
 * number this harness produces credibility for. */
export function evaluateSignalOutcome(
  candlesAfterDecision: readonly OandaCandle[],
  direction: SignalDirection,
  entryPrice: number,
  invalidationPrice: number,
  stopPrice: number,
  targetPrice: number,
): SignalOutcome {
  let filledAt: string | null = null;
  let filledEntryPrice: number | null = null;

  for (const candle of candlesAfterDecision) {
    if (filledAt === null) {
      const invalidationHit = direction === 'long' ? candle.low <= invalidationPrice : candle.high >= invalidationPrice;
      const entryHit = direction === 'long' ? candle.high >= entryPrice : candle.low <= entryPrice;

      if (invalidationHit) {
        // Tie-break: invalidation beats fill when both occur in the same candle.
        return { status: 'cancelled', filledAt: null, resolvedAt: candle.time, outcomeRR: null };
      }
      if (entryHit) {
        filledAt = candle.time;
        filledEntryPrice = entryPrice;
        // Fill and resolution never happen in the same candle in this model — continue to
        // the next candle in the loop before checking stop/target.
      }
      continue;
    }

    const stopHit = direction === 'long' ? candle.low <= stopPrice : candle.high >= stopPrice;
    const targetHit = direction === 'long' ? candle.high >= targetPrice : candle.low <= targetPrice;

    if (stopHit) {
      // Tie-break: stop beats target when both occur in the same candle.
      return { status: 'loss', filledAt, resolvedAt: candle.time, outcomeRR: -1 };
    }
    if (targetHit) {
      const risk = direction === 'long' ? filledEntryPrice! - stopPrice : stopPrice - filledEntryPrice!;
      const reward = direction === 'long' ? targetPrice - filledEntryPrice! : filledEntryPrice! - targetPrice;
      return { status: 'win', filledAt, resolvedAt: candle.time, outcomeRR: reward / risk };
    }
  }

  // Data ran out before resolving — whether never filled or filled-but-not-yet-resolved,
  // both are reported as 'unresolved' and excluded from win-rate/expectancy math.
  return { status: 'unresolved', filledAt, resolvedAt: null, outcomeRR: null };
}

const TORONTO_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
});

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Same timezone convention already used throughout the pipeline (CandleDatasetSchema,
 * torontoSchedule.ts) — America/Toronto, via Intl.DateTimeFormat, DST-safe by construction. */
export function localHourAndWeekday(isoTime: string): { hour: number; weekday: number } {
  const parts = Object.fromEntries(TORONTO_TIME_FORMATTER.formatToParts(new Date(isoTime)).map(({ type, value }) => [type, value]));
  return { hour: Number(parts.hour), weekday: WEEKDAY_INDEX[parts.weekday!]! };
}
