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
import { localAnalysisService, type HistoryResult, type LocalAnalysisServiceClient, type ManualRunResult, type RunDetailResult, type ServiceAvailability } from './serviceClient/localAnalysisService';

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

  return (
    <AppShell>
      {loading ? <LoadingState /> : null}
      {!loading && !result.success ? (
        <ErrorState detail="The local analysis object failed validation. The dashboard has been withheld." />
      ) : null}
      {!loading && dashboardAnalysis ? (
        <Dashboard
          analysis={dashboardAnalysis}
          candleResult={candleResult}
          dashboardState={useCalculatedDashboardState ? (dashboardState ?? undefined) : undefined}
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
        />
      ) : null}
    </AppShell>
  );
}
