import type { Candle } from '../schemas/candles';
import { DEFAULT_STRATEGY_PARAMETERS } from './strategyParameters';
import { buildTechnicalContext } from './technicalContext';
import {
  evaluatePatienceFilter,
  type PatienceFilterInput,
} from './patienceFilter';

const readyContext = () => {
  const candles: Candle[] = Array.from({ length: 210 }, (_, index) => {
    const close = 100 + index;
    return {
      time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString().replace('Z', '-05:00'),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      isClosed: true,
    };
  });
  return buildTechnicalContext(candles);
};

const input = (): PatienceFilterInput => ({
  technicalContext: readyContext(),
  dataFreshness: 'FRESH',
  providerStatus: 'HEALTHY',
  eventRisk: 'clear',
  estimatedRR: 2,
  entryLocation: 'acceptable',
  confirmationCandle: 'confirmed',
  crossMarket: {
    us500: { long: 'confirming', short: 'confirming' },
    us30: { long: 'neutral', short: 'neutral' },
    russell2000: { long: 'neutral', short: 'neutral' },
  },
  structurallyInvalidated: false,
  stop: 100,
  targets: [104],
});

describe('Patience Filter', () => {
  it('allows an entry only when all gates pass', () => {
    const result = evaluatePatienceFilter('long', input());

    expect(result).toMatchObject({ direction: 'long', status: 'allowed', canEnter: true });
    expect(result.passedChecks).toContain('minimum_reward_to_risk');
  });

  it('blocks open candles, stale data, unavailable providers, and structural invalidation', () => {
    const cases: Array<[string, (value: PatienceFilterInput) => void]> = [
      ['open candle', (value) => { value.technicalContext = { ...value.technicalContext!, latestCandleStatus: 'OPEN' }; }],
      ['stale data', (value) => { value.dataFreshness = 'STALE'; }],
      ['provider unavailable', (value) => { value.providerStatus = 'UNAVAILABLE'; }],
      ['structural invalidation', (value) => { value.structurallyInvalidated = true; }],
    ];

    cases.forEach(([, arrange]) => {
      const value = input();
      arrange(value);
      expect(evaluatePatienceFilter('long', value).status).toBe('blocked');
    });
  });

  it('no longer blocks or delays entry on event risk (advisory only)', () => {
    const blocking = input();
    blocking.eventRisk = 'blocking';
    const unknown = input();
    unknown.eventRisk = 'unknown';
    const invalid = input();
    invalid.eventRisk = 'invalid';

    expect(evaluatePatienceFilter('long', blocking)).toMatchObject({ status: 'allowed', canEnter: true });
    expect(evaluatePatienceFilter('long', unknown)).toMatchObject({ status: 'allowed', canEnter: true });
    expect(evaluatePatienceFilter('long', invalid)).toMatchObject({ status: 'allowed', canEnter: true });
  });

  it('waits for missing confirmation and an unreached entry location', () => {
    const confirmation = input();
    confirmation.confirmationCandle = 'missing';
    const location = input();
    location.entryLocation = 'not_reached';

    expect(evaluatePatienceFilter('long', confirmation).status).toBe('waiting');
    expect(evaluatePatienceFilter('long', location).status).toBe('waiting');
  });

  it('blocks invalid confirmation, extended location, sub-2.0 R:R, and missing stop or target inputs', () => {
    const cases: Array<(value: PatienceFilterInput) => void> = [
      (value) => { value.confirmationCandle = 'invalid'; },
      (value) => { value.entryLocation = 'too_extended'; },
      (value) => { value.estimatedRR = 1.99; },
      (value) => { value.stop = null; },
      (value) => { value.targets = []; },
    ];

    cases.forEach((arrange) => {
      const value = input();
      arrange(value);
      expect(evaluatePatienceFilter('long', value).status).toBe('blocked');
    });
  });

  it('no longer waits or blocks on incomplete or contradicting primary cross-market confirmation (advisory only)', () => {
    const incomplete = input();
    incomplete.crossMarket.us500.long = 'neutral';
    const contradictory = input();
    contradictory.crossMarket.us30.long = 'contradicting';

    expect(evaluatePatienceFilter('long', incomplete)).toMatchObject({ status: 'allowed', canEnter: true });
    expect(evaluatePatienceFilter('long', contradictory)).toMatchObject({ status: 'allowed', canEnter: true });
  });

  it('an empty crossMarketPrimaryInstruments still allows entry (advisory gate opted out)', () => {
    const value = input();
    value.crossMarket.us500.long = 'neutral';
    value.crossMarket.us30.long = 'neutral';
    value.crossMarket.russell2000.long = 'neutral';
    const params = { ...DEFAULT_STRATEGY_PARAMETERS, crossMarketPrimaryInstruments: [] };

    const result = evaluatePatienceFilter('long', value, params);

    expect(result).toMatchObject({ status: 'allowed', canEnter: true });
  });

  it('evaluates directions independently and never blocks on cross-market contradiction (advisory only)', () => {
    const value = input();
    value.crossMarket.us500.short = 'contradicting';
    value.crossMarket.russell2000.long = 'confirming';

    expect(evaluatePatienceFilter('long', value)).toMatchObject({ status: 'allowed', canEnter: true });
    expect(evaluatePatienceFilter('short', value)).toMatchObject({ status: 'allowed', canEnter: true });
  });

  it('is unavailable when a core evaluation input is missing', () => {
    const value = input();
    value.estimatedRR = null;

    expect(evaluatePatienceFilter('long', value)).toMatchObject({
      status: 'unavailable',
      canEnter: false,
      missingInputs: ['estimatedRR'],
    });
  });

  it('is deterministic and does not mutate input', () => {
    const value = input();
    const before = structuredClone(value);

    expect(evaluatePatienceFilter('long', value)).toEqual(evaluatePatienceFilter('long', value));
    expect(value).toEqual(before);
  });
});
