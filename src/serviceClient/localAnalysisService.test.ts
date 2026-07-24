import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalAnalysisServiceClient } from './localAnalysisService';

const run = { id: 'run-1', runKey: 'NAS100:H4:time:1.0.0:strategy:fixture', action: 'WAIT_FOR_PULLBACK', direction: 'long', score: 38, grade: 'D', isActionable: false, sourceCandleTime: '2026-07-21T21:00:00.000Z', persistedAt: '2026-07-22T00:00:00.000Z', alreadyExists: false };
const history = { runs: [{ run: { id: 'run-1', runKey: 'fixture-run', completedAt: '2026-07-22T01:01:00.000Z', status: 'COMPLETED', source: 'fixture', persistedAt: '2026-07-22T01:01:01.000Z', reportId: 'report-1' }, report: { action: 'WAIT_FOR_PULLBACK', direction: 'long', score: 38, grade: 'D', sourceCandleTime: '2026-07-22T01:00:00.000Z', isActionable: false } }] };

afterEach(() => vi.unstubAllGlobals());

describe('localAnalysisService', () => {
  it('returns available only for a healthy persistence response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'healthy', persistence: { available: true } }), { status: 200 })));
    await expect(createLocalAnalysisServiceClient('http://service').checkHealth()).resolves.toEqual({ kind: 'available' });
  });

  it('handles unavailable and malformed service responses safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(createLocalAnalysisServiceClient('http://service').checkHealth()).resolves.toMatchObject({ kind: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(createLocalAnalysisServiceClient('http://service').checkHealth()).resolves.toMatchObject({ kind: 'malformed_response' });
  });

  it('reports OANDA configured/unconfigured/invalid status without requiring credentials', async () => {
    const client = createLocalAnalysisServiceClient('http://service');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: 'configured', environment: 'practice', configuredInstrument: true }), { status: 200 })));
    await expect(client.checkOandaStatus?.()).resolves.toEqual({ kind: 'configured', environment: 'practice', configuredInstrument: true });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: 'unconfigured', environment: 'practice', configuredInstrument: false, message: 'OANDA_ACCOUNT_ID and OANDA_API_TOKEN are required before provider verification.' }), { status: 200 })));
    await expect(client.checkOandaStatus?.()).resolves.toEqual({ kind: 'unconfigured', environment: 'practice', message: 'OANDA_ACCOUNT_ID and OANDA_API_TOKEN are required before provider verification.' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: 'invalid', environment: null, message: 'OANDA_ENVIRONMENT must be "practice" or "live".' }), { status: 200 })));
    await expect(client.checkOandaStatus?.()).resolves.toEqual({ kind: 'invalid', message: 'OANDA_ENVIRONMENT must be "practice" or "live".' });
  });

  it('never exposes credentials and falls back to unavailable for unreachable or malformed OANDA status', async () => {
    const client = createLocalAnalysisServiceClient('http://service');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(client.checkOandaStatus?.()).resolves.toEqual({ kind: 'unavailable', message: 'OANDA configuration status is unavailable.' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const result = await client.checkOandaStatus?.();
    expect(result?.kind).toBe('unavailable');
    expect(JSON.stringify(result)).not.toMatch(/token|secret|account.?id/i);
  });

  it('distinguishes saved, duplicate, and malformed manual runs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 201 })));
    await expect(createLocalAnalysisServiceClient('http://service').runManualFixture()).resolves.toMatchObject({ kind: 'succeeded', run });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...run, alreadyExists: true }), { status: 200 })));
    await expect(createLocalAnalysisServiceClient('http://service').runManualFixture()).resolves.toMatchObject({ kind: 'already_exists' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })));
    await expect(createLocalAnalysisServiceClient('http://service').runManualFixture()).resolves.toMatchObject({ kind: 'malformed_response' });
  });

  it('loads typed history and immutable report details safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(history), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ ...history.runs[0], report: { ...history.runs[0].report, primaryReason: 'Pending pullback.', entryTrigger: null, stopPrice: null, targets: [], estimatedRewardRisk: null } }), { status: 200 })));
    const client = createLocalAnalysisServiceClient('http://service');
    await expect(client.listRecentRuns(10)).resolves.toMatchObject({ kind: 'succeeded', runs: history.runs });
    await expect(client.getRunByKey('fixture-run')).resolves.toMatchObject({ kind: 'succeeded', report: { primaryReason: 'Pending pullback.' } });
  });

  it('loads OANDA preview candles only through the local service endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ provider: 'oanda-v20', environment: 'practice', instrument: 'NAS100_USD', timeframe: 'H4', candles: [{ time: '2026-07-22T00:00:00.000Z', open: 1, high: 2, low: 0.5, close: 1.5, isClosed: false, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20' }] }), { status: 200 })));
    await expect(createLocalAnalysisServiceClient('http://service').getOandaCandles?.(250)).resolves.toMatchObject({ kind: 'succeeded', data: { candles: [{ isClosed: false }] } });
    expect(fetch).toHaveBeenCalledWith('http://service/providers/oanda/candles?count=250', undefined);
  });

  it('handles empty, failed, and malformed history responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ runs: [] }), { status: 200 })));
    await expect(createLocalAnalysisServiceClient('http://service').listRecentRuns(10)).resolves.toMatchObject({ kind: 'empty' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(createLocalAnalysisServiceClient('http://service').listRecentRuns(10)).resolves.toMatchObject({ kind: 'malformed_response' });
  });
});
