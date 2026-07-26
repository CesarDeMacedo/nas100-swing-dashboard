import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOandaConfiguration } from '../../src/providers/oanda/config';
import { OandaClientError } from '../../src/providers/oanda/oandaClient';
import { OandaProvider } from '../../src/providers/oanda/oandaProvider';
import type { OandaCandle, OandaCandleGranularity } from '../../src/providers/oanda/types';
import { CROSS_MARKET_OANDA_SYMBOLS } from '../../src/service/oandaRun';
import { loadProjectEnvironmentForServiceCli } from '../../src/service/server';

const ONE_HOUR_MS = 60 * 60 * 1000;

/** The minimal shape `fetchAdaptiveWindow`/`backfillInstrument` need from a provider — lets
 * tests pass a lightweight stub instead of constructing a real `OandaProvider`. */
export type OandaCandleRangeProvider = { getCandlesInRange: OandaProvider['getCandlesInRange'] };

const moduleDir = dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = join(moduleDir, '.cache', 'oanda');

export type CacheFile = {
  instrument: string;
  timeframe: OandaCandleGranularity;
  candles: OandaCandle[];
  /** Earliest point this cache is known to cover with no gaps — the `fromIso` a prior run was
   * given, not necessarily the first candle's own time (the real series may start later, e.g.
   * before an instrument existed). Lets a later run detect "you're asking further back than I
   * have" instead of assuming any cache covers any requested `fromIso`. */
  fetchedFromTime: string;
  fetchedThroughTime: string;
};

const cachePath = (instrument: string, timeframe: OandaCandleGranularity) => join(CACHE_ROOT, instrument, `${timeframe}.json`);

/** Read-only access to a previously backfilled series — the CLI orchestrator
 * (runBacktest.ts) uses this to load candles without re-fetching from OANDA. */
export const loadCache = (instrument: string, timeframe: OandaCandleGranularity): CacheFile | null => {
  const path = cachePath(instrument, timeframe);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as CacheFile;
};

const saveCache = (cache: CacheFile) => {
  const path = cachePath(cache.instrument, cache.timeframe);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2));
};

