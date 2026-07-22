import currentAnalysis from '../../mock/current-analysis.json';
import currentCandleDataset from '../../mock/nas100-h4-candles.json';

import type { Action } from './analysis';

type FixtureOverrides = Record<string, unknown>;

const cloneCurrent = (): Record<string, unknown> => structuredClone(currentAnalysis);

const createFixture = (overrides: FixtureOverrides): unknown => {
  const base = cloneCurrent();
  const score = typeof overrides.score === 'number' ? overrides.score : currentAnalysis.score;

  return {
    ...base,
    ...overrides,
    setupScoreBreakdown: {
      ...currentAnalysis.setupScoreBreakdown,
      total: score,
    },
  };
};

export const currentAnalysisSource: unknown = currentAnalysis;
export const currentCandleDatasetSource: unknown = currentCandleDataset;

export const openCandleDatasetFixture: unknown = {
  ...structuredClone(currentCandleDataset),
  datasetId: 'nas100-h4-synthetic-open-candle',
  candles: currentCandleDataset.candles.map((candle, index) => ({
    ...candle,
    isClosed: index === currentCandleDataset.candles.length - 1 ? false : candle.isClosed,
  })),
};

export const invalidCandleDatasetFixture: unknown = {
  ...structuredClone(currentCandleDataset),
  datasetId: 'nas100-h4-synthetic-invalid-ohlc',
  candles: currentCandleDataset.candles.map((candle, index) =>
    index === 12 ? { ...candle, high: candle.low - 10 } : candle,
  ),
};

export const actionFixtures: Record<Action, unknown> = {
  BUY: createFixture({
    id: 'fixture-buy',
    action: 'BUY',
    status: 'SETUP_CONFIRMED',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'COMPLETED',
    score: 86,
    grade: 'A',
    reason: 'Completed H4 confirmation is present at the preferred pullback zone.',
  }),
  SELL: createFixture({
    id: 'fixture-sell',
    action: 'SELL',
    status: 'SETUP_CONFIRMED',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'COMPLETED',
    score: 82,
    grade: 'A',
    reason: 'Completed H4 confirmation is present below the invalidation level.',
  }),
  WAIT: createFixture({
    id: 'fixture-wait',
    action: 'WAIT',
    status: 'SETUP_FORMING',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'COMPLETED',
  }),
  NO_TRADE: createFixture({
    id: 'fixture-no-trade',
    action: 'NO_TRADE',
    status: 'BLOCKED',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'COMPLETED',
    score: 48,
    grade: 'D',
  }),
  WAIT_FOR_PULLBACK: createFixture({
    id: 'fixture-wait-pullback',
    action: 'WAIT_FOR_PULLBACK',
    status: 'SETUP_FORMING',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'COMPLETED',
  }),
  WAIT_FOR_NEXT_4H_CLOSE: createFixture({
    id: 'fixture-next-close',
    action: 'WAIT_FOR_NEXT_4H_CLOSE',
    status: 'AWAITING_CANDLE_CLOSE',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'OPEN',
  }),
};

export const openCandleFixture = createFixture({
  id: 'fixture-open-candle-buy-blocked',
  action: 'BUY',
  status: 'SETUP_CONFIRMED',
  dataFreshness: 'FRESH',
  latestCandleStatus: 'OPEN',
  dataHealth: {
    ...currentAnalysis.dataHealth,
    latestCandleClosed: false,
  },
});

export const staleDataFixture = createFixture({
  id: 'fixture-stale-data',
  action: 'BUY',
  status: 'SETUP_CONFIRMED',
  dataFreshness: 'STALE',
  latestCandleStatus: 'COMPLETED',
  dataHealth: {
    ...currentAnalysis.dataHealth,
    status: 'STALE',
  },
});

export const staleSellFixture = createFixture({
  id: 'fixture-stale-sell',
  action: 'SELL',
  status: 'SETUP_CONFIRMED',
  dataFreshness: 'STALE',
  latestCandleStatus: 'COMPLETED',
});

export const lowRewardRiskFixture = createFixture({
  id: 'fixture-low-reward-risk',
  action: 'BUY',
  status: 'SETUP_CONFIRMED',
  dataFreshness: 'FRESH',
  latestCandleStatus: 'COMPLETED',
  estimatedRR: 1.99,
});

export const invalidDataHealthFixture = createFixture({
  id: 'fixture-invalid-data-health',
  action: 'BUY',
  status: 'SETUP_CONFIRMED',
  dataFreshness: 'FRESH',
  latestCandleStatus: 'COMPLETED',
  dataHealth: {
    ...currentAnalysis.dataHealth,
    status: 'INVALID',
    validationErrors: ['Synthetic invalid data-health fixture.'],
  },
});

export const missingEventRiskFixture = (() => {
  const fixture = createFixture({
    id: 'fixture-missing-event-risk',
    action: 'BUY',
    status: 'SETUP_CONFIRMED',
    dataFreshness: 'FRESH',
    latestCandleStatus: 'COMPLETED',
  }) as Record<string, unknown>;
  delete fixture.eventRisk;
  return fixture;
})();

export const unsupportedVersionFixture = {
  ...cloneCurrent(),
  schemaVersion: '2.0.0',
};

export const missingNarrativeFixture = (() => {
  const fixture = cloneCurrent();
  delete fixture.reason;
  delete fixture.whyNoEntry;
  delete fixture.whatToDoNext;
  delete fixture.marketContext;
  return fixture;
})();

export const invalidAnalysisFixture: unknown = {
  schemaVersion: '1.0.0',
  id: 'fixture-invalid',
  action: 'BUY',
  score: 'not-a-number',
};
