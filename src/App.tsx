import { useEffect, useMemo, useState } from 'react';

import { AppShell } from './components/AppShell';
import { Dashboard } from './components/Dashboard';
import { OandaChartPreview } from './components/OandaChartPreview';
import { ErrorState, LoadingState } from './components/States';
import { currentAnalysisSource } from './domain/fixtures';
import { parseAnalysis } from './domain/analysis';
import { parseCandleDataset } from './domain/candles';
import { buildDashboardState } from './application/buildDashboardState';
import { currentCandleDatasetSource } from './domain/fixtures';
import { useDashboardStore } from './store/dashboardStore';
import { localAnalysisService, type HistoryResult, type LocalAnalysisServiceClient, type ManualRunResult, type OandaPreviewData, type OandaPreviewResult, type RunDetailResult, type SavedOandaDisplaySnapshot, type ServiceAvailability } from './serviceClient/localAnalysisService';

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
  const dashboardState = useMemo(() => result.success && candleResult.success ? buildDashboardState(result.analysis, candleResult.dataset) : null, [result, candleResult]);
  const useCalculatedDashboardState = analysisSource === currentAnalysisSource && candleSource === currentCandleDatasetSource;
  const dashboardAnalysis = result.success ? result.analysis : null;
  const setReady = useDashboardStore((state) => state.setReady);
  const setError = useDashboardStore((state) => state.setError);
  const [serviceAvailability, setServiceAvailability] = useState<'checking' | ServiceAvailability['kind']>('checking');
  const [manualRunState, setManualRunState] = useState<'idle' | 'running' | ManualRunResult['kind']>('idle');
  const [manualRunResult, setManualRunResult] = useState<ManualRunResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryResult | { kind: 'loading' } | null>(null);
  const [historyDetail, setHistoryDetail] = useState<RunDetailResult | { kind: 'loading' } | null>(null);
  const [selectedHistoryRunKey, setSelectedHistoryRunKey] = useState<string | null>(null);
  const [savedOandaSnapshot, setSavedOandaSnapshot] = useState<SavedOandaDisplaySnapshot | null>(null);
  const [liveOpenCandle, setLiveOpenCandle] = useState<unknown>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'live' | 'stale' | 'offline' | null>(null);
  const [oandaPreview, setOandaPreview] = useState<OandaPreviewData | null>(null);
  const [oandaPreviewLoading, setOandaPreviewLoading] = useState(false);
  const [oandaPreviewError, setOandaPreviewError] = useState<string | null>(null);
  const savedAnalysisResult = useMemo(() => savedOandaSnapshot ? parseAnalysis(savedOandaSnapshot.analysis) : null, [savedOandaSnapshot]);
  const savedCandleResult = useMemo(() => savedOandaSnapshot ? parseCandleDataset({ schemaVersion: '1.0.0', datasetId: `saved-oanda:${savedOandaSnapshot.instrument}:${savedOandaSnapshot.h4SourceCandleTime ?? 'unavailable'}`, description: 'Saved immutable OANDA H4 analysis snapshot.', isSynthetic: false, timezone: 'America/Toronto', instrument: savedOandaSnapshot.instrument, timeframe: 'H4', candles: [...(savedOandaSnapshot.candles as unknown[]), ...(liveOpenCandle ? [liveOpenCandle] : [])] }) : null, [savedOandaSnapshot, liveOpenCandle]);
  const activeAnalysis = savedOandaSnapshot ? (savedAnalysisResult?.success ? savedAnalysisResult.analysis : null) : dashboardAnalysis;
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
    if (!savedOandaSnapshot || !serviceClient.subscribeOandaLiveH4) return;
    setLiveStatus('connecting');
    const close = serviceClient.subscribeOandaLiveH4((event) => {
      if (event.type === 'snapshot') {
        setLiveOpenCandle(event.payload.openCandle ?? null);
        setLivePrice(typeof event.payload.currentPrice === 'number' ? event.payload.currentPrice : null);
        setLiveStatus('live');
      } else if (event.type === 'candle') {
        setLiveOpenCandle(event.payload.candle ?? null);
        setLiveStatus('live');
      } else if (event.type === 'price') {
        setLivePrice(typeof event.payload.currentPrice === 'number' ? event.payload.currentPrice : null);
        setLiveStatus('live');
      } else if (event.type === 'error') setLiveStatus((event.payload.state === 'stale' ? 'stale' : 'offline'));
    });
    return () => { close(); setLiveOpenCandle(null); setLivePrice(null); setLiveStatus(null); };
  }, [savedOandaSnapshot, serviceClient]);

  const runManualFixture = async () => {
    setManualRunState('running');
    const manualRun = await serviceClient.runManualFixture();
    setManualRunResult(manualRun);
    setManualRunState(manualRun.kind);
  };

  const loadHistory = async () => {
    setHistory({ kind: 'loading' });
    setHistoryDetail(null);
    setSelectedHistoryRunKey(null);
    setHistory(await serviceClient.listRecentRuns(10));
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
    const candles = parseCandleDataset({ schemaVersion: '1.0.0', datasetId: `saved-oanda:${snapshot.instrument}:${snapshot.h4SourceCandleTime ?? 'unavailable'}`, description: 'Saved immutable OANDA H4 analysis snapshot.', isSynthetic: false, timezone: 'America/Toronto', instrument: snapshot.instrument, timeframe: 'H4', candles: snapshot.candles });
    if (!analysis.success || !candles.success) return;
    setSavedOandaSnapshot(snapshot);
    setHistoryOpen(false);
  };

  const loadOandaPreview = async () => {
    if (!serviceClient.getOandaCandles) return;
    setOandaPreviewLoading(true); setOandaPreviewError(null);
    const result: OandaPreviewResult = await serviceClient.getOandaCandles(250);
    if (result.kind === 'succeeded') setOandaPreview(result.data);
    else setOandaPreviewError(result.message);
    setOandaPreviewLoading(false);
  };

  return (
    <AppShell>
      {oandaPreview ? <OandaChartPreview data={oandaPreview} loading={oandaPreviewLoading} error={oandaPreviewError} onRefresh={loadOandaPreview} onBack={() => { setOandaPreview(null); setOandaPreviewError(null); }} /> : null}
      {loading ? <LoadingState /> : null}
      {!loading && !result.success ? (
        <ErrorState detail="The local analysis object failed validation. The dashboard has been withheld." />
      ) : null}
      {!loading && activeAnalysis && !oandaPreview ? (
        <Dashboard
          analysis={activeAnalysis}
          candleResult={activeCandleResult}
          dashboardState={!savedOandaSnapshot && useCalculatedDashboardState ? (dashboardState ?? undefined) : undefined}
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
          onSelectHistoryRun={selectHistoryRun}
          onViewHistoryInDashboard={viewSavedOandaAnalysis}
          savedOandaProvenance={savedOandaSnapshot ? `OANDA ${savedOandaSnapshot.environment.toUpperCase()}` : null}
          savedSourceCandleTime={savedOandaSnapshot?.h4SourceCandleTime ?? null}
          onReturnToMock={savedOandaSnapshot ? () => setSavedOandaSnapshot(null) : undefined}
          liveObservationStatus={liveStatus}
          liveObservationPrice={livePrice}
          onOpenOandaPreview={() => void loadOandaPreview()}
          savedMetadata={savedOandaSnapshot ? { provenance: `OANDA ${savedOandaSnapshot.environment.toUpperCase()}`, sourceTime: savedOandaSnapshot.h4SourceCandleTime, latestPrice: livePrice, liveStatus } : undefined}
        />
      ) : null}
    </AppShell>
  );
}
