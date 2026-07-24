// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AnalysisRepository } from '../persistence/analysisRepository';
import { parseOandaConfiguration } from '../providers/oanda/config';
import { OandaProvider } from '../providers/oanda/oandaProvider';
import { executeScheduledOandaAnalysis } from './scheduledOandaRun';

const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

const freshRepository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-scheduled-oanda-'));
  directories.push(directory);
  return new AnalysisRepository(join(directory, 'history.sqlite'));
};

const environment = { OANDA_ACCOUNT_ID: 'account-never-returned', OANDA_API_TOKEN: 'token-never-returned', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' };

const configuredProvider = (fetcher: typeof fetch) => {
  const configuration = parseOandaConfiguration(environment);
  if (configuration.state !== 'configured') throw new Error('Expected configured OANDA test environment.');
  return new OandaProvider(configuration, fetcher);
};

// Scheduler fires at 2026-07-24T17:01:00.000Z (Toronto 13:01 EDT). The H4 candle that
// should have just closed covers [13:00, 17:00) UTC, so its `time` is 13:00Z.
const STARTED_AT = new Date('2026-07-24T17:01:00.000Z');
const EXPECTED_CANDLE_TIME = '2026-07-24T13:00:00.000Z';
// One H4 window later/earlier, for the mismatch scenarios.
const STALE_CANDLE_TIME = '2026-07-24T09:00:00.000Z';
const ADVANCED_CANDLE_TIME = '2026-07-24T17:00:00.000Z';

type H4Step = { kind: 'error' } | { kind: 'candle'; time: string };

const dailyCandlePayload = { candles: [{ time: '2026-07-23T00:00:00.000Z', complete: true, mid: { o: '100', h: '101', l: '99', c: '100.5' } }] };

const crossMarketCandlePayload = { candles: [{ time: '2026-07-24T13:00:00.000Z', complete: true, mid: { o: '100', h: '101', l: '99', c: '100.5' } }] };

// Never let a test hit the real Forex Factory feed — resolves fast with a 404, which
// fetchForexFactoryEventRisk already treats as "unavailable" (falls back to the placeholder).
const stubEventRiskFetcher: typeof fetch = async () => new Response('', { status: 404 });

/** Routes H4 candle GETs for NAS100_USD through a scripted sequence of steps (one per call,
 * sequence padding at the end); Daily and cross-market (SPX500/US30/US2000) GETs always
 * succeed with a fixed candle, since those are supplementary and outside this module's
 * retry/window logic (fetched by src/service/oandaRun.ts's fetchCrossMarketH4). */
const buildFetcher = (steps: H4Step[]) => {
  let h4CallCount = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
    const parsed = new URL(url);
    if (parsed.searchParams.get('granularity') === 'D') {
      return new Response(JSON.stringify(dailyCandlePayload), { status: 200 });
    }
    if (!parsed.pathname.includes('NAS100_USD')) {
      return new Response(JSON.stringify(crossMarketCandlePayload), { status: 200 });
    }
    const step = steps[Math.min(h4CallCount, steps.length - 1)];
    h4CallCount += 1;
    if (step.kind === 'error') return new Response('', { status: 503 });
    return new Response(JSON.stringify({ candles: [{ time: step.time, complete: true, mid: { o: '100', h: '101', l: '99', c: '100.5' } }] }), { status: 200 });
  };
  return { fetcher, h4CallCount: () => h4CallCount };
};

