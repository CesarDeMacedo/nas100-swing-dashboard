// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { fetchForexFactoryEventRisk } from './forexFactoryEventRisk';

const now = new Date('2026-07-24T13:00:00.000Z');

const jsonFetcher = (payload: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(payload), { status });

describe('fetchForexFactoryEventRisk', () => {
  it('classifies a High-impact USD event inside the +/-60min window as BLOCKING', async () => {
    const payload = [{ title: 'Non-Farm Payrolls', country: 'USD', date: '2026-07-24T13:20:00.000Z', impact: 'High' }];

    const events = await fetchForexFactoryEventRisk(jsonFetcher(payload), now);

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({ status: 'AVAILABLE', severity: 'BLOCKING', blocksEntry: true, eventName: 'Non-Farm Payrolls' });
  });

  it('classifies a High-impact USD event far outside the window as informational only', async () => {
    const payload = [{ title: 'Fed Chair Speaks', country: 'USD', date: '2026-07-26T13:20:00.000Z', impact: 'High' }];

    const events = await fetchForexFactoryEventRisk(jsonFetcher(payload), now);

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({ status: 'AVAILABLE', severity: 'HIGH', blocksEntry: false });
  });

  it('ignores non-USD events, Holiday-impact events, and malformed entries without failing the whole feed', async () => {
    const payload = [
      { title: 'ECB Rate Decision', country: 'EUR', date: '2026-07-24T13:20:00.000Z', impact: 'High' },
      { title: 'Bank Holiday', country: 'USD', date: '2026-07-24T13:20:00.000Z', impact: 'Holiday' },
      { title: '', country: 'USD', date: '2026-07-24T13:20:00.000Z', impact: 'High' }, // empty title
      { country: 'USD', date: '2026-07-24T13:20:00.000Z', impact: 'High' }, // missing title entirely
      { title: 'CPI m/m', country: 'USD', date: 'not-a-date', impact: 'High' }, // unparseable date
      'not even an object',
      { title: 'CPI y/y', country: 'USD', date: '2026-07-24T13:20:00.000Z', impact: 'Medium' },
    ];

    const events = await fetchForexFactoryEventRisk(jsonFetcher(payload), now);

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({ eventName: 'CPI y/y', severity: 'MEDIUM', blocksEntry: false });
  });

  it('degrades to null (fail-safe) on a non-200 response, never throwing', async () => {
    const events = await fetchForexFactoryEventRisk(jsonFetcher([], 503), now);
    expect(events).toBeNull();
  });

  it('degrades to null (fail-safe) on malformed JSON, never throwing', async () => {
    const fetcher: typeof fetch = async () => new Response('not json', { status: 200 });
    const events = await fetchForexFactoryEventRisk(fetcher, now);
    expect(events).toBeNull();
  });

  it('degrades to null (fail-safe) when the payload is not an array', async () => {
    const events = await fetchForexFactoryEventRisk(jsonFetcher({ candles: [] }), now);
    expect(events).toBeNull();
  });

  it('degrades to null (fail-safe) on a rejected fetch, never throwing', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('network unreachable'); };
    const events = await fetchForexFactoryEventRisk(fetcher, now);
    expect(events).toBeNull();
  });

  it('degrades to null within the timeout instead of hanging forever', async () => {
    const fetcher: typeof fetch = () => new Promise(() => {}); // never resolves
    const startedAtMs = Date.now();

    const events = await fetchForexFactoryEventRisk(fetcher, now, 20);

    expect(Date.now() - startedAtMs).toBeLessThan(1000);
    expect(events).toBeNull();
  });

  it('returns an empty array (not null) when the fetch succeeds but nothing relevant is found this week', async () => {
    const events = await fetchForexFactoryEventRisk(jsonFetcher([]), now);
    expect(events).toEqual([]);
  });
});
