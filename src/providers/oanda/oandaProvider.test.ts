// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { oandaConfigurationStatus, parseOandaConfiguration } from './config';
import { OandaProvider, findNas100CandidatesFromInstruments, normalizeH4Candle } from './oandaProvider';

const environment = {
  OANDA_ENVIRONMENT: 'practice',
  OANDA_ACCOUNT_ID: '101-001-1234567-001',
  OANDA_API_TOKEN: 'test-token-never-returned',
  OANDA_NAS100_INSTRUMENT: 'NAS100_USD',
};

const configured = () => {
  const configuration = parseOandaConfiguration(environment);
  if (configuration.state !== 'configured') throw new Error('Expected configured OANDA test environment.');
  return configuration;
};

const instrumentsPayload = {
  instruments: [
    { name: 'NAS100_USD', displayName: 'NAS 100', type: 'CFD', displayPrecision: 1, pipLocation: -1 },
    { name: 'EUR_USD', displayName: 'EUR/USD', type: 'CURRENCY', displayPrecision: 5, pipLocation: -4 },
  ],
};

describe('OANDA configuration', () => {
  it('defaults to practice and selects practice or live base URLs', () => {
    expect(parseOandaConfiguration({ OANDA_ACCOUNT_ID: 'account', OANDA_API_TOKEN: 'token' })).toMatchObject({ state: 'configured', environment: 'practice', baseUrl: 'https://api-fxpractice.oanda.com' });
    expect(parseOandaConfiguration({ ...environment, OANDA_ENVIRONMENT: 'live' })).toMatchObject({ state: 'configured', environment: 'live', baseUrl: 'https://api-fxtrade.oanda.com' });
  });

  it('is safely unconfigured for missing credentials and never exposes the token in status or errors', () => {
    const missing = parseOandaConfiguration({ OANDA_API_TOKEN: 'secret-token' });
    const invalid = parseOandaConfiguration({ ...environment, OANDA_ENVIRONMENT: 'unsupported' });

    expect(missing).toMatchObject({ state: 'unconfigured' });
    expect(JSON.stringify(oandaConfigurationStatus(missing))).not.toContain('secret-token');
    expect(invalid).toMatchObject({ state: 'invalid' });
    expect(JSON.stringify(invalid)).not.toContain(environment.OANDA_API_TOKEN);
  });
});

describe('OANDA read-only provider', () => {
  it('uses Bearer authorization and GET only while normalizing instruments and candidates', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify(instrumentsPayload), { status: 200 });
    };
    const provider = new OandaProvider(configured(), fetcher);
    const instruments = await provider.getAccountInstruments();

    expect(instruments).toEqual(instrumentsPayload.instruments);
    expect(findNas100CandidatesFromInstruments(instruments)).toEqual([instrumentsPayload.instruments[0]]);
    expect(requestInit).toMatchObject({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer test-token-never-returned' }) });
  });

  it('requests midpoint H4 candles and preserves the explicit open-candle state', async () => {
    let requestUrl = '';
    const fetcher: typeof fetch = async (input) => {
      requestUrl = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
      return new Response(JSON.stringify({ candles: [{ time: '2026-07-21T21:00:00.000Z', complete: false, volume: 14, mid: { o: '29000', h: '29040', l: '28980', c: '29020' } }] }), { status: 200 });
    };
    const provider = new OandaProvider(configured(), fetcher);
    const result = await provider.getH4Candles('NAS100_USD', 250);
    const url = new URL(requestUrl);

    expect(url.searchParams.get('granularity')).toBe('H4');
    expect(url.searchParams.get('price')).toBe('M');
    expect(url.searchParams.get('count')).toBe('250');
    expect(result.candles[0]).toMatchObject({ isClosed: false, open: 29000, high: 29040, low: 28980, close: 29020 });
  });

  it('rejects invalid OHLC and invalid candle counts safely', async () => {
    expect(() => normalizeH4Candle({ time: '2026-07-21T21:00:00.000Z', complete: true, mid: { o: '10', h: '9', l: '8', c: '10' } }, 'NAS100_USD')).toThrow('Invalid OANDA response');
    const provider = new OandaProvider(configured(), vi.fn());
    await expect(provider.getH4Candles('NAS100_USD', 0)).rejects.toThrow('Candle count must be an integer between 1 and 5000.');
    await expect(provider.getH4Candles('NAS100_USD', 5001)).rejects.toThrow('Candle count must be an integer between 1 and 5000.');
  });
});