describe('executeScheduledOandaAnalysis', () => {
  it('succeeds on the first attempt without retrying', async () => {
    const { fetcher, h4CallCount } = buildFetcher([{ kind: 'candle', time: EXPECTED_CANDLE_TIME }]);
    const repository = freshRepository();

    const result = await executeScheduledOandaAnalysis(repository, configuredProvider(fetcher), 'NAS100_USD', { now: () => STARTED_AT, retryDelaysMs: [10, 10, 10], eventRiskFetcher: stubEventRiskFetcher });

    expect(result.outcome).toBe('created');
    expect(result.report?.sourceCandleTime).toBe(EXPECTED_CANDLE_TIME);
    expect(h4CallCount()).toBe(1);
    repository.close();
  });

  it('retries past a transient network error within the same H4 window', async () => {
    const { fetcher, h4CallCount } = buildFetcher([{ kind: 'error' }, { kind: 'candle', time: EXPECTED_CANDLE_TIME }]);
    const repository = freshRepository();

    const result = await executeScheduledOandaAnalysis(repository, configuredProvider(fetcher), 'NAS100_USD', { now: () => STARTED_AT, retryDelaysMs: [10, 10, 10], eventRiskFetcher: stubEventRiskFetcher });

    expect(result.outcome).toBe('created');
    expect(h4CallCount()).toBe(2);
    repository.close();
  });

  it('retries past a stale candle (provider still finalizing the close) and succeeds once it catches up', async () => {
    const { fetcher, h4CallCount } = buildFetcher([{ kind: 'candle', time: STALE_CANDLE_TIME }, { kind: 'candle', time: EXPECTED_CANDLE_TIME }]);
    const repository = freshRepository();

    const result = await executeScheduledOandaAnalysis(repository, configuredProvider(fetcher), 'NAS100_USD', { now: () => STARTED_AT, retryDelaysMs: [10, 10, 10], eventRiskFetcher: stubEventRiskFetcher });

    expect(result.outcome).toBe('created');
    expect(result.report?.sourceCandleTime).toBe(EXPECTED_CANDLE_TIME);
    expect(h4CallCount()).toBe(2);
    repository.close();
  });

  it('blocks (not fails) after exhausting retries on a persistently stale candle, without building a report', async () => {
    const { fetcher, h4CallCount } = buildFetcher([{ kind: 'candle', time: STALE_CANDLE_TIME }]);
    const repository = freshRepository();

    const result = await executeScheduledOandaAnalysis(repository, configuredProvider(fetcher), 'NAS100_USD', { now: () => STARTED_AT, retryDelaysMs: [10, 10], eventRiskFetcher: stubEventRiskFetcher });

    expect(result.outcome).toBe('blocked');
    expect(result.report).toBeNull();
    expect(result.run.status).toBe('BLOCKED');
    expect(result.run.triggeredBy).toBe('scheduler');
    expect(result.message).toContain('3 attempt');
    expect(h4CallCount()).toBe(3);
    expect(repository.listHistory()).toHaveLength(1);
    repository.close();
  });

  it('aborts immediately on a candle from a later H4 window, without spending the retry budget', async () => {
    const { fetcher, h4CallCount } = buildFetcher([{ kind: 'candle', time: ADVANCED_CANDLE_TIME }, { kind: 'candle', time: EXPECTED_CANDLE_TIME }]);
    const repository = freshRepository();

    const result = await executeScheduledOandaAnalysis(repository, configuredProvider(fetcher), 'NAS100_USD', { now: () => STARTED_AT, retryDelaysMs: [10, 10, 10], eventRiskFetcher: stubEventRiskFetcher });

    expect(result.outcome).toBe('blocked');
    expect(result.report).toBeNull();
    expect(result.message).toContain(ADVANCED_CANDLE_TIME);
    // Only the first (advanced-window) call happened — the second scripted step, which
    // would have matched, was never reached because retrying here cannot help.
    expect(h4CallCount()).toBe(1);
    repository.close();
  });

  it('persists a real FAILED run after exhausting retries on repeated network errors, with attempt count and cause in the message', async () => {
    const { fetcher, h4CallCount } = buildFetcher([{ kind: 'error' }, { kind: 'error' }, { kind: 'error' }]);
    const repository = freshRepository();

    const result = await executeScheduledOandaAnalysis(repository, configuredProvider(fetcher), 'NAS100_USD', { now: () => STARTED_AT, retryDelaysMs: [10, 10], eventRiskFetcher: stubEventRiskFetcher });

    expect(result.outcome).toBe('failed');
    expect(result.report).toBeNull();
    expect(result.run.status).toBe('FAILED');
    expect(result.run.triggeredBy).toBe('scheduler');
    expect(result.message).toContain('3 attempt');
    expect(h4CallCount()).toBe(3);
    // Unlike today's behavior (nothing persisted on total fetch failure), this must be
    // a real, durable row — not just an in-memory scheduler status.
    expect(repository.listHistory()).toHaveLength(1);
    expect(repository.getRunByKey(result.run.runKey)?.run.status).toBe('FAILED');
    repository.close();
  });

  it('actually waits the configured retry delays instead of retrying immediately', async () => {
    const { fetcher } = buildFetcher([{ kind: 'error' }, { kind: 'candle', time: EXPECTED_CANDLE_TIME }]);
    const repository = freshRepository();
    const startedAtMs = Date.now();

    await executeScheduledOandaAnalysis(repository, configuredProvider(fetcher), 'NAS100_USD', { now: () => STARTED_AT, retryDelaysMs: [200], eventRiskFetcher: stubEventRiskFetcher });

    expect(Date.now() - startedAtMs).toBeGreaterThanOrEqual(190);
    repository.close();
  });
});
