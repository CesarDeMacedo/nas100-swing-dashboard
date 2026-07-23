// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AnalysisRepository } from '../persistence/analysisRepository';
import type { OandaDailyCandleResult, OandaH4CandleResult } from '../providers/oanda/types';
import { buildOandaMultiTimeframeInputs, buildOandaReportInputs, runManualOandaAnalysis } from './oandaRun';

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
});
