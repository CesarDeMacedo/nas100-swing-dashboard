import { buildDashboardState } from '../../src/application/buildDashboardState';
import { buildTechnicalContext } from '../../src/domain/technicalContext';
import { calculateTradePlan, tradePlanToPatienceInputs } from '../../src/domain/tradePlan';
import {
  evaluatePatienceFilter,
  type CrossMarketInput,
  type EventRiskState,
} from '../../src/domain/patienceFilter';
import { decideStrategy } from '../../src/domain/strategyDecision';
import { calculateSetupScore } from '../../src/domain/setupScore';
import { resolveStrategyParameters } from '../../src/domain/strategyParameters';
import {
  AnalysisRepository,
  defaultPersistencePath,
} from '../../src/persistence/analysisRepository';
import type {
  OandaCandleGranularity,
  OandaCandleResult,
  OandaH4CandleResult,
} from '../../src/providers/oanda/types';
import {
  buildOandaMultiTimeframeInputs,
  CROSS_MARKET_OANDA_SYMBOLS,
  type CrossMarketH4Results,
} from '../../src/service/oandaRun';
import { loadProjectEnvironmentForServiceCli } from '../../src/service/server';
import { loadCache } from './oandaHistoricalBackfill';
import { generateReplayFrames, type FullHistoricalDataset } from './replayEngine';

/** The 5 named checks whose simultaneous pass is required for `PatienceFilterResult.status ===
 * 'allowed'` (see patienceFilter.ts). Mirrors buildDashboardState's internals instead of calling
 * it directly, purely to get access to the selected direction's PatienceFilterResult — which
 * DashboardState discards after collapsing it into isActionable/warnings. */
const GATE_CHECKS = [
  'minimum_reward_to_risk',
  'entry_location_acceptable',
  'confirmation_candle_valid',
  'primary_cross_market_confirmation',
  'event_risk_clear',
] as const;
const confirmation = (value: string) =>
  value === 'CONFIRMING'
    ? 'confirming'
    : value === 'CONTRADICTING'
      ? 'contradicting'
      : value === 'UNAVAILABLE'
        ? 'unknown'
        : 'neutral';
/** Mirrors tradePlan.ts's private `candlePosition` — not exported, so reproduced here verbatim
 * (close position within the candle's own high/low range, 0 = closed at the low, 1 = closed at
 * the high) to inspect the raw value the >=0.6 (long) / <=0.4 (short) confirmation bar tests. */
const candlePosition = (candle: { high: number; low: number; close: number }) =>
  candle.high === candle.low ? 0.5 : (candle.close - candle.low) / (candle.high - candle.low);
/** Mirrors tradePlan.ts's private `boundary` derivation (not exported): the nearest relevant
 * zone's far edge in the confirmation direction, falling back to the EMA20/EMA21 extreme when no
 * zone is near. `nearZone` itself mirrors tradePlan.ts's own selection (a zone containing the
 * current price, else the closest zone within ATR*tolerance). */
const findNearZone = (
  zones: { low: number; high: number }[],
  currentPrice: number,
  atr: number,
  tolerance: number,
) =>
  zones.find((zone) => currentPrice >= zone.low && currentPrice <= zone.high) ??
  zones.find(
    (zone) =>
      Math.min(Math.abs(currentPrice - zone.low), Math.abs(currentPrice - zone.high)) <=
      atr * tolerance,
  );

function requireCachedSeries<TTimeframe extends OandaCandleGranularity>(
  instrument: string,
  timeframe: TTimeframe,
): OandaCandleResult<TTimeframe> {
  const cached = loadCache(instrument, timeframe);
  if (!cached) throw new Error(`No cached ${timeframe} candles for ${instrument}.`);
  return {
    provider: 'oanda-v20',
    environment: 'practice',
    instrument,
    timeframe,
    candles: cached.candles as OandaCandleResult<TTimeframe>['candles'],
  };
}

function loadCachedCrossMarketH4(symbol: string): OandaH4CandleResult | undefined {
  const cached = loadCache(symbol, 'H4');
  return cached
    ? {
        provider: 'oanda-v20',
        environment: 'practice',
        instrument: symbol,
        timeframe: 'H4',
        candles: cached.candles as OandaH4CandleResult['candles'],
      }
    : undefined;
}

