import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell } from './components/AppShell';
import { Dashboard } from './components/Dashboard';
import { ErrorState, LoadingState } from './components/States';
import { currentAnalysisSource } from './domain/fixtures';
import { parseAnalysis } from './domain/analysis';
import { parseCandleDataset } from './domain/candles';
import { buildDashboardState } from './application/buildDashboardState';
import { currentCandleDatasetSource } from './domain/fixtures';
import { useDashboardStore } from './store/dashboardStore';
import {
  localAnalysisService,
  type BacktestListResult,
  type BacktestReportResult,
  type HistoryResult,
  type LocalAnalysisServiceClient,
  type ManualRunResult,
  type MrEvaluationsListResult,
  type OandaPreviewCandle,
  type OandaPreviewData,
  type OandaPreviewResult,
  type OandaProviderStatus,
  type RunDetailResult,
  type SavedOandaDisplaySnapshot,
  type ServiceAvailability,
  type StrategyDetailResult,
  type StrategyListResult,
  type StrategyMutationResult,
  type StrategyParameters,
} from './serviceClient/localAnalysisService';

const candleTime = (candle: unknown): string | null => {
  if (!candle || typeof candle !== 'object') return null;
  const time = (candle as { time?: unknown }).time;
  return typeof time === 'string' ? time : null;
};

/** Merges saved snapshot candles with any completed candles fetched to fill the gap
 * since the snapshot was taken, then appends the current live open candle. Dedupes
 * and sorts by time so out-of-order arrival (gap-fetch vs. live rollover) is safe. */
const mergeCandleSeries = (saved: unknown[], gap: unknown[], open: unknown | null) => {
  const byTime = new Map<string, unknown>();
  for (const candle of [...saved, ...gap]) {
    const time = candleTime(candle);
    if (time) byTime.set(time, candle);
  }
  const merged = [...byTime.values()].sort(
    (a, b) => Date.parse(candleTime(a) ?? '') - Date.parse(candleTime(b) ?? ''),
  );
  return open ? [...merged, open] : merged;
};

// Lazy-loaded so the ~500kB lightweight-charts dependency is not part of the initial bundle.
const OandaChartPreview = lazy(() =>
  import('./components/OandaChartPreview').then((module) => ({
    default: module.OandaChartPreview,
  })),
);

type AppProps = {
  analysisSource?: unknown;
  candleSource?: unknown;
  loading?: boolean;
  serviceClient?: LocalAnalysisServiceClient;
};

