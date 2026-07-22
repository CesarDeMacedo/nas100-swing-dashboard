import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalAnalysisServiceClient } from './localAnalysisService';

const run = { id: 'run-1', runKey: 'NAS100:H4:time:1.0.0:strategy:fixture', action: 'WAIT_FOR_PULLBACK', direction: 'long', score: 38, grade: 'D', isActionable: false, sourceCandleTime: '2026-07-21T21:00:00.000Z', persistedAt: '2026-07-22T00:00:00.000Z', alreadyExists: false };

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

  it('distinguishes saved, duplicate, and malformed manual runs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 201 })));
    await expect(createLocalAnalysisServiceClient('http://service').runManualFixture()).resolves.toMatchObject({ kind: 'succeeded', run });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...run, alreadyExists: true }), { status: 200 })));
    await expect(createLocalAnalysisServiceClient('http://service').runManualFixture()).resolves.toMatchObject({ kind: 'already_exists' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })));
    await expect(createLocalAnalysisServiceClient('http://service').runManualFixture()).resolves.toMatchObject({ kind: 'malformed_response' });
  });
});
