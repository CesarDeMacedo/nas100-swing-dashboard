import { useEffect, useMemo } from 'react';

import { AppShell } from './components/AppShell';
import { Dashboard } from './components/Dashboard';
import { ErrorState, LoadingState } from './components/States';
import { currentAnalysisSource } from './domain/fixtures';
import { parseAnalysis } from './domain/analysis';
import { parseCandleDataset } from './domain/candles';
import { buildDashboardState } from './application/buildDashboardState';
import { currentCandleDatasetSource } from './domain/fixtures';
import { useDashboardStore } from './store/dashboardStore';

type AppProps = {
  analysisSource?: unknown;
  candleSource?: unknown;
  loading?: boolean;
};

export default function App({
  analysisSource = currentAnalysisSource,
  candleSource = currentCandleDatasetSource,
  loading = false,
}: AppProps) {
  const result = useMemo(() => parseAnalysis(analysisSource), [analysisSource]);
  const candleResult = useMemo(() => parseCandleDataset(candleSource), [candleSource]);
  const dashboardState = useMemo(() => result.success && candleResult.success ? buildDashboardState(result.analysis, candleResult.dataset) : null, [result, candleResult]);
  const useCalculatedDashboardState = analysisSource === currentAnalysisSource && candleSource === currentCandleDatasetSource;
  const dashboardAnalysis = result.success ? result.analysis : null;
  const setReady = useDashboardStore((state) => state.setReady);
  const setError = useDashboardStore((state) => state.setError);

  useEffect(() => {
    if (result.success) {
      setReady(result.analysis.id);
    } else {
      setError();
    }
  }, [result, setError, setReady]);

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
        />
      ) : null}
    </AppShell>
  );
}