const bucket = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const printBucket = (title: string, map: Map<string, number>) => {
  console.log(`\n${title}`);
  for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${key}: ${count}`);
};

async function main() {
  loadProjectEnvironmentForServiceCli();
  const args: Record<string, string> = {};
  for (let i = 0; i < process.argv.length; i += 1) {
    const token = process.argv[i];
    if (token?.startsWith('--')) {
      args[token.slice(2)] = process.argv[i + 1] ?? '';
      i += 1;
    }
  }
  const strategyConfigId = args.strategy;
  const instrument = args.instrument;
  const rangeStart = args.from ? new Date(args.from).toISOString() : '0000-01-01T00:00:00.000Z';
  const rangeEnd = args.to ? new Date(args.to).toISOString() : '9999-12-31T23:59:59.999Z';
  if (!strategyConfigId || !instrument)
    throw new Error('--strategy and --instrument are required.');

  const analysisRepository = new AnalysisRepository(
    process.env.NAS100_DASHBOARD_DB_PATH ?? defaultPersistencePath(),
  );
  const strategy = analysisRepository.getStrategyConfigById(strategyConfigId);
  if (!strategy) throw new Error(`Strategy config ${strategyConfigId} was not found.`);
  const params = resolveStrategyParameters(strategy.parameters);
  analysisRepository.close();

  const full: FullHistoricalDataset = {
    h4: requireCachedSeries(instrument, 'H4'),
    daily: requireCachedSeries(instrument, 'D'),
    crossMarketH4: Object.fromEntries(
      (
        Object.entries(CROSS_MARKET_OANDA_SYMBOLS) as [
          keyof typeof CROSS_MARKET_OANDA_SYMBOLS,
          string,
        ][]
      ).map(([key, symbol]) => [key, loadCachedCrossMarketH4(symbol)]),
    ) as CrossMarketH4Results,
  };

  let frameCount = 0;
  const actionDist = new Map<string, number>();
  const premiumStateDist = new Map<string, number>();
  const waitingReasonDist = new Map<string, number>();
  const crossMarketConfirmDist = new Map<string, number>();
  const scoreBuckets = new Map<string, number>();
  const rrBuckets = new Map<string, number>();
  let actionableCount = 0;
  let crossMarketAllUnavailableFrames = 0;
  let eligibleCount = 0; // score >= premiumScoreThreshold
  let eligibleAndActionableCount = 0; // of those, how many also had action BUY/SELL
  const gateFailCounts = new Map<string, number>(GATE_CHECKS.map((g) => [g, 0]));
  const gateFailCombinationDist = new Map<string, number>(); // which gates failed together, among eligible frames
  // Conditional funnel over ALL frames in range (the score threshold never gates signal
  // generation, so restricting the funnel to score-eligible frames hides the true binding
  // constraint): per-gate fail counts, the exact fail-combination distribution (combinations of
  // size 1 are the "4-of-5 passed, this one was the last blocker" frames), and — on frames where
  // the two geometric gates (location + confirmation) BOTH passed — the planned R:R and whether
  // targets[0] was a structural level or the synthetic 2R fallback. Hypothesis under test: the
  // R:R distribution on those frames has its passing mass at exactly 2.0 (synthetic), meaning
  // structural target geometry almost never clears the >=2.0 floor on its own.
  const gateFailCountsAll = new Map<string, number>(GATE_CHECKS.map((g) => [g, 0]));
  const gateFailCombinationDistAll = new Map<string, number>();
  const rrWhenGeometryPassed: { rr: number | null; targetSource: string }[] = [];
  const targetSourceDistAll = new Map<string, number>(); // every frame with a non-empty target list
  const rrGateFailValues: number[] = []; // actual (non-null) estimatedRewardRisk on frames that failed minimum_reward_to_risk
  let rrGateFailNullCount = 0; // of the frames that failed that gate, how many failed because RR was null (not because it was a low number)
  const nullRrSamples: unknown[] = []; // first few raw records where estimatedRewardRisk was null, for manual inspection
  // Among eligible frames whose selected direction's confirmationStatus is 'missing' (candle
  // closed, not structurally invalidated, but didn't confirm): the raw candlePosition, normalized
  // to the favorable direction (long: as-is: 1=closed at high; short: 1-position: 1=closed at
  // low) so both directions compare against the same ">=0.6 required" bar on one scale. Also
  // tracked separately: whether the directional close (close>open for long / close<open for
  // short) independently held, since a low position value could still coincide with the wrong
  // direction of close entirely.
  const confirmationMissingPositions: number[] = [];
  let missingDirectionOkCount = 0;
  let missingBoundaryOkCount = 0;
  let missingTotalCount = 0;

  for (const frame of generateReplayFrames(full)) {
    if (frame.simulatedNowIso < rangeStart || frame.simulatedNowIso > rangeEnd) continue;
    frameCount += 1;

    const inputs = buildOandaMultiTimeframeInputs(
      frame.h4Source,
      frame.dailySource,
      frame.simulatedNowIso,
      frame.crossMarketH4,
      [],
    );
    const state = buildDashboardState(
      inputs.analysis,
      inputs.candles,
      inputs.technicalContext,
      params,
    );

    bucket(actionDist, state.action);
    if (state.isActionable) actionableCount += 1;
    const eligible = state.score !== null && state.score >= params.premiumScoreThreshold;
    if (eligible) {
      eligibleCount += 1;
      if (state.isActionable) eligibleAndActionableCount += 1;
    }

    {
      // Recompute the same internals buildDashboardState runs, purely to reach the selected
      // direction's PatienceFilterResult.passedChecks (not exposed on DashboardState itself).
      // Runs on EVERY frame in range — the all-frames funnel needs it; the historical
      // eligible-only diagnostics below still filter on `eligible`.
      const technicalContext =
        inputs.technicalContext ?? buildTechnicalContext(inputs.candles.candles);
      const latestCandle = inputs.candles.candles.at(-1) ?? null;
      const longPlan = calculateTradePlan(
        {
          direction: 'long',
          technicalContext,
          latestCandle,
          preferredEntryZone: inputs.analysis.preferredEntryZone,
          supportZones: inputs.analysis.supportZones,
          resistanceZones: inputs.analysis.resistanceZones,
        },
        params,
      );
      const shortPlan = calculateTradePlan(
        {
          direction: 'short',
          technicalContext,
          latestCandle,
          preferredEntryZone: inputs.analysis.preferredEntryZone,
          supportZones: inputs.analysis.supportZones,
          resistanceZones: inputs.analysis.resistanceZones,
        },
        params,
      );
      const crossMarket: CrossMarketInput = {
        us500: {
          long: confirmation(inputs.analysis.crossMarket.us500.confirmation),
          short: confirmation(inputs.analysis.crossMarket.us500.confirmation),
        },
        us30: {
          long: confirmation(inputs.analysis.crossMarket.us30.confirmation),
          short: confirmation(inputs.analysis.crossMarket.us30.confirmation),
        },
        russell2000: {
          long: confirmation(inputs.analysis.crossMarket.russell2000.confirmation),
          short: confirmation(inputs.analysis.crossMarket.russell2000.confirmation),
        },
      };
      const eventRisk: EventRiskState = inputs.analysis.eventRisk.some((event) => event.blocksEntry)
        ? 'blocking'
        : inputs.analysis.eventRisk.every((event) => event.status === 'AVAILABLE')
          ? 'clear'
          : 'unknown';
      const longPatience = evaluatePatienceFilter(
        'long',
        {
          technicalContext,
          dataFreshness: inputs.analysis.dataFreshness,
          providerStatus: inputs.analysis.dataHealth.providerStatus,
          eventRisk,
          crossMarket,
          ...tradePlanToPatienceInputs(longPlan),
        },
        params,
      );
      const shortPatience = evaluatePatienceFilter(
        'short',
        {
          technicalContext,
          dataFreshness: inputs.analysis.dataFreshness,
          providerStatus: inputs.analysis.dataHealth.providerStatus,
          eventRisk,
          crossMarket,
          ...tradePlanToPatienceInputs(shortPlan),
        },
        params,
      );
      const decision = decideStrategy(
        { technicalContext, longPlan, shortPlan, longPatience, shortPatience },
        params,
      );
      const longScore = calculateSetupScore(
        {
          direction: 'long',
          technicalContext,
          tradePlan: longPlan,
          patienceFilter: longPatience,
          crossMarket,
          eventRisk,
        },
        params,
      );
      const shortScore = calculateSetupScore(
        {
          direction: 'short',
          technicalContext,
          tradePlan: shortPlan,
          patienceFilter: shortPatience,
          crossMarket,
          eventRisk,
        },
        params,
      );
      const biasDirection = decision.bias.startsWith('bullish')
        ? 'long'
        : decision.bias.startsWith('bearish')
          ? 'short'
          : 'none';
      const direction =
        decision.direction !== 'none'
          ? decision.direction
          : decision.action === 'WAIT' && biasDirection !== 'none'
            ? biasDirection
            : longScore.total >= shortScore.total
              ? 'long'
              : 'short';
      const selectedPatience = direction === 'long' ? longPatience : shortPatience;
      const selectedPlan = direction === 'long' ? longPlan : shortPlan;

      const failedGates = GATE_CHECKS.filter(
        (gate) => !selectedPatience.passedChecks.includes(gate),
      );

      for (const gate of failedGates)
        gateFailCountsAll.set(gate, (gateFailCountsAll.get(gate) ?? 0) + 1);
      bucket(
        gateFailCombinationDistAll,
        failedGates.length === 0 ? '(none — all 5 gates passed)' : failedGates.join(' + '),
      );
      if (selectedPlan.targets.length > 0) bucket(targetSourceDistAll, selectedPlan.targetSource);
      if (
        !failedGates.includes('entry_location_acceptable') &&
        !failedGates.includes('confirmation_candle_valid')
      ) {
        rrWhenGeometryPassed.push({
          rr: selectedPlan.estimatedRewardRisk,
          targetSource: selectedPlan.targetSource,
        });
      }

      if (eligible) {
        for (const gate of failedGates)
          gateFailCounts.set(gate, (gateFailCounts.get(gate) ?? 0) + 1);
        bucket(
          gateFailCombinationDist,
          failedGates.length === 0
            ? '(none — should have been actionable)'
            : failedGates.join(' + '),
        );

        if (failedGates.includes('minimum_reward_to_risk')) {
          if (selectedPlan.estimatedRewardRisk === null) {
            rrGateFailNullCount += 1;
            if (nullRrSamples.length < 5) {
              nullRrSamples.push({
                frameTime: frame.simulatedNowIso,
                direction,
                entryPrice: selectedPlan.entryPrice,
                stopPrice: selectedPlan.stopPrice,
                invalidationPrice: selectedPlan.invalidationPrice,
                targets: selectedPlan.targets,
                locationStatus: selectedPlan.locationStatus,
                confirmationStatus: selectedPlan.confirmationStatus,
                structurallyInvalidated: selectedPlan.structurallyInvalidated,
                missingInputs: selectedPlan.missingInputs,
                atrUsed: selectedPlan.atrUsed,
                recentSwingLow: technicalContext.h4Structure.recentSwingLow,
                recentSwingHigh: technicalContext.h4Structure.recentSwingHigh,
                supportZones: inputs.analysis.supportZones,
                resistanceZones: inputs.analysis.resistanceZones,
                preferredEntryZone: inputs.analysis.preferredEntryZone,
              });
            }
          } else rrGateFailValues.push(selectedPlan.estimatedRewardRisk);
        }

        if (selectedPlan.confirmationStatus === 'missing' && latestCandle) {
          missingTotalCount += 1;
          const position = candlePosition(latestCandle);
          const normalizedPosition = direction === 'long' ? position : 1 - position;
          confirmationMissingPositions.push(normalizedPosition);
          const directionOk =
            direction === 'long'
              ? latestCandle.close > latestCandle.open
              : latestCandle.close < latestCandle.open;
          if (directionOk) missingDirectionOkCount += 1;

          const atr = technicalContext.indicatorSnapshot.atr14.value;
          const ema20 = technicalContext.indicatorSnapshot.ema20.value;
          const ema21 = technicalContext.indicatorSnapshot.ema21.value;
          if (atr !== null && ema20 !== null && ema21 !== null) {
            const zones =
              direction === 'long'
                ? [inputs.analysis.preferredEntryZone, ...inputs.analysis.supportZones].filter(
                    (z): z is NonNullable<typeof z> => Boolean(z),
                  )
                : [inputs.analysis.preferredEntryZone, ...inputs.analysis.resistanceZones].filter(
                    (z): z is NonNullable<typeof z> => Boolean(z),
                  );
            const nearZone = findNearZone(
              zones,
              latestCandle.close,
              atr,
              params.atrLocationTolerance,
            );
            const boundary =
              direction === 'long'
                ? (nearZone?.high ?? Math.max(ema20, ema21))
                : (nearZone?.low ?? Math.min(ema20, ema21));
            const boundaryOk =
              direction === 'long'
                ? latestCandle.close >= boundary
                : latestCandle.close <= boundary;
            if (boundaryOk) missingBoundaryOkCount += 1;
          }
        }
      }
    }

    const cm = inputs.analysis.crossMarket;
    const cmStatuses = [cm.us500.confirmation, cm.us30.confirmation, cm.russell2000.confirmation];
    for (const s of cmStatuses) bucket(crossMarketConfirmDist, s);
    if (cmStatuses.every((s) => s === 'UNAVAILABLE')) crossMarketAllUnavailableFrames += 1;

    const scoreBand =
      state.score === null
        ? 'null'
        : `${Math.floor(state.score / 10) * 10}-${Math.floor(state.score / 10) * 10 + 9}`;
    bucket(scoreBuckets, scoreBand);
    bucket(premiumStateDist, state.premiumSetupState);

    const rr = state.estimatedRewardRisk;
    const rrBand =
      rr === null
        ? 'null'
        : rr < 1
          ? '<1.0'
          : rr < 1.5
            ? '1.0-1.5'
            : rr < 2.0
              ? '1.5-2.0'
              : rr < 2.5
                ? '2.0-2.5'
                : '>=2.5';
    bucket(rrBuckets, rrBand);

    for (const w of state.warnings) bucket(waitingReasonDist, w);
  }

  console.log(`Frames in range: ${frameCount}`);
  console.log(`isActionable=true: ${actionableCount}`);
  console.log(
    `score >= premiumScoreThreshold (${params.premiumScoreThreshold}): ${eligibleCount} (${((eligibleCount / frameCount) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  of those, also isActionable (all 5 gates coincided): ${eligibleAndActionableCount} (${eligibleCount === 0 ? 'n/a' : ((eligibleAndActionableCount / eligibleCount) * 100).toFixed(1) + '%'})`,
  );
  console.log(
    `Frames where ALL cross-market instruments were UNAVAILABLE: ${crossMarketAllUnavailableFrames}`,
  );
  console.log(
    `\nAmong eligible (score >= threshold) frames, how often each gate individually failed (not mutually exclusive — a frame can fail multiple):`,
  );
  for (const gate of GATE_CHECKS) {
    const failed = gateFailCounts.get(gate) ?? 0;
    console.log(
      `  ${gate}: failed in ${failed}/${eligibleCount} (${eligibleCount === 0 ? 'n/a' : ((failed / eligibleCount) * 100).toFixed(1) + '%'})`,
    );
  }
  printBucket(
    'exact combination of gates that failed together, among eligible frames',
    gateFailCombinationDist,
  );

  console.log(
    `\n=== Conditional funnel over ALL ${frameCount} frames in range (score threshold ignored — it never gates signals) ===`,
  );
  console.log('How often each gate individually failed:');
  for (const gate of GATE_CHECKS) {
    const failed = gateFailCountsAll.get(gate) ?? 0;
    console.log(
      `  ${gate}: failed in ${failed}/${frameCount} (${frameCount === 0 ? 'n/a' : ((failed / frameCount) * 100).toFixed(1) + '%'})`,
    );
  }
  printBucket(
    'exact combination of gates that failed together (size-1 rows = "4 of 5 passed, this was the last blocker")',
    gateFailCombinationDistAll,
  );
  printBucket(
    'targetSource across all frames with a non-empty target list (synthetic = 2R fallback set targets[0])',
    targetSourceDistAll,
  );

  const geometryPassedCount = rrWhenGeometryPassed.length;
  console.log(
    `\nFrames where BOTH geometric gates passed (entry_location + confirmation_candle): ${geometryPassedCount}`,
  );
  if (geometryPassedCount > 0) {
    const nullRr = rrWhenGeometryPassed.filter((entry) => entry.rr === null).length;
    console.log(`  estimatedRewardRisk null: ${nullRr}`);
    const bySource = new Map<string, number>();
    for (const entry of rrWhenGeometryPassed) bucket(bySource, entry.targetSource);
    printBucket('  targetSource on those frames', bySource);
    const values = rrWhenGeometryPassed.filter((entry) => entry.rr !== null) as {
      rr: number;
      targetSource: string;
    }[];
    if (values.length > 0) {
      const fineBuckets = new Map<string, number>();
      for (const entry of values) {
        // R:R within float noise of exactly 2.0 is its own bin: it is the fingerprint of the
        // synthetic 2R fallback target rather than a structural level happening to sit at 2R.
        const label =
          Math.abs(entry.rr - 2) < 1e-6
            ? `exactly 2.0 (${entry.targetSource})`
            : (Math.floor(entry.rr * 10) / 10).toFixed(1);
        bucket(fineBuckets, label);
      }
      printBucket(
        '  planned R:R distribution on those frames (0.1 bins; the >=2.0 floor decides pass/fail)',
        fineBuckets,
      );
      const passing = values.filter((entry) => entry.rr >= params.minRewardRisk);
      const passingStructural = passing.filter(
        (entry) => entry.targetSource === 'structural',
      ).length;
      console.log(
        `  of ${values.length} with computable R:R, ${passing.length} cleared the ${params.minRewardRisk.toFixed(1)} floor — ${passingStructural} structural, ${passing.length - passingStructural} synthetic`,
      );
    }
  }

  console.log('\nRaw samples where estimatedRewardRisk was null (first 5 encountered):');
  console.log(JSON.stringify(nullRrSamples, null, 2));

  console.log(
    `\nOf the ${gateFailCounts.get('minimum_reward_to_risk') ?? 0} eligible frames that failed minimum_reward_to_risk:`,
  );
  console.log(
    `  estimatedRewardRisk was null (plan never reached a computable R:R): ${rrGateFailNullCount}`,
  );
  console.log(
    `  estimatedRewardRisk was a real number below ${params.minRewardRisk.toFixed(1)}: ${rrGateFailValues.length}`,
  );
  if (rrGateFailValues.length > 0) {
    const sorted = [...rrGateFailValues].sort((a, b) => a - b);
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)]!;
    console.log(
      `  min=${sorted[0]!.toFixed(2)} median=${median.toFixed(2)} mean=${mean.toFixed(2)} max=${sorted.at(-1)!.toFixed(2)}`,
    );
    const fineBuckets = new Map<string, number>();
    for (const v of rrGateFailValues) {
      const bin = (Math.floor(v * 10) / 10).toFixed(1);
      bucket(fineBuckets, bin);
    }
    console.log('  fine distribution (0.1 bins):');
    for (const [bin, count] of [...fineBuckets.entries()].sort(
      (a, b) => Number(a[0]) - Number(b[0]),
    )) {
      console.log(`    ${bin}-${(Number(bin) + 0.1).toFixed(1)}: ${count}`);
    }
  }
  console.log(
    `\nOf the ${missingTotalCount} eligible frames where confirmationStatus was 'missing':`,
  );
  console.log(
    `  directional close held (close>open for long / close<open for short): ${missingDirectionOkCount} (${missingTotalCount === 0 ? 'n/a' : ((missingDirectionOkCount / missingTotalCount) * 100).toFixed(1) + '%'})`,
  );
  console.log(
    `  boundary held (close beyond nearest zone/EMA boundary): ${missingBoundaryOkCount} (${missingTotalCount === 0 ? 'n/a' : ((missingBoundaryOkCount / missingTotalCount) * 100).toFixed(1) + '%'})`,
  );
  if (confirmationMissingPositions.length > 0) {
    const sorted = [...confirmationMissingPositions].sort((a, b) => a - b);
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)]!;
    console.log(
      `  normalized candlePosition (1.0 = closed at the favorable extreme; >=0.6 required to confirm): min=${sorted[0]!.toFixed(2)} median=${median.toFixed(2)} mean=${mean.toFixed(2)} max=${sorted.at(-1)!.toFixed(2)}`,
    );
    const fineBuckets = new Map<string, number>();
    for (const v of confirmationMissingPositions) {
      const bin = (Math.floor(v * 10) / 10).toFixed(1);
      bucket(fineBuckets, bin);
    }
    console.log('  fine distribution (0.1 bins):');
    for (const [bin, count] of [...fineBuckets.entries()].sort(
      (a, b) => Number(a[0]) - Number(b[0]),
    )) {
      console.log(`    ${bin}-${(Number(bin) + 0.1).toFixed(1)}: ${count}`);
    }
  }

  printBucket('action distribution', actionDist);
  printBucket('premiumSetupState distribution', premiumStateDist);
  printBucket('score band distribution (selectedScore)', scoreBuckets);
  printBucket('estimatedRewardRisk band distribution', rrBuckets);
  printBucket(
    'cross-market confirmation status distribution (all 3 instruments pooled)',
    crossMarketConfirmDist,
  );
  printBucket('warnings distribution (top blockers)', waitingReasonDist);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
