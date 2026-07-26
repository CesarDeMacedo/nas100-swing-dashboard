import { randomUUID } from 'node:crypto';

import { buildDashboardState } from '../../src/application/buildDashboardState';
import { resolveStrategyParameters } from '../../src/domain/strategyParameters';
import { AnalysisRepository, defaultPersistencePath } from '../../src/persistence/analysisRepository';
import type { OandaCandleGranularity, OandaCandleResult, OandaH4CandleResult } from '../../src/providers/oanda/types';
import { buildOandaMultiTimeframeInputs, CROSS_MARKET_OANDA_SYMBOLS, type CrossMarketH4Results } from '../../src/service/oandaRun';
import { loadProjectEnvironmentForServiceCli } from '../../src/service/server';
import { BacktestRepository, defaultBacktestDatabasePath } from './backtestRepository';
import { loadCache } from './oandaHistoricalBackfill';
import { generateReplayFrames, type FullHistoricalDataset } from './replayEngine';
import { evaluateSignalOutcome, localHourAndWeekday } from './signalOutcome';

const parseArgs = (argv: string[]) => {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token?.startsWith('--')) {
      args[token.slice(2)] = argv[i + 1] ?? '';
      i += 1;
    }
  }
  return args;
};

function requireCachedSeries<TTimeframe extends OandaCandleGranularity>(instrument: string, timeframe: TTimeframe): OandaCandleResult<TTimeframe> {
  const cached = loadCache(instrument, timeframe);
  if (!cached) throw new Error(`No cached ${timeframe} candles for ${instrument} — run oandaHistoricalBackfill.ts first.`);
  return { provider: 'oanda-v20', environment: 'practice', instrument, timeframe, candles: cached.candles as OandaCandleResult<TTimeframe>['candles'] };
}

function loadCachedCrossMarketH4(symbol: string): OandaH4CandleResult | undefined {
  const cached = loadCache(symbol, 'H4');
  return cached ? { provider: 'oanda-v20', environment: 'practice', instrument: symbol, timeframe: 'H4', candles: cached.candles as OandaH4CandleResult['candles'] } : undefined;
}

export async function runBacktest(options: { strategyConfigId: string; instrument: string; rangeStart: string; rangeEnd: string }) {
  const analysisRepository = new AnalysisRepository(process.env.NAS100_DASHBOARD_DB_PATH ?? defaultPersistencePath());
  const strategy = analysisRepository.getStrategyConfigById(options.strategyConfigId);
  if (!strategy) {
    analysisRepository.close();
    throw new Error(`Strategy config ${options.strategyConfigId} was not found.`);
  }
  const params = resolveStrategyParameters(strategy.parameters);
  analysisRepository.close();

  const full: FullHistoricalDataset = {
    h4: requireCachedSeries(options.instrument, 'H4'),
    daily: requireCachedSeries(options.instrument, 'D'),
    crossMarketH4: Object.fromEntries(
      (Object.entries(CROSS_MARKET_OANDA_SYMBOLS) as [keyof typeof CROSS_MARKET_OANDA_SYMBOLS, string][])
        .map(([key, symbol]) => [key, loadCachedCrossMarketH4(symbol)]),
    ) as CrossMarketH4Results,
  };

  const closedH4 = full.h4.candles.filter((candle) => candle.isClosed);
  const timeToIndex = new Map(closedH4.map((candle, index) => [candle.time, index]));

  const backtestRepository = new BacktestRepository(process.env.NAS100_BACKTEST_DB_PATH ?? defaultBacktestDatabasePath());
  const run = backtestRepository.createRun({
    id: randomUUID(),
    strategyConfigId: options.strategyConfigId,
    instrument: options.instrument,
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
  });

  let frameCount = 0;
  try {
    for (const frame of generateReplayFrames(full)) {
      if (frame.simulatedNowIso < options.rangeStart || frame.simulatedNowIso > options.rangeEnd) continue;
      frameCount += 1;

      const inputs = buildOandaMultiTimeframeInputs(frame.h4Source, frame.dailySource, frame.simulatedNowIso, frame.crossMarketH4, []);
      const state = buildDashboardState(inputs.analysis, inputs.candles, inputs.technicalContext, params);

      if (!state.isActionable || (state.action !== 'BUY' && state.action !== 'SELL')) continue;
      if (state.direction !== 'long' && state.direction !== 'short') continue;
      if (state.entryPrice === null || state.invalidationPrice === null || state.stopPrice === null || state.targets.length === 0 || state.estimatedRewardRisk === null) continue;

      const decisionIndex = timeToIndex.get(frame.simulatedNowIso);
      if (decisionIndex === undefined) continue;
      const candlesAfterDecision = closedH4.slice(decisionIndex + 1);
      const outcome = evaluateSignalOutcome(candlesAfterDecision, state.direction, state.entryPrice, state.invalidationPrice, state.stopPrice, state.targets[0]!);
      const { hour, weekday } = localHourAndWeekday(frame.simulatedNowIso);

      backtestRepository.insertSignal({
        id: randomUUID(),
        backtestRunId: run.id,
        decisionCandleTime: frame.simulatedNowIso,
        direction: state.direction,
        entryPrice: state.entryPrice,
        invalidationPrice: state.invalidationPrice,
        stopPrice: state.stopPrice,
        targetPrice: state.targets[0]!,
        estimatedRewardRisk: state.estimatedRewardRisk,
        score: state.score,
        grade: state.grade,
        localHourOfDay: hour,
        localWeekday: weekday,
        status: outcome.status,
        filledAt: outcome.filledAt,
        resolvedAt: outcome.resolvedAt,
        outcomeRR: outcome.outcomeRR,
      });
    }
    backtestRepository.completeRun(run.id, frameCount);
  } catch (error) {
    backtestRepository.failRun(run.id, error instanceof Error ? error.message : 'Backtest failed.');
    backtestRepository.close();
    throw error;
  }

  backtestRepository.close();
  return { runId: run.id, frameCount };
}

async function main() {
  loadProjectEnvironmentForServiceCli();
  const args = parseArgs(process.argv.slice(2));
  if (!args.strategy) throw new Error('--strategy <strategyConfigId> is required.');
  if (!args.instrument) throw new Error('--instrument is required.');
  const rangeStart = args.from ? new Date(args.from).toISOString() : '0000-01-01T00:00:00.000Z';
  const rangeEnd = args.to ? new Date(args.to).toISOString() : '9999-12-31T23:59:59.999Z';

  const result = await runBacktest({ strategyConfigId: args.strategy, instrument: args.instrument, rangeStart, rangeEnd });
  console.log(`Backtest ${result.runId} completed: ${result.frameCount} frames evaluated.`);
}

if (process.argv[1]?.endsWith('runBacktest.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
