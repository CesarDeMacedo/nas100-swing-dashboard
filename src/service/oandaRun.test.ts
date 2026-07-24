// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AnalysisRepository } from '../persistence/analysisRepository';
import type { OandaDailyCandleResult, OandaH4CandleResult } from '../providers/oanda/types';
import { buildOandaMultiTimeframeInputs, buildOandaReportInputs, fetchCrossMarketH4, runManualOandaAnalysis, type CrossMarketH4Results } from './oandaRun';
import type { EventRisk } from '../schemas';
import { OandaProvider } from '../providers/oanda/oandaProvider';
import { parseOandaConfiguration } from '../providers/oanda/config';

const directories: string[] = [];

const source = (latestTime = '2026-07-21T20:00:00.000Z'): OandaH4CandleResult => ({
  provider: 'oanda-v20', environment: 'practice', instrument: 'NAS100_USD', timeframe: 'H4',
  candles: [
    { time: '2026-07-21T12:00:00.000Z', open: 29000, high: 29020, low: 28990, close: 29010, isClosed: true, volume: 10, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20' },
    { time: latestTime, open: 29010, high: 29040, low: 29000, close: 29030, isClosed: true, volume: 11, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20' },
    { time: '2026-07-22T00:00:00.000Z', open: 29030, high: 99999, low: 1, close: 99998, isClosed: false, volume: 12, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20' },
  ],
});

const dailySource = (): OandaDailyCandleResult => ({
  provider: 'oanda-v20', environment: 'practice', instrument: 'NAS100_USD', timeframe: 'D',
  candles: [
    { time: '2026-07-19T00:00:00.000Z', open: 28000, high: 28100, low: 27900, close: 28050, isClosed: true, volume: 10, instrument: 'NAS100_USD', timeframe: 'D', source: 'oanda-v20' },
    { time: '2026-07-20T00:00:00.000Z', open: 28050, high: 28200, low: 28000, close: 28150, isClosed: true, volume: 11, instrument: 'NAS100_USD', timeframe: 'D', source: 'oanda-v20' },
    { time: '2026-07-21T00:00:00.000Z', open: 28150, high: 99999, low: 1, close: 99998, isClosed: false, volume: 12, instrument: 'NAS100_USD', timeframe: 'D', source: 'oanda-v20' },
  ],
});

const levelSource = (): OandaH4CandleResult => ({
  provider: 'oanda-v20', environment: 'practice', instrument: 'NAS100_USD', timeframe: 'H4',
  candles: Array.from({ length: 22 }, (_, index) => ({
    time: new Date(Date.UTC(2026, 6, 1, index * 4)).toISOString(),
    open: 102,
    high: index === 12 ? 120 : 108,
    low: index === 5 ? 90 : 98,
    close: index === 21 ? 105 : 103,
    isClosed: index !== 21,
    volume: 10,
    instrument: 'NAS100_USD',
    timeframe: 'H4' as const,
    source: 'oanda-v20' as const,
  })),
});

// A long enough H4 series (with a confirmed swing tail) to deterministically classify as
// bullish_trend/bearish_trend under classifyH4Structure — same pattern as h4Structure.test.ts.
const trendSource = (instrument: string, direction: 'up' | 'down'): OandaH4CandleResult => {
  const pattern = direction === 'up' ? [0, 4, 1, -3, 0, 3] : [0, -4, -1, 3, 0, -3];
  const tail = direction === 'up' ? [223, 224, 225] : [277, 276, 275];
  const closes = [
    ...Array.from({ length: 62 }, (_, index) => (direction === 'up' ? 100 + index * 2 : 400 - index * 2) + pattern[index % pattern.length]!),
    ...tail,
  ];
  return {
    provider: 'oanda-v20', environment: 'practice', instrument, timeframe: 'H4',
    candles: closes.map((close, index) => ({
      time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString(),
      open: close, high: close + 1, low: close - 1, close, isClosed: true, volume: 10,
      instrument, timeframe: 'H4' as const, source: 'oanda-v20' as const,
    })),
  };
};

const repository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-oanda-run-'));
  directories.push(directory);
  return new AnalysisRepository(join(directory, 'history.sqlite'));
};

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('manual OANDA analysis run', () => {
  it('builds a validated non-synthetic completed-only dataset and explicit unavailable contexts', () => {
    const { analysis, candles } = buildOandaReportInputs(source(), '2026-07-22T01:00:00.000Z');

    expect(candles).toMatchObject({ isSynthetic: false, instrument: 'NAS100_USD', timeframe: 'H4' });
    expect(candles.candles).toHaveLength(2);
    expect(candles.candles.at(-1)).toMatchObject({ time: '2026-07-21T20:00:00.000Z', close: 29030, isClosed: true });
    expect(JSON.stringify(candles)).not.toContain('99999');
    expect(analysis).toMatchObject({ completedCandleAt: '2026-07-21T20:00:00.000Z', currentPrice: 29030, supportZones: [], resistanceZones: [] });
    expect(analysis.crossMarket).toMatchObject({ confirmationStatus: 'UNAVAILABLE', dataFreshness: 'MISSING' });
    expect(analysis.eventRisk[0]).toMatchObject({ status: 'UNAVAILABLE', freshness: 'MISSING' });
    expect(analysis.marketContext.join(' ')).not.toContain('fixture');
  });

  it('keeps completed H4 and Daily inputs separate for their respective classifications', () => {
    const { multiTimeframe, technicalContext } = buildOandaMultiTimeframeInputs(source(), dailySource(), '2026-07-22T01:00:00.000Z');

    expect(multiTimeframe).toMatchObject({ h4SourceCandleTime: '2026-07-21T20:00:00.000Z', dailySourceCandleTime: '2026-07-20T00:00:00.000Z', h4CompletedCandleCount: 2, dailyCompletedCandleCount: 2, h4ExcludedOpenCandleCount: 1, dailyExcludedOpenCandleCount: 1 });
    expect(JSON.stringify(multiTimeframe.h4Candles)).not.toContain('99999');
    expect(JSON.stringify(multiTimeframe.dailyCandles)).not.toContain('99999');
    expect(technicalContext.h4Structure.sourceCandleTime).toBe('2026-07-21T20:00:00.000Z');
    expect(technicalContext.dailyRegime.sourceCandleTime).toBe('2026-07-20T00:00:00.000Z');
    expect(technicalContext.dailyRegime.status).toBe('unavailable');
  });

  it('uses calculated completed-H4 market levels in new OANDA reports instead of fixture levels', () => {
    const { analysis } = buildOandaMultiTimeframeInputs(levelSource(), dailySource(), '2026-07-22T01:00:00.000Z');
    const store = repository();
    const result = runManualOandaAnalysis(store, levelSource(), dailySource());

    expect(analysis.supportZones).not.toHaveLength(0);
    expect(analysis.resistanceZones).not.toHaveLength(0);
    expect(analysis.supportZones.every((zone) => zone.source.startsWith('OANDA H4 confirmed swing'))).toBe(true);
    expect(analysis.resistanceZones.every((zone) => zone.source.startsWith('OANDA H4 confirmed swing'))).toBe(true);
    expect(result.report?.supportZones).toEqual(analysis.supportZones);
    expect(result.report?.resistanceZones).toEqual(analysis.resistanceZones);
    expect(JSON.stringify(result.report)).not.toContain('fixture');
    store.close();
  });

  it('persists one safe immutable report per latest completed candle', () => {
    const store = repository();
    const first = runManualOandaAnalysis(store, source(), dailySource());
    const repeated = runManualOandaAnalysis(store, source(), dailySource());
    const next = runManualOandaAnalysis(store, source('2026-07-22T04:00:00.000Z'), dailySource());

    expect(first.outcome).toBe('created');
    expect(first.report).toMatchObject({ sourceCandleTime: '2026-07-21T20:00:00.000Z', dailySourceCandleTime: '2026-07-20T00:00:00.000Z', currentPrice: 29030, isActionable: false });
    expect(['WAIT', 'NO_TRADE', 'WAIT_FOR_PULLBACK', 'WAIT_FOR_NEXT_4H_CLOSE']).toContain(first.report?.action);
    expect(['BUY', 'SELL']).not.toContain(first.report?.action);
    expect(first.report?.entryPrice).toBeNull();
    expect(first.report?.targets).toEqual([]);
    expect(first.report?.displaySnapshot).toMatchObject({ provider: 'oanda-v20', environment: 'practice', instrument: 'NAS100_USD', timeframe: 'H4', h4SourceCandleTime: '2026-07-21T20:00:00.000Z' });
    expect(first.report?.displaySnapshot?.candles).toHaveLength(2);
    expect(JSON.stringify(first.report?.displaySnapshot)).not.toContain('99999');
    expect(repeated).toMatchObject({ outcome: 'already_exists', run: { id: first.run.id } });
    expect(next).toMatchObject({ outcome: 'created' });
    expect(next.run.runKey).not.toBe(first.run.runKey);
    store.close();
  });

  it('records a safe blocked run when OANDA returns no completed candles', () => {
    const store = repository();
    const openOnly = { ...source(), candles: [source().candles.at(-1)!] };

    const result = runManualOandaAnalysis(store, openOnly);

    expect(result).toMatchObject({ outcome: 'blocked', report: null, completedCandleCount: 0, excludedOpenCandleCount: 1 });
    expect(result.run.status).toBe('BLOCKED');
    expect(result.run.runKey).not.toContain('2026-07-22T00:00:00.000Z');
    store.close();
  });

  it('classifies a cross-market instrument as CONFIRMING when its own H4 trend matches NAS100', () => {
    const nas100 = trendSource('NAS100_USD', 'up');
    const crossMarketH4: CrossMarketH4Results = { us500: trendSource('SPX500_USD', 'up') };

    const { analysis } = buildOandaMultiTimeframeInputs(nas100, dailySource(), '2026-01-02T00:00:00.000Z', crossMarketH4);

    expect(analysis.crossMarket.us500).toMatchObject({ instrument: 'US500', confirmation: 'CONFIRMING', dataFreshness: 'FRESH' });
    expect(analysis.crossMarket.us30).toMatchObject({ instrument: 'US30', confirmation: 'UNAVAILABLE', dataFreshness: 'MISSING' });
    // Only us500 has data and it confirms; the two UNAVAILABLE instruments are excluded from the aggregate, not counted against it.
    expect(analysis.crossMarket.confirmationStatus).toBe('CONFIRMING');
  });

  it('classifies a cross-market instrument as CONTRADICTING when its own H4 trend opposes NAS100', () => {
    const nas100 = trendSource('NAS100_USD', 'up');
    const crossMarketH4: CrossMarketH4Results = { us500: trendSource('SPX500_USD', 'down'), us30: trendSource('US30_USD', 'up'), russell2000: trendSource('US2000_USD', 'up') };

    const { analysis } = buildOandaMultiTimeframeInputs(nas100, dailySource(), '2026-01-02T00:00:00.000Z', crossMarketH4);

    expect(analysis.crossMarket.us500.confirmation).toBe('CONTRADICTING');
    expect(analysis.crossMarket.us30.confirmation).toBe('CONFIRMING');
    expect(analysis.crossMarket.russell2000.confirmation).toBe('CONFIRMING');
    // A mix of confirming and contradicting primary/complementary instruments is MIXED, not a clean read.
    expect(analysis.crossMarket.confirmationStatus).toBe('MIXED');
  });

  it('stays UNAVAILABLE and MISSING when no cross-market data is supplied at all, exactly as before this feature', () => {
    const { analysis } = buildOandaMultiTimeframeInputs(trendSource('NAS100_USD', 'up'), dailySource(), '2026-01-02T00:00:00.000Z');

    expect(analysis.crossMarket).toMatchObject({ confirmationStatus: 'UNAVAILABLE', dataFreshness: 'MISSING' });
    expect(analysis.crossMarket.us500).toMatchObject({ confirmation: 'UNAVAILABLE', dataFreshness: 'MISSING' });
  });

  it('never authorizes BUY/SELL from cross-market confirmation alone, since event-risk remains unavailable', () => {
    const store = repository();
    const nas100 = trendSource('NAS100_USD', 'up');
    const crossMarketH4: CrossMarketH4Results = { us500: trendSource('SPX500_USD', 'up'), us30: trendSource('US30_USD', 'up'), russell2000: trendSource('US2000_USD', 'up') };

    const result = runManualOandaAnalysis(store, nas100, dailySource(), 'user', crossMarketH4);

    expect(['BUY', 'SELL']).not.toContain(result.report?.action);
    expect(result.report?.isActionable).toBe(false);
    expect(result.report?.primaryReason).toContain('Entry authorization is disabled');
    store.close();
  });

  it('fetchCrossMarketH4 degrades a single failing instrument to UNAVAILABLE without failing the others', async () => {
    const environment = { OANDA_ACCOUNT_ID: 'account-never-returned', OANDA_API_TOKEN: 'token-never-returned', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' };
    const configuration = parseOandaConfiguration(environment);
    if (configuration.state !== 'configured') throw new Error('Expected configured OANDA test environment.');
    const okPayload = JSON.stringify({ candles: [{ time: '2026-01-01T00:00:00.000Z', complete: true, mid: { o: '100', h: '101', l: '99', c: '100.5' } }] });
    const fetcher: typeof fetch = async (input) => {
      const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
      if (url.includes('US30_USD')) throw new Error('network unreachable');
      return new Response(okPayload, { status: 200 });
    };
    const provider = new OandaProvider(configuration, fetcher);

    const result = await fetchCrossMarketH4(provider, 10);

    expect(result.us500).toBeDefined();
    expect(result.russell2000).toBeDefined();
    expect(result.us30).toBeUndefined();
  });

  it('fetchCrossMarketH4 degrades a hung instrument to UNAVAILABLE within the timeout, instead of blocking forever', async () => {
    const environment = { OANDA_ACCOUNT_ID: 'account-never-returned', OANDA_API_TOKEN: 'token-never-returned', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' };
    const configuration = parseOandaConfiguration(environment);
    if (configuration.state !== 'configured') throw new Error('Expected configured OANDA test environment.');
    const okPayload = JSON.stringify({ candles: [{ time: '2026-01-01T00:00:00.000Z', complete: true, mid: { o: '100', h: '101', l: '99', c: '100.5' } }] });
    const fetcher: typeof fetch = async (input) => {
      const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
      if (url.includes('US30_USD')) return new Promise(() => {}); // never resolves
      return new Response(okPayload, { status: 200 });
    };
    const provider = new OandaProvider(configuration, fetcher);
    const startedAtMs = Date.now();

    const result = await fetchCrossMarketH4(provider, 10, 20);

    expect(Date.now() - startedAtMs).toBeLessThan(1000);
    expect(result.us500).toBeDefined();
    expect(result.russell2000).toBeDefined();
    expect(result.us30).toBeUndefined();
  });

  it('reflects real (non-placeholder) event-risk data in the analysis when it is supplied, but still never authorizes BUY/SELL', () => {
    const store = repository();
    const blockingEvent: EventRisk = { status: 'AVAILABLE', severity: 'BLOCKING', eventName: 'Non-Farm Payrolls', eventTime: '2026-01-02T00:20:00.000Z', source: 'forex-factory-spike', freshness: 'FRESH', blocksEntry: true, notes: ['test'] };

    const { analysis } = buildOandaMultiTimeframeInputs(trendSource('NAS100_USD', 'up'), dailySource(), '2026-01-02T00:00:00.000Z', {}, [blockingEvent]);
    const result = runManualOandaAnalysis(store, trendSource('NAS100_USD', 'up'), dailySource(), 'user', {}, [blockingEvent]);

    expect(analysis.eventRisk).toEqual([blockingEvent]);
    expect(analysis.whyNoEntry).toEqual([]); // no longer the stale "unavailable" placeholder text
    expect(['BUY', 'SELL']).not.toContain(result.report?.action);
    expect(result.report?.isActionable).toBe(false);
    expect(result.report?.primaryReason).toContain('Entry authorization is disabled');
    store.close();
  });

  it('treats an explicitly empty event-risk array as a genuine "fetched, nothing relevant found" result, not as unavailable', () => {
    const { analysis } = buildOandaMultiTimeframeInputs(trendSource('NAS100_USD', 'up'), dailySource(), '2026-01-02T00:00:00.000Z', {}, []);

    expect(analysis.eventRisk).toEqual([]);
    expect(analysis.whyNoEntry).toEqual([]);
  });

  it('falls back to the UNAVAILABLE event-risk placeholder when no event-risk data is supplied at all, exactly as before this feature', () => {
    const { analysis } = buildOandaMultiTimeframeInputs(trendSource('NAS100_USD', 'up'), dailySource(), '2026-01-02T00:00:00.000Z');

    expect(analysis.eventRisk).toMatchObject([{ status: 'UNAVAILABLE', freshness: 'MISSING' }]);
    expect(analysis.whyNoEntry).toEqual(['Event-risk data is unavailable.']);
  });
});
