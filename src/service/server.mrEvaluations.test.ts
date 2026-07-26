import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AnalysisRepository } from '../persistence/analysisRepository';
import type { OandaCandle } from '../providers/oanda/types';
import type { StrategyParameters } from '../schemas/strategyConfig';
import type { OandaProvider } from '../providers/oanda/oandaProvider';
import { evaluateActiveMeanReversionStrategies } from './server';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

const createRepository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'nas100-mr-dedup-'));
  temporaryDirectories.push(directory);
  return new AnalysisRepository(join(directory, 'history.sqlite'));
};

const parameters: StrategyParameters = {
  minRewardRisk: 2,
  premiumScoreThreshold: 70,
  atrLocationTolerance: 0.35,
  atrTriggerBuffer: 0.05,
  atrStopBuffer: 0.25,
  atrInvalidationBuffer: 0.1,
  confirmationClosePositionThreshold: 0.6,
  crossMarketPrimaryInstruments: ['us500', 'us30'],
  invalidationAnchor: 'deepest',
  strategyKind: 'double7',
  meanReversion: {
    timeframe: 'D',
    smaFilterPeriod: 200,
    rsiPeriod: 2,
    rsiEntryThreshold: 5,
    rsiExitThreshold: 65,
    lookbackEntryLow: 7,
    lookbackExitHigh: 7,
    protectiveStopAtrMultiple: 2,
    atrPeriod: 14,
    maxBarsHeld: null,
  },
  setupScoreWeights: {
    trend: 20,
    structure: 20,
    momentum: 15,
    location: 15,
    crossMarket: 10,
    eventRisk: 5,
    rewardRisk: 10,
    patienceReadiness: 5,
  },
  eventRisk: { blockingWindowMinutes: 60, minImpact: 'High' },
};

const dailyCandle = (index: number, close: number): OandaCandle => ({
  time: new Date(Date.UTC(2026, 0, 1 + index, 22)).toISOString(),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  isClosed: true,
  volume: null,
  instrument: 'NAS100_USD',
  timeframe: 'D',
  source: 'oanda-v20',
});

const providerFor = (candles: OandaCandle[]): OandaProvider =>
  ({
    getDailyCandles: async () => ({
      provider: 'oanda-v20',
      environment: 'practice',
      instrument: 'NAS100_USD',
      timeframe: 'D',
      candles,
    }),
    getH4Candles: async () => ({
      provider: 'oanda-v20',
      environment: 'practice',
      instrument: 'NAS100_USD',
      timeframe: 'H4',
      candles: [],
    }),
  }) as unknown as OandaProvider;

describe('scheduler mean-reversion evaluation dedup', () => {
  it('evaluates a completed bar exactly once across consecutive scheduler slots', async () => {
    const repository = createRepository();
    const saved = repository.saveStrategyConfig('mr-strategy', 1, {
      name: 'Double7 D1',
      parameters,
    });
    repository.activateStrategyVersion('mr-strategy', 1);

    const candles = Array.from({ length: 10 }, (_, index) => dailyCandle(index, 100 + index));

    // First slot after the bar completes: persisted and returned (eligible for notification).
    const first = await evaluateActiveMeanReversionStrategies(
      repository,
      providerFor(candles),
      'NAS100_USD',
      null,
    );
    expect(first).toHaveLength(1);
    expect(first[0]!.referenceCandleTime).toBe(candles.at(-1)!.time);

    // The daily bar is unchanged on the next five slots of the same day: nothing new is
    // persisted and nothing is returned, so no repeat OS notification can fire.
    const second = await evaluateActiveMeanReversionStrategies(
      repository,
      providerFor(candles),
      'NAS100_USD',
      null,
    );
    expect(second).toHaveLength(0);
    expect(repository.listMeanReversionEvaluations(saved.id)).toHaveLength(1);

    // A new completed bar is evaluated (and persisted) again.
    const extended = [...candles, dailyCandle(10, 111)];
    const third = await evaluateActiveMeanReversionStrategies(
      repository,
      providerFor(extended),
      'NAS100_USD',
      null,
    );
    expect(third).toHaveLength(1);
    expect(third[0]!.referenceCandleTime).toBe(extended.at(-1)!.time);
    expect(repository.listMeanReversionEvaluations(saved.id)).toHaveLength(2);

    repository.close();
  });
});
