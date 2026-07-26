import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOandaConfiguration } from '../../src/providers/oanda/config';
import { OandaProvider } from '../../src/providers/oanda/oandaProvider';
import type { OandaCandle, OandaCandleGranularity } from '../../src/providers/oanda/types';
import { CROSS_MARKET_OANDA_SYMBOLS } from '../../src/service/oandaRun';
import { loadProjectEnvironmentForServiceCli } from '../../src/service/server';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = join(moduleDir, '.cache', 'oanda');

export type CacheFile = { instrument: string; timeframe: OandaCandleGranularity; candles: OandaCandle[]; fetchedThroughTime: string };

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

/** Chunked backfill for one (instrument, timeframe) pair across [fromIso, toIso]. OANDA's
 * `from`/`to` query still caps the candles returned per call (same ~5000 ceiling as `count`,
 * just enforced server-side) — so a multi-year range requires repeated calls, advancing the
 * cursor to the last candle actually returned each time. A no-progress guard prevents an
 * infinite loop if the API ever echoes back the same boundary candle without advancing. */
export async function backfillInstrument(
  provider: OandaProvider,
  instrument: string,
  timeframe: OandaCandleGranularity,
  fromIso: string,
  toIso: string,
  delayMs = 250,
): Promise<OandaCandle[]> {
  const existing = loadCache(instrument, timeframe);
  let cursor = existing && existing.fetchedThroughTime > fromIso ? existing.fetchedThroughTime : fromIso;
  const accumulated: OandaCandle[] = existing ? [...existing.candles] : [];

  while (cursor < toIso) {
    const result = await provider.getCandlesInRange(instrument, timeframe, cursor, toIso);
    if (result.candles.length === 0) break;
    accumulated.push(...result.candles);
    const lastTime = result.candles.at(-1)!.time;
    if (lastTime <= cursor) break; // no-progress guard
    cursor = lastTime;
    if (cursor < toIso) await sleep(delayMs);
  }

  const merged = dedupeByTime(accumulated);
  saveCache({ instrument, timeframe, candles: merged, fetchedThroughTime: merged.at(-1)?.time ?? fromIso });
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