const dedupeByTime = (candles: OandaCandle[]): OandaCandle[] => {
  const seen = new Map<string, OandaCandle>();
  for (const candle of candles) seen.set(candle.time, candle);
  return [...seen.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetches one window starting at `windowStartIso`, adapting to OANDA's real response instead
 * of guessing a safe range width up front. Starts optimistic — the entire remaining range up
 * to `ceilingIso` — and on a `400` (range implies too many candles) halves the window and
 * retries from the same start, until a request succeeds or the window shrinks to `minSpanMs`
 * (at which point any further error is real and is thrown, not retried forever). Every call
 * starts optimistic again rather than remembering the last size that worked, since "the same
 * width works next time too" is itself an unverified assumption (calendar gaps, holidays, and
 * DST all vary the true candle density per window).
 *
 * Returns `resolvedEndIso` — the end of the window that actually succeeded — separately from
 * the candles themselves: a successful-but-empty result (a valid sub-window with no data, e.g.
 * before an instrument existed) must still let the caller advance past exactly that window,
 * not silently skip everything up to `ceilingIso`. */
export async function fetchAdaptiveWindow(
  provider: OandaCandleRangeProvider,
  instrument: string,
  timeframe: OandaCandleGranularity,
  windowStartIso: string,
  ceilingIso: string,
  minSpanMs = ONE_HOUR_MS,
): Promise<{ candles: OandaCandle[]; resolvedEndIso: string }> {
  let spanMs = Date.parse(ceilingIso) - Date.parse(windowStartIso);
  for (;;) {
    const candidateEndIso = new Date(Math.min(Date.parse(windowStartIso) + spanMs, Date.parse(ceilingIso))).toISOString();
    try {
      const result = await provider.getCandlesInRange(instrument, timeframe, windowStartIso, candidateEndIso);
      return { candles: result.candles, resolvedEndIso: candidateEndIso };
    } catch (error) {
      const rangeTooLarge = error instanceof OandaClientError && error.statusCode === 400;
      if (!rangeTooLarge || spanMs <= minSpanMs) throw error;
      spanMs = Math.max(minSpanMs, Math.floor(spanMs / 2));
    }
  }
}

/** Chunked backfill for one (instrument, timeframe) pair across [fromIso, toIso], advancing
 * the cursor to real data (or the resolved end of an empty-but-valid window — see
 * `fetchAdaptiveWindow`) each iteration. A no-progress guard prevents an infinite loop if the
 * API ever echoes back the same boundary without advancing. */
export async function backfillInstrument(
  provider: OandaCandleRangeProvider,
  instrument: string,
  timeframe: OandaCandleGranularity,
  fromIso: string,
  toIso: string,
  delayMs = 250,
): Promise<OandaCandle[]> {
  const existing = loadCache(instrument, timeframe);
  // Only skip ahead to the cached frontier if that cache actually covers back to (or before)
  // the requested start — otherwise a request for an earlier range than was ever fetched would
  // silently jump straight to `fetchedThroughTime` and skip everything in between.
  const cacheCoversRequestedStart = existing && existing.fetchedFromTime <= fromIso;
  let cursor = cacheCoversRequestedStart && existing.fetchedThroughTime > fromIso ? existing.fetchedThroughTime : fromIso;
  const accumulated: OandaCandle[] = existing ? [...existing.candles] : [];

  while (cursor < toIso) {
    const { candles, resolvedEndIso } = await fetchAdaptiveWindow(provider, instrument, timeframe, cursor, toIso);

    if (candles.length === 0) {
      if (resolvedEndIso <= cursor) break; // no-progress guard
      cursor = resolvedEndIso;
      if (cursor < toIso) await sleep(delayMs);
      continue;
    }

    accumulated.push(...candles);
    const lastTime = candles.at(-1)!.time;
    if (lastTime <= cursor) break; // no-progress guard
    cursor = lastTime;
    if (cursor < toIso) await sleep(delayMs);
  }

  const merged = dedupeByTime(accumulated);
  const fetchedFromTime = existing && existing.fetchedFromTime < fromIso ? existing.fetchedFromTime : fromIso;
  saveCache({ instrument, timeframe, candles: merged, fetchedFromTime, fetchedThroughTime: merged.at(-1)?.time ?? fromIso });
  return merged;
}

export async function backfillAll(provider: OandaProvider, nas100Instrument: string, fromIso: string, toIso: string, delayMs = 250) {
  const [h4, daily, ...crossMarket] = await Promise.all([
    backfillInstrument(provider, nas100Instrument, 'H4', fromIso, toIso, delayMs),
    backfillInstrument(provider, nas100Instrument, 'D', fromIso, toIso, delayMs),
    ...Object.values(CROSS_MARKET_OANDA_SYMBOLS).map((symbol) => backfillInstrument(provider, symbol, 'H4', fromIso, toIso, delayMs)),
  ]);
  return { h4, daily, crossMarket };
}

const parseArgs = (argv: string[]) => {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token?.startsWith('--')) {
      args[token.slice(2)] = argv[i + 1] ?? '';
      i += 1;
    }
  }
  return args;
};

async function main() {
  loadProjectEnvironmentForServiceCli();
  const args = parseArgs(process.argv.slice(2));
  const configuration = parseOandaConfiguration(process.env);
  if (configuration.state !== 'configured') {
    console.error('OANDA is not configured (set OANDA_ACCOUNT_ID / OANDA_API_TOKEN / OANDA_NAS100_INSTRUMENT).');
    process.exit(1);
  }
  const provider = new OandaProvider(configuration);
  const fromIso = args.from ? new Date(args.from).toISOString() : new Date('2018-01-01').toISOString();
  const toIso = args.to ? new Date(args.to).toISOString() : new Date().toISOString();
  const delayMs = args['delay-ms'] ? Number(args['delay-ms']) : 250;

  if (args.all) {
    const nas100 = configuration.nas100Instrument ?? args.instrument;
    if (!nas100) throw new Error('No NAS100 instrument configured or passed via --instrument.');
    const result = await backfillAll(provider, nas100, fromIso, toIso, delayMs);
    console.log(`Backfilled NAS100 H4=${result.h4.length} D=${result.daily.length}; cross-market H4 totals: ${result.crossMarket.map((c) => c.length).join(', ')}`);
    return;
  }

  const instrument = args.instrument ?? configuration.nas100Instrument;
  if (!instrument) throw new Error('--instrument is required (or configure OANDA_NAS100_INSTRUMENT).');
  const timeframe = (args.timeframe as OandaCandleGranularity | undefined) ?? 'H4';
  const candles = await backfillInstrument(provider, instrument, timeframe, fromIso, toIso, delayMs);
  console.log(`Backfilled ${instrument} ${timeframe}: ${candles.length} candles, ${fromIso} -> ${toIso}`);
}

if (process.argv[1]?.endsWith('oandaHistoricalBackfill.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