export default function App({
  analysisSource = currentAnalysisSource,
  candleSource = currentCandleDatasetSource,
  loading = false,
  serviceClient = localAnalysisService,
}: AppProps) {
  const result = useMemo(() => parseAnalysis(analysisSource), [analysisSource]);
  const candleResult = useMemo(() => parseCandleDataset(candleSource), [candleSource]);
  const dashboardState = useMemo(
    () =>
      result.success && candleResult.success
        ? buildDashboardState(result.analysis, candleResult.dataset)
        : null,
    [result, candleResult],
  );
  const useCalculatedDashboardState =
    analysisSource === currentAnalysisSource && candleSource === currentCandleDatasetSource;
  const dashboardAnalysis = result.success ? result.analysis : null;
  const setReady = useDashboardStore((state) => state.setReady);
  const setError = useDashboardStore((state) => state.setError);
  const [serviceAvailability, setServiceAvailability] = useState<
    'checking' | ServiceAvailability['kind']
  >('checking');
  const [manualRunState, setManualRunState] = useState<
    'idle' | 'running' | ManualRunResult['kind']
  >('idle');
  const [manualRunResult, setManualRunResult] = useState<ManualRunResult | null>(null);
  const [oandaManualRunState, setOandaManualRunState] = useState<
    'idle' | 'running' | ManualRunResult['kind']
  >('idle');
  const [oandaManualRunResult, setOandaManualRunResult] = useState<ManualRunResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryResult | { kind: 'loading' } | null>(null);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [historyDetail, setHistoryDetail] = useState<RunDetailResult | { kind: 'loading' } | null>(
    null,
  );
  const [selectedHistoryRunKey, setSelectedHistoryRunKey] = useState<string | null>(null);
  const [savedOandaSnapshot, setSavedOandaSnapshot] = useState<SavedOandaDisplaySnapshot | null>(
    null,
  );
  const [liveOpenCandle, setLiveOpenCandle] = useState<unknown>(null);
  const [gapCandles, setGapCandles] = useState<OandaPreviewCandle[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'live' | 'stale' | 'offline' | null>(
    null,
  );
  const [oandaPreview, setOandaPreview] = useState<OandaPreviewData | null>(null);
  const [oandaPreviewLoading, setOandaPreviewLoading] = useState(false);
  const [oandaPreviewError, setOandaPreviewError] = useState<string | null>(null);
  const [oandaStatus, setOandaStatus] = useState<'checking' | OandaProviderStatus | null>(null);
  const [strategiesOpen, setStrategiesOpen] = useState(false);
  const [strategyList, setStrategyList] = useState<StrategyListResult | { kind: 'loading' } | null>(
    null,
  );
  const [strategyDetail, setStrategyDetail] = useState<
    StrategyDetailResult | { kind: 'loading' } | null
  >(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [strategyCreateState, setStrategyCreateState] = useState<
    'idle' | 'running' | StrategyMutationResult['kind']
  >('idle');
  const [strategyCreateResult, setStrategyCreateResult] = useState<StrategyMutationResult | null>(
    null,
  );
  const [backtestsOpen, setBacktestsOpen] = useState(false);
  const [backtestList, setBacktestList] = useState<BacktestListResult | { kind: 'loading' } | null>(
    null,
  );
  const [backtestDetail, setBacktestDetail] = useState<
    BacktestReportResult | { kind: 'loading' } | null
  >(null);
  const [selectedBacktestId, setSelectedBacktestId] = useState<string | null>(null);
  const [mrEvaluationsOpen, setMrEvaluationsOpen] = useState(false);
  const [mrEvaluationsList, setMrEvaluationsList] = useState<
    MrEvaluationsListResult | { kind: 'loading' } | null
  >(null);
  const savedAnalysisResult = useMemo(
    () => (savedOandaSnapshot ? parseAnalysis(savedOandaSnapshot.analysis) : null),
    [savedOandaSnapshot],
  );
  const savedCandleResult = useMemo(
    () =>
      savedOandaSnapshot
        ? parseCandleDataset({
            schemaVersion: '1.0.0',
            datasetId: `saved-oanda:${savedOandaSnapshot.instrument}:${savedOandaSnapshot.h4SourceCandleTime ?? 'unavailable'}`,
            description: 'Saved immutable OANDA H4 analysis snapshot.',
            isSynthetic: false,
            timezone: 'America/Toronto',
            instrument: savedOandaSnapshot.instrument,
            timeframe: 'H4',
            candles: mergeCandleSeries(
              savedOandaSnapshot.candles as unknown[],
              gapCandles,
              liveOpenCandle,
            ),
          })
        : null,
    [savedOandaSnapshot, gapCandles, liveOpenCandle],
  );
  const activeAnalysis = savedOandaSnapshot
    ? savedAnalysisResult?.success
      ? savedAnalysisResult.analysis
      : null
    : dashboardAnalysis;
  const activeCandleResult = savedOandaSnapshot ? savedCandleResult! : candleResult;

  useEffect(() => {
    if (result.success) {
      setReady(result.analysis.id);
    } else {
      setError();
    }
  }, [result, setError, setReady]);

  useEffect(() => {
    let active = true;
    serviceClient.checkHealth().then((availability) => {
      if (active) setServiceAvailability(availability.kind);
    });
    return () => {
      active = false;
    };
  }, [serviceClient]);

  useEffect(() => {
    if (serviceAvailability !== 'available' || !serviceClient.checkOandaStatus) return;
    let active = true;
    setOandaStatus('checking');
    serviceClient.checkOandaStatus().then((status) => {
      if (active) setOandaStatus(status);
    });
    return () => {
      active = false;
    };
  }, [serviceAvailability, serviceClient]);

  // Unlike history/strategies/backtests (only loaded when their panel is opened), the latest
  // mean-reversion evaluation also feeds an always-visible sidebar card and chart overlay (see
  // MeanReversionStrategyCard, mapMeanReversionPriceLines) — so it needs to load as soon as the
  // service is available, not wait for the user to open the evaluation-history panel.
  useEffect(() => {
    if (serviceAvailability !== 'available' || !serviceClient.listMrEvaluations) return;
    let active = true;
    serviceClient.listMrEvaluations().then((result) => {
      if (active) setMrEvaluationsList(result);
    });
    return () => {
      active = false;
    };
  }, [serviceAvailability, serviceClient]);

  // On startup, show the most recently persisted OANDA report instead of mock, if one
  // exists — real data the user already has, no new OANDA API call. Falls back to mock
  // (unchanged default) when the service is unavailable or no OANDA report has ever been
  // saved. Runs once per session: attemptedAutoLoad guards against firing again if the
  // user later returns to mock manually (serviceAvailability can still re-trigger deps).
  const attemptedAutoLoad = useRef(false);
  useEffect(() => {
    if (serviceAvailability !== 'available' || attemptedAutoLoad.current) return;
    attemptedAutoLoad.current = true;
    let active = true;
    (async () => {
      const historyResult = await serviceClient.listRecentRuns(20);
      if (!active || historyResult.kind !== 'succeeded') return;
      const latestOandaRun = historyResult.runs.find(
        (item) => item.run.runKey.startsWith('oanda-v20:') && item.report !== null,
      );
      if (!latestOandaRun) return;
      const detail = await serviceClient.getRunByKey(latestOandaRun.run.runKey);
      if (!active || detail.kind !== 'succeeded' || !detail.report.displaySnapshot) return;
      viewSavedOandaAnalysis(detail.report.displaySnapshot);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceAvailability, serviceClient]);

  useEffect(() => {
    if (!savedOandaSnapshot || !serviceClient.getOandaCandles) {
      setGapCandles([]);
      return;
    }
    let active = true;
    setGapCandles([]);
    const lastSavedTime = savedOandaSnapshot.h4SourceCandleTime;
    const lastSavedMs = lastSavedTime ? Date.parse(lastSavedTime) : null;
    serviceClient.getOandaCandles(250).then((result) => {
      if (!active || result.kind !== 'succeeded') return;
      // Fills the gap between the saved (immutable) snapshot and now: H4 candles that
      // completed after the snapshot was taken but before this view was opened. The live
      // SSE stream only ever carries the currently-open candle, never a backfill, so
      // without this the chart jumps straight from the snapshot's last candle to
      // whatever's open now — silently skipping every candle that closed in between.
      const missing = result.data.candles.filter(
        (candle) =>
          candle.isClosed && (lastSavedMs === null || Date.parse(candle.time) > lastSavedMs),
      );
      setGapCandles(missing);
    });
    return () => {
      active = false;
    };
  }, [savedOandaSnapshot, serviceClient]);

  useEffect(() => {
    if (!savedOandaSnapshot || !serviceClient.subscribeOandaLiveH4) return;
    setLiveStatus('connecting');
    const applyOpenCandle = (incoming: unknown) => {
      setLiveOpenCandle((previous: unknown) => {
        const previousTime = candleTime(previous);
        const incomingTime = candleTime(incoming);
        // The open candle's `time` is the start of its H4 bucket and never changes while
        // it's open — a different value means the H4 window rolled over. The previous
        // open candle is now closed, so fold it into the gap-fill list instead of losing
        // it the moment the new open candle replaces it.
        if (previous && previousTime && incomingTime && previousTime !== incomingTime) {
          setGapCandles((gap) => [
            ...gap,
            { ...(previous as object), isClosed: true } as OandaPreviewCandle,
          ]);
        }
        return incoming ?? null;
      });
    };
    const close = serviceClient.subscribeOandaLiveH4((event) => {
      if (event.type === 'snapshot') {
        applyOpenCandle(event.payload.openCandle ?? null);
        setLivePrice(
          typeof event.payload.currentPrice === 'number' ? event.payload.currentPrice : null,
        );
        setLiveStatus('live');
      } else if (event.type === 'candle') {
        applyOpenCandle(event.payload.candle ?? null);
        setLiveStatus('live');
      } else if (event.type === 'price') {
        setLivePrice(
          typeof event.payload.currentPrice === 'number' ? event.payload.currentPrice : null,
        );
        setLiveStatus('live');
      } else if (event.type === 'error')
        setLiveStatus(event.payload.state === 'stale' ? 'stale' : 'offline');
    });
    return () => {
      close();
      setLiveOpenCandle(null);
      setLivePrice(null);
      setLiveStatus(null);
    };
  }, [savedOandaSnapshot, serviceClient]);

  const runManualFixture = async () => {
    setManualRunState('running');
    const manualRun = await serviceClient.runManualFixture();
    setManualRunResult(manualRun);
    setManualRunState(manualRun.kind);
  };

  const runManualOandaNow = async () => {
    if (!serviceClient.runManualOanda || oandaManualRunState === 'running') return;
    setOandaManualRunState('running');
    const manualRun = await serviceClient.runManualOanda();
    setOandaManualRunResult(manualRun);
    setOandaManualRunState(manualRun.kind);
    if (historyOpen) void loadHistory();
    if (manualRun.kind === 'succeeded' || manualRun.kind === 'already_exists') {
      const detail = await serviceClient.getRunByKey(manualRun.run.runKey);
      if (detail.kind === 'succeeded' && detail.report.displaySnapshot) {
        viewSavedOandaAnalysis(detail.report.displaySnapshot);
      }
    }
  };

  const loadHistory = async (limit = historyLimit) => {
    setHistoryLimit(limit);
    setHistory({ kind: 'loading' });
    setHistoryDetail(null);
    setSelectedHistoryRunKey(null);
    setHistory(await serviceClient.listRecentRuns(limit));
  };

  const openHistory = () => {
    setHistoryOpen(true);
    void loadHistory();
  };

  const selectHistoryRun = async (runKey: string) => {
    setSelectedHistoryRunKey(runKey);
    setHistoryDetail({ kind: 'loading' });
    setHistoryDetail(await serviceClient.getRunByKey(runKey));
  };

  const viewSavedOandaAnalysis = (snapshot: SavedOandaDisplaySnapshot) => {
    const analysis = parseAnalysis(snapshot.analysis);
    const candles = parseCandleDataset({
      schemaVersion: '1.0.0',
      datasetId: `saved-oanda:${snapshot.instrument}:${snapshot.h4SourceCandleTime ?? 'unavailable'}`,
      description: 'Saved immutable OANDA H4 analysis snapshot.',
      isSynthetic: false,
      timezone: 'America/Toronto',
      instrument: snapshot.instrument,
      timeframe: 'H4',
      candles: snapshot.candles,
    });
    if (!analysis.success || !candles.success) return;
    setSavedOandaSnapshot(snapshot);
    setHistoryOpen(false);
  };

  const loadStrategies = async () => {
    if (!serviceClient.listStrategies) return;
    setStrategyList({ kind: 'loading' });
    setStrategyList(await serviceClient.listStrategies());
  };

  const openStrategies = () => {
    setStrategiesOpen(true);
    void loadStrategies();
  };

  const selectStrategy = async (strategyId: string) => {
    if (!serviceClient.getStrategy) return;
    setSelectedStrategyId(strategyId);
    setStrategyDetail({ kind: 'loading' });
    setStrategyDetail(await serviceClient.getStrategy(strategyId));
  };

  const createStrategy = async (name: string, parameters: StrategyParameters) => {
    if (!serviceClient.createStrategy) return;
    setStrategyCreateState('running');
    const result = await serviceClient.createStrategy(name, parameters);
    setStrategyCreateResult(result);
    setStrategyCreateState(result.kind);
    if (result.kind === 'succeeded') void loadStrategies();
  };

  const createStrategyVersion = async (
    strategyId: string,
    name: string,
    parameters: StrategyParameters,
  ) => {
    if (!serviceClient.createStrategyVersion) return;
    setStrategyCreateState('running');
    const result = await serviceClient.createStrategyVersion(strategyId, name, parameters);
    setStrategyCreateResult(result);
    setStrategyCreateState(result.kind);
    if (result.kind === 'succeeded') {
      void loadStrategies();
      void selectStrategy(strategyId);
    }
  };

  const activateStrategyVersion = async (strategyId: string, version: number) => {
    if (!serviceClient.activateStrategyVersion) return;
    await serviceClient.activateStrategyVersion(strategyId, version);
    void loadStrategies();
    void selectStrategy(strategyId);
  };

  const loadBacktests = async () => {
    if (!serviceClient.listBacktests) return;
    setBacktestList({ kind: 'loading' });
    setBacktestList(await serviceClient.listBacktests());
  };

  const openBacktests = () => {
    setBacktestsOpen(true);
    void loadBacktests();
  };

  const selectBacktest = async (runId: string) => {
    if (!serviceClient.getBacktest) return;
    setSelectedBacktestId(runId);
    setBacktestDetail({ kind: 'loading' });
    setBacktestDetail(await serviceClient.getBacktest(runId));
  };

  const loadMrEvaluations = async () => {
    if (!serviceClient.listMrEvaluations) return;
    setMrEvaluationsList({ kind: 'loading' });
    setMrEvaluationsList(await serviceClient.listMrEvaluations());
  };

  const openMrEvaluations = () => {
    setMrEvaluationsOpen(true);
    void loadMrEvaluations();
  };

  const loadOandaPreview = async () => {
    if (!serviceClient.getOandaCandles) return;
    setOandaPreviewLoading(true);
    setOandaPreviewError(null);
    const result: OandaPreviewResult = await serviceClient.getOandaCandles(250);
    if (result.kind === 'succeeded') setOandaPreview(result.data);
    else setOandaPreviewError(result.message);
    setOandaPreviewLoading(false);
  };

  return (
    <AppShell>
      {oandaPreview ? (
        <Suspense
          fallback={
            <div className="chart-panel-loading" role="status">
              Loading chart…
            </div>
          }
        >
          <OandaChartPreview
            data={oandaPreview}
            loading={oandaPreviewLoading}
            error={oandaPreviewError}
            onRefresh={loadOandaPreview}
            onBack={() => {
              setOandaPreview(null);
              setOandaPreviewError(null);
            }}
          />
        </Suspense>
      ) : null}
      {loading ? <LoadingState /> : null}
      {!loading && !result.success ? (
        <ErrorState detail="The local analysis object failed validation. The dashboard has been withheld." />
      ) : null}
      {!loading && activeAnalysis && !oandaPreview ? (
        <Dashboard
          analysis={activeAnalysis}
          candleResult={activeCandleResult}
          dashboardState={
            !savedOandaSnapshot && useCalculatedDashboardState
              ? (dashboardState ?? undefined)
              : undefined
          }
          serviceAvailability={serviceAvailability}
          manualRunState={manualRunState}
          manualRunResult={manualRunResult}
          onManualRun={runManualFixture}
          historyOpen={historyOpen}
          history={history}
          historyDetail={historyDetail}
          selectedHistoryRunKey={selectedHistoryRunKey}
          onOpenHistory={openHistory}
          onCloseHistory={() => setHistoryOpen(false)}
          onRefreshHistory={() => void loadHistory()}
          historyLimit={historyLimit}
          onChangeHistoryLimit={(limit) => void loadHistory(limit)}
          onSelectHistoryRun={selectHistoryRun}
          onViewHistoryInDashboard={viewSavedOandaAnalysis}
          savedOandaProvenance={
            savedOandaSnapshot ? `OANDA ${savedOandaSnapshot.environment.toUpperCase()}` : null
          }
          savedSourceCandleTime={savedOandaSnapshot?.h4SourceCandleTime ?? null}
          onReturnToMock={savedOandaSnapshot ? () => setSavedOandaSnapshot(null) : undefined}
          liveObservationStatus={liveStatus}
          liveObservationPrice={livePrice}
          onOpenOandaPreview={() => void loadOandaPreview()}
          savedMetadata={
            savedOandaSnapshot
              ? {
                  provenance: `OANDA ${savedOandaSnapshot.environment.toUpperCase()}`,
                  sourceTime: savedOandaSnapshot.h4SourceCandleTime,
                  latestPrice: livePrice,
                  liveStatus,
                }
              : undefined
          }
          oandaStatus={oandaStatus ?? undefined}
          oandaManualRunState={oandaManualRunState}
          oandaManualRunResult={oandaManualRunResult}
          onRunOandaNow={() => void runManualOandaNow()}
          strategiesOpen={strategiesOpen}
          strategyList={strategyList}
          strategyDetail={strategyDetail}
          selectedStrategyId={selectedStrategyId}
          strategyCreateState={strategyCreateState}
          strategyCreateResult={strategyCreateResult}
          onOpenStrategies={openStrategies}
          onCloseStrategies={() => setStrategiesOpen(false)}
          onRefreshStrategies={() => void loadStrategies()}
          onSelectStrategy={(strategyId) => void selectStrategy(strategyId)}
          onCreateStrategy={(name, parameters) => void createStrategy(name, parameters)}
          onCreateStrategyVersion={(strategyId, name, parameters) =>
            void createStrategyVersion(strategyId, name, parameters)
          }
          onActivateStrategyVersion={(strategyId, version) =>
            void activateStrategyVersion(strategyId, version)
          }
          backtestsOpen={backtestsOpen}
          backtestList={backtestList}
          backtestDetail={backtestDetail}
          selectedBacktestId={selectedBacktestId}
          onOpenBacktests={openBacktests}
          onCloseBacktests={() => setBacktestsOpen(false)}
          onRefreshBacktests={() => void loadBacktests()}
          onSelectBacktest={(runId) => void selectBacktest(runId)}
          mrEvaluationsOpen={mrEvaluationsOpen}
          mrEvaluationsList={mrEvaluationsList}
          onOpenMrEvaluations={openMrEvaluations}
          onCloseMrEvaluations={() => setMrEvaluationsOpen(false)}
          onRefreshMrEvaluations={() => void loadMrEvaluations()}
        />
      ) : null}
    </AppShell>
  );
}
