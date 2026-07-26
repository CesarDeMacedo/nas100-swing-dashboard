// @vitest-environment node

import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OandaClientError } from '../../../src/providers/oanda/oandaClient';
import type { OandaCandle } from '../../../src/providers/oanda/types';
import { backfillInstrument, fetchAdaptiveWindow, type OandaCandleRangeProvider } from '../oandaHistoricalBackfill';

const H4_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// `backfillInstrument` always persists to the module's real on-disk cache (by design — that's
// what makes the CLI resumable across runs). Tests that exercise it must therefore use unique,
// test-only instrument names and clean up exactly what they wrote, so runs stay isolated from
// each other and repeated `vitest run` invocations don't pick up stale cache from a prior run.
const CACHE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'oanda');
const usedInstruments = new Set<string>();
const testInstrument = (name: string) => {
  usedInstruments.add(name);
  return name;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const instrument of usedInstruments) {
    const dir = join(CACHE_ROOT, instrument);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  usedInstruments.clear();
});

const candle = (time: string): OandaCandle => ({
  time, open: 100, high: 101, low: 99, close: 100.5, isClosed: true, volume: 10, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20',
});

/** A stub provider that only knows how to answer from a fixed candle series and throws OANDA's
 * real "range too large" error whenever the requested window's implied count exceeds `limit` —
 * mirroring the actual API behavior (rejects outright, never truncates), confirmed against the
 * real OANDA API before this fix. */
function makeStubProvider(fixture: OandaCandle[], limit: number) {
  const calls: { from: string; to: string; returnedCount: number }[] = [];
  const getCandlesInRange = vi.fn(async (instrument: string, timeframe: 'H4' | 'D', from: string, to: string) => {
    const inRange = fixture.filter((c) => c.time >= from && c.time <= to);
    if (inRange.length > limit) {
      calls.push({ from, to, returnedCount: -1 });
      throw new OandaClientError("Maximum value for 'count' exceeded", 400);
    }
    calls.push({ from, to, returnedCount: inRange.length });
    return { provider: 'oanda-v20' as const, environment: 'practice' as const, instrument, timeframe, candles: inRange };
  });
  return { provider: { getCandlesInRange } as unknown as OandaCandleRangeProvider, calls };
}

