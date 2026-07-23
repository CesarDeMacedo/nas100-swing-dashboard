import { useEffect, useMemo, useState } from 'react';

import { AppShell } from './components/AppShell';
import { Dashboard } from './components/Dashboard';
import { ErrorState, LoadingState } from './components/States';
import { currentAnalysisSource } from './domain/fixtures';
import { parseAnalysis } from './domain/analysis';
import { parseCandleDataset } from './domain/candles';
import { buildDashboardState } from './application/buildDashboardState';
import { currentCandleDatasetSource } from './domain/fixtures';
import { useDashboardStore } from './store/dashboardStore';
import { localAnalysisService, type HistoryResult, type LocalAnalysisServiceClient, type ManualRunResult, type RunDetailResult, type SavedOandaDisplaySnapshot, type ServiceAvailability } from './serviceClient/localAnalysisService';

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
  const savedAnalysisResult = useMemo(() => savedOandaSnapshot ? parseAnalysis(savedOandaSnapshot.analysis) : null, [savedOandaSnapshot]);
  const savedCandleResult = useMemo(() => savedOandaSnapshot ? parseCandleDataset({ schemaVersion: '1.0.0', datasetId: `saved-oanda:${savedOandaSnapshot.instrument}:${savedOandaSnapshot.h4SourceCandleTime ?? 'unavailable'}`, description: 'Saved immutable OANDA H4 analysis snapshot.', isSynthetic: false, timezone: 'America/Toronto', instrument: savedOandaSnapshot.instrument, timeframe: 'H4', candles: savedOandaSnapshot.candles }) : null, [savedOandaSnapshot]);
  const activeAnalysis = savedAnalysisResult?.success ? savedAnalysisResult.analysis : dashboardAnalysis;
  const activeCandleResult = savedCandleResult?.success ? savedCandleResult : candleResult;

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

  return (
    <AppShell>
      {loading ? <LoadingState /> : null}
      {!loading && !result.success ? (
        <ErrorState detail="The local analysis object failed validation. The dashboard has been withheld." />
      ) : null}
      {!loading && activeAnalysis ? (
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
        />
      ) : null}
    </AppShell>
  );
}
