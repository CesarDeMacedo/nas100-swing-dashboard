import type { PriceZone } from '../schemas/analysis';
import type { Candle } from '../schemas/candles';
import { DEFAULT_STRATEGY_PARAMETERS } from './strategyParameters';
import { buildTechnicalContext } from './technicalContext';
import { calculateTradePlan, tradePlanToPatienceInputs } from './tradePlan';

const context = () =>
  buildTechnicalContext(
    Array.from({ length: 210 }, (_, index) => {
      const close = 100 + index;
      return {
        time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString().replace('Z', '-05:00'),
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        isClosed: true,
      } as Candle;
    }),
  );

const zone = (id: string, low: number, high: number, type: PriceZone['type']): PriceZone => ({
  id,
  low,
  high,
  type,
  label: id,
  source: 'test',
  confidence: 80,
  lockedByUser: false,
});

const longCandle = (): Candle => ({
  time: '2026-07-22T01:00:00-04:00',
  open: 306,
  high: 310,
  low: 305,
  close: 309,
  isClosed: true,
});
const shortCandle = (): Candle => ({
  time: '2026-07-22T01:00:00-04:00',
  open: 312,
  high: 313,
  low: 307,
  close: 309,
  isClosed: true,
});

describe('trade plan calculation', () => {
  it('creates a ready long plan with confirmation, ATR trigger, invalidation, stop, sorted targets, and R:R', () => {
    const plan = calculateTradePlan({
      direction: 'long',
      technicalContext: context(),
      latestCandle: longCandle(),
      supportZones: [zone('support', 307, 309, 'SUPPORT')],
      resistanceZones: [zone('r1', 320, 321, 'RESISTANCE'), zone('r2', 330, 331, 'RESISTANCE')],
    });

    expect(plan).toMatchObject({
      status: 'ready',
      locationStatus: 'acceptable',
      confirmationStatus: 'confirmed',
    });
    expect(plan.entryPrice).toBeGreaterThan(longCandle().high);
    expect(plan.stopPrice).toBeLessThan(plan.invalidationPrice!);
    expect(plan.targets).toEqual([...plan.targets].sort((a, b) => a - b));
    expect(plan.estimatedRewardRisk).toBeGreaterThanOrEqual(2);
  });

  it('creates a ready short plan with mirrored trigger, invalidation, stop, targets, and R:R', () => {
    const plan = calculateTradePlan({
      direction: 'short',
      technicalContext: context(),
      latestCandle: shortCandle(),
      supportZones: [zone('s1', 295, 296, 'SUPPORT'), zone('s2', 285, 286, 'SUPPORT')],
      resistanceZones: [zone('resistance', 309, 311, 'RESISTANCE')],
    });

    expect(plan).toMatchObject({
      status: 'ready',
      locationStatus: 'acceptable',
      confirmationStatus: 'confirmed',
    });
    expect(plan.entryPrice).toBeLessThan(shortCandle().low);
    expect(plan.stopPrice).toBeGreaterThan(plan.invalidationPrice!);
    expect(plan.targets).toEqual([...plan.targets].sort((a, b) => b - a));
    expect(plan.estimatedRewardRisk).toBeGreaterThanOrEqual(2);
  });

  it('reports forming plans for unreached locations and weak or open confirmations', () => {
    const weak = { ...longCandle(), close: 307, high: 310, low: 305 };
    const forming = calculateTradePlan({
      direction: 'long',
      technicalContext: context(),
      latestCandle: weak,
      supportZones: [zone('support', 300, 301, 'SUPPORT')],
      resistanceZones: [zone('r1', 320, 321, 'RESISTANCE')],
    });
    const open = calculateTradePlan({
      direction: 'long',
      technicalContext: context(),
      latestCandle: { ...longCandle(), isClosed: false },
      supportZones: [zone('support', 307, 309, 'SUPPORT')],
      resistanceZones: [],
    });

    expect(forming).toMatchObject({ status: 'forming', confirmationStatus: 'missing' });
    expect(open.confirmationStatus).toBe('open');
  });

  it('marks extended, invalid-structure, low-R:R, invalid geometry, and missing ATR plans safely', () => {
    const extended = calculateTradePlan({
      direction: 'long',
      technicalContext: context(),
      latestCandle: { ...longCandle(), close: 400, high: 401, low: 395 },
      supportZones: [],
      resistanceZones: [],
    });
    const belowRisk = calculateTradePlan({
      direction: 'long',
      technicalContext: context(),
      latestCandle: longCandle(),
      supportZones: [zone('support', 307, 309, 'SUPPORT')],
      resistanceZones: [zone('r1', 311, 312, 'RESISTANCE')],
    });
    const missingAtrContext = context();
    missingAtrContext.indicatorSnapshot.atr14.value = null;
    const missingAtr = calculateTradePlan({
      direction: 'long',
      technicalContext: missingAtrContext,
      latestCandle: longCandle(),
      supportZones: [],
      resistanceZones: [],
    });

    expect(extended.locationStatus).toBe('too_extended');
    expect(belowRisk.status).toBe('invalid');
    expect(missingAtr.status).toBe('unavailable');
  });

  it('deduplicates targets and maps plan fields to Patience Filter inputs', () => {
    const plan = calculateTradePlan({
      direction: 'long',
      technicalContext: context(),
      latestCandle: longCandle(),
      supportZones: [zone('support', 307, 309, 'SUPPORT')],
      resistanceZones: [zone('r1', 320, 321, 'RESISTANCE'), zone('r2', 320, 322, 'RESISTANCE')],
    });
    const adapter = tradePlanToPatienceInputs(plan);

    expect(plan.targets.filter((target) => target === 320)).toHaveLength(1);
    expect(adapter).toMatchObject({
      entryLocation: plan.locationStatus,
      confirmationCandle: plan.confirmationStatus,
      estimatedRR: plan.estimatedRewardRisk,
      stop: plan.stopPrice,
      targets: plan.targets,
    });
  });

  it('anchors invalidation to the traded zone instead of the deepest candidate when configured', () => {
    const input = {
      direction: 'long' as const,
      technicalContext: context(),
      latestCandle: longCandle(),
      supportZones: [zone('near', 307, 309, 'SUPPORT'), zone('deep', 290, 292, 'SUPPORT')],
      resistanceZones: [zone('r1', 320, 321, 'RESISTANCE'), zone('r2', 330, 331, 'RESISTANCE')],
    };
    const deepest = calculateTradePlan(input);
    const traded = calculateTradePlan(input, {
      ...DEFAULT_STRATEGY_PARAMETERS,
      invalidationAnchor: 'traded_zone',
    });

    expect(deepest.invalidationPrice).toBeLessThanOrEqual(290);
    expect(traded.invalidationPrice).toBeGreaterThan(300);
    expect(traded.estimatedRewardRisk).toBeGreaterThan(deepest.estimatedRewardRisk!);
  });

  it('labels targets[0] structural when a real level sets it and synthetic when the 2R fallback does', () => {
    const structural = calculateTradePlan({
      direction: 'long',
      technicalContext: context(),
      latestCandle: longCandle(),
      supportZones: [zone('support', 307, 309, 'SUPPORT')],
      resistanceZones: [zone('r1', 320, 321, 'RESISTANCE'), zone('r2', 330, 331, 'RESISTANCE')],
    });
    const synthetic = calculateTradePlan({
      direction: 'long',
      technicalContext: context(),
      latestCandle: longCandle(),
      supportZones: [zone('support', 307, 309, 'SUPPORT')],
      resistanceZones: [],
    });

    expect(structural.targetSource).toBe('structural');
    expect(synthetic.targetSource).toBe('synthetic');
    expect(synthetic.estimatedRewardRisk).toBeCloseTo(2, 6);
  });

  it('is deterministic and does not mutate inputs', () => {
    const value = {
      direction: 'long' as const,
      technicalContext: context(),
      latestCandle: longCandle(),
      supportZones: [zone('support', 307, 309, 'SUPPORT')],
      resistanceZones: [zone('r1', 320, 321, 'RESISTANCE')],
    };
    const before = structuredClone(value);

    expect(calculateTradePlan(value)).toEqual(calculateTradePlan(value));
    expect(value).toEqual(before);
  });
});