describe('fetchAdaptiveWindow', () => {
  it('shrinks the window on repeated 400s until a request succeeds, without guessing a size up front', async () => {
    const fixture = Array.from({ length: 40 }, (_, i) => candle(new Date(Date.UTC(2020, 0, 1) + i * H4_MS).toISOString()));
    const { provider, calls } = makeStubProvider(fixture, 10);

    const windowStart = fixture[0]!.time;
    const ceiling = new Date(Date.parse(fixture.at(-1)!.time) + H4_MS).toISOString();
    const result = await fetchAdaptiveWindow(provider, 'TEST-SHRINK-ONLY', 'H4', windowStart, ceiling);

    expect(calls.length).toBeGreaterThan(1); // proves shrinking actually happened, not a lucky first try
    expect(calls.filter((c) => c.returnedCount === -1).length).toBeGreaterThan(0); // at least one 400 occurred
    expect(result.candles.length).toBeLessThanOrEqual(10);
    expect(result.candles.length).toBeGreaterThan(0);
  });

  it('propagates the error instead of looping forever if 400 persists even at the minimum window', async () => {
    const provider: OandaCandleRangeProvider = {
      getCandlesInRange: vi.fn(async () => {
        throw new OandaClientError("Maximum value for 'count' exceeded", 400);
      }),
    };

    await expect(
      fetchAdaptiveWindow(provider, 'TEST-PERSISTENT-400', 'H4', '2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z', 6 * H4_MS),
    ).rejects.toThrow("Maximum value for 'count' exceeded");
  });

  it('does not retry a non-400 error', async () => {
    const provider: OandaCandleRangeProvider = {
      getCandlesInRange: vi.fn(async () => {
        throw new OandaClientError('OANDA provider returned HTTP 500.', 500);
      }),
    };

    await expect(
      fetchAdaptiveWindow(provider, 'TEST-NON-400', 'H4', '2020-01-01T00:00:00.000Z', '2020-06-01T00:00:00.000Z'),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('backfillInstrument', () => {
  it('reassembles the full fixture with no gaps or duplicates purely by shrinking on 400, across many chunks', async () => {
    const instrument = testInstrument('TEST-REASSEMBLE');
    const fixture = Array.from({ length: 60 }, (_, i) => candle(new Date(Date.UTC(2020, 0, 1) + i * H4_MS).toISOString()));
    const { provider, calls } = makeStubProvider(fixture, 8);

    const fromIso = fixture[0]!.time;
    const toIso = new Date(Date.parse(fixture.at(-1)!.time) + H4_MS).toISOString();
    const result = await backfillInstrument(provider, instrument, 'H4', fromIso, toIso, 0);

    expect(result).toEqual(fixture);
    expect(calls.length).toBeGreaterThan(6); // multiple chunks, each with at least one shrink
  });

  it('handles a 400-on-large-range, then an empty-but-valid sub-window, then real data further along — the exact interleaving this fix targets', async () => {
    const instrument = testInstrument('TEST-INTERLEAVE');
    // Data only exists starting 20 days after the requested `from`, for 2 days — simulating an
    // instrument whose real history starts well after the requested backfill start date.
    const requestedFrom = new Date(Date.UTC(2020, 0, 1)).toISOString();
    const dataStart = Date.parse(requestedFrom) + 20 * DAY_MS;
    const fixture = Array.from({ length: 12 }, (_, i) => candle(new Date(dataStart + i * H4_MS).toISOString()));
    const requestedTo = new Date(Date.parse(fixture.at(-1)!.time) + DAY_MS).toISOString();

    const { provider, calls } = makeStubProvider(fixture, 8);
    const result = await backfillInstrument(provider, instrument, 'H4', requestedFrom, requestedTo, 0);

    // The old (broken) behavior would have `break`ed on the first empty result and returned [].
    expect(result).toEqual(fixture);
    expect(calls.some((c) => c.returnedCount === 0)).toBe(true); // an empty-but-successful sub-window occurred
    expect(calls.some((c) => c.returnedCount === -1)).toBe(true); // a 400 shrink occurred
    expect(calls.some((c) => c.returnedCount > 0)).toBe(true); // real data was eventually fetched
  });

  it('resumes from a previous partial cache instead of re-fetching from the start', async () => {
    const instrument = testInstrument('TEST-RESUME');
    const fixture = Array.from({ length: 20 }, (_, i) => candle(new Date(Date.UTC(2020, 0, 1) + i * H4_MS).toISOString()));
    const fromIso = fixture[0]!.time;
    const toIso = new Date(Date.parse(fixture.at(-1)!.time) + H4_MS).toISOString();

    // First run seeds the cache fully via the real cache file (backfillInstrument writes to disk).
    const { provider: firstProvider } = makeStubProvider(fixture, 100); // generous limit: this test is about resumption, not shrinking
    await backfillInstrument(firstProvider, instrument, 'H4', fromIso, toIso, 0);

    // Second run: the stub can answer any request, but if `backfillInstrument` restarted from
    // `fromIso` instead of resuming from the cached `fetchedThroughTime`, its first request
    // would start at `fromIso` — this asserts it instead starts at/after the last cached
    // candle's own time (the loop still re-touches that one boundary candle, which is
    // harmless and dedup'd; it must not re-request the whole range from scratch).
    const { provider: secondProvider, calls } = makeStubProvider(fixture, 100);
    const result = await backfillInstrument(secondProvider, instrument, 'H4', fromIso, toIso, 0);
    expect(result).toEqual(fixture);
    expect(calls[0]!.from >= fixture.at(-1)!.time).toBe(true);
  });

  it('re-fetches the earlier gap instead of skipping straight to the cached frontier when a later run asks for an earlier `fromIso` than any prior run covered', async () => {
    const instrument = testInstrument('TEST-EARLIER-FROM');
    const fixture = Array.from({ length: 20 }, (_, i) => candle(new Date(Date.UTC(2020, 0, 1) + i * H4_MS).toISOString()));
    const toIso = new Date(Date.parse(fixture.at(-1)!.time) + H4_MS).toISOString();

    // First run only covers the back half of the fixture.
    const narrowFromIso = fixture[10]!.time;
    const { provider: firstProvider } = makeStubProvider(fixture, 100);
    const firstResult = await backfillInstrument(firstProvider, instrument, 'H4', narrowFromIso, toIso, 0);
    expect(firstResult).toEqual(fixture.slice(10));

    // Second run asks for the full range, starting well before what the cache covers. The old
    // (broken) behavior compared only `fetchedThroughTime` and would jump straight to it,
    // silently skipping fixture[0..10) forever.
    const fullFromIso = fixture[0]!.time;
    const { provider: secondProvider } = makeStubProvider(fixture, 100);
    const result = await backfillInstrument(secondProvider, instrument, 'H4', fullFromIso, toIso, 0);
    expect(result).toEqual(fixture);
  });
});
