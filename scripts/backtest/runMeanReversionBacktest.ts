import { randomUUID } from 'node:crypto';

import {
  runMeanReversionBacktest,
  type MeanReversionParameters,
} from '../../src/domain/meanReversionStrategy';
import { resolveStrategyParameters } from '../../src/domain/strategyParameters';
import {
  AnalysisRepository,
  defaultPersistencePath,
} from '../../src/persistence/analysisRepository';
import { loadProjectEnvironmentForServiceCli } from '../../src/service/server';
import { BacktestRepository, defaultBacktestDatabasePath } from './backtestRepository';
import { loadCache } from './oandaHistoricalBackfill';

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

const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`);
const num = (value: number | null, digits = 2) => (value === null ? 'n/a' : value.toFixed(digits));

export async function runMeanReversion(options: {
  strategyConfigId: string;
  instrument: string;
  rangeStart: string;
  rangeEnd: string;
}) {
  const analysisRepository = new AnalysisRepository(
    process.env.NAS100_DASHBOARD_DB_PATH ?? defaultPersistencePath(),
  );
  const strategy = analysisRepository.getStrategyConfigById(options.strategyConfigId);
  analysisRepository.close();
  if (!strategy) throw new Error(`Strategy config ${options.strategyConfigId} was not found.`);

  const resolved = resolveStrategyParameters(strategy.parameters);
  if (resolved.strategyKind !== 'rsi2' && resolved.strategyKind !== 'double7') {
    throw new Error(
      `Strategy config ${options.strategyConfigId} has strategyKind '${resolved.strategyKind}' — this runner only handles 'rsi2'/'double7' (use runBacktest.ts for 'pipeline').`,
    );
  }
  const params: MeanReversionParameters = {
    kind: resolved.strategyKind,
    ...resolved.meanReversion,
  };

  const cached = loadCache(options.instrument, params.timeframe);
  if (!cached) {
    throw new Error(
      `No cached ${params.timeframe} candles for ${options.instrument} — run oandaHistoricalBackfill.ts first.`,
    );
  }
  const candles = cached.candles
    .filter((candle) => candle.isClosed)
    .map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));

  const backtestRepository = new BacktestRepository(
    process.env.NAS100_BACKTEST_DB_PATH ?? defaultBacktestDatabasePath(),
  );
  const run = backtestRepository.createRun({
    id: randomUUID(),
    strategyConfigId: options.strategyConfigId,
    instrument: options.instrument,
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
  });

  try {
    const { trades, summary } = runMeanReversionBacktest(candles, params, {
      rangeStart: options.rangeStart,
      rangeEnd: options.rangeEnd,
    });
    for (const trade of trades) {
      backtestRepository.insertMrTrade({ id: randomUUID(), backtestRunId: run.id, ...trade });
    }
    backtestRepository.completeRun(run.id, summary.evaluatedBars);
    backtestRepository.close();
    return { runId: run.id, params, trades, summary };
  } catch (error) {
    backtestRepository.failRun(run.id, error instanceof Error ? error.message : 'Backtest failed.');
    backtestRepository.close();
    throw error;
  }
}

async function main() {
  loadProjectEnvironmentForServiceCli();
  const args = parseArgs(process.argv.slice(2));
  if (!args.strategy) throw new Error('--strategy <strategyConfigId> is required.');
  if (!args.instrument) throw new Error('--instrument is required.');
  const rangeStart = args.from ? new Date(args.from).toISOString() : '0000-01-01T00:00:00.000Z';
  const rangeEnd = args.to ? new Date(args.to).toISOString() : '9999-12-31T23:59:59.999Z';

  const { runId, params, trades, summary } = await runMeanReversion({
    strategyConfigId: args.strategy,
    instrument: args.instrument,
    rangeStart,
    rangeEnd,
  });

  console.log(`Mean-reversion backtest ${runId} completed.`);
  console.log(
    `kind=${params.kind} timeframe=${params.timeframe} smaFilter=${params.smaFilterPeriod} ` +
      (params.kind === 'rsi2'
        ? `rsi(${params.rsiPeriod}) entry<${params.rsiEntryThreshold} exit>${params.rsiExitThreshold}`
        : `entry=${params.lookbackEntryLow}-bar closing low, exit=${params.lookbackExitHigh}-bar closing high`) +
      ` protectiveStop=${params.protectiveStopAtrMultiple === null ? 'none' : `${params.protectiveStopAtrMultiple}xATR(${params.atrPeriod})`}` +
      ` maxBarsHeld=${params.maxBarsHeld ?? 'none'}`,
  );
  console.log(
    `bars evaluated in range: ${summary.evaluatedBars} (series total: ${summary.totalBars})`,
  );
  console.log(
    `trades: ${summary.trades} closed (${summary.openAtEnd} open at end) | wins ${summary.wins} / losses ${summary.losses} | win rate ${pct(summary.winRate)}`,
  );
  console.log(
    `avg return/trade ${pct(summary.avgPctReturn)} | compounded ${pct(summary.compoundedPctReturn)} | profit factor ${num(summary.profitFactor)} | max DD ${pct(summary.maxDrawdownPct)}`,
  );
  console.log(
    `avg bars held ${num(summary.avgBarsHeld, 1)} | exposure ${pct(summary.exposure)} | avg ATR-multiple return ${num(summary.avgAtrMultipleReturn)}`,
  );
  console.log('\ntrades:');
  for (const trade of trades) {
    console.log(
      `  ${trade.entryTime} @ ${trade.entryPrice.toFixed(1)} -> ${trade.exitTime ?? '(open)'} @ ${trade.exitPrice?.toFixed(1) ?? 'n/a'}` +
        ` | ${trade.exitReason ?? 'open'} | bars ${trade.barsHeld ?? 'n/a'} | ${trade.pctReturn === null ? 'n/a' : pct(trade.pctReturn)}` +
        ` | atrMult ${num(trade.atrMultipleReturn)}`,
    );
  }
}

if (process.argv[1]?.endsWith('runMeanReversionBacktest.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
