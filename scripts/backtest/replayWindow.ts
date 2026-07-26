/** Cuts a candle series at a simulated "now" instant — the single mechanism the replay engine
 * relies on to guarantee zero lookahead. Every series (NAS100 H4, NAS100 Daily, and each
 * cross-market H4 series) must be cut independently by this same `simulatedNowIso`, compared
 * by timestamp rather than array index, since the series have different calendars (Daily has
 * roughly 1/6th the density of H4; cross-market instruments can have gaps that don't line up
 * with NAS100's). ISO-8601 timestamps sort lexically, so a plain string comparison is
 * sufficient and avoids parsing every candle on every cut. */
export function cutSeriesAt<T extends { time: string }>(candles: readonly T[], simulatedNowIso: string): T[] {
  return candles.filter((candle) => candle.time <= simulatedNowIso);
}
