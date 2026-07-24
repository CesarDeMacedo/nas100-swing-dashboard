import { lazy, Suspense } from 'react';

import type { SafeAnalysis } from '../domain/analysis';
import type { CandleDatasetParseResult } from '../domain/candles';
import type { DashboardState } from '../application/buildDashboardState';
import type { ManualRunResult, OandaProviderStatus, ServiceAvailability } from '../serviceClient/localAnalysisService';
import { AnalysisSidebar } from './sidebar/AnalysisSidebar';
import { DashboardHeader } from './DashboardHeader';
import { MetricsFooter } from './MetricsFooter';
import { PrimaryActionBanner } from './PrimaryActionBanner';
import { SetupSummary } from './SetupSummary';
import { AnalysisHistoryPanel } from './AnalysisHistoryPanel';
import type { HistoryResult, RunDetailResult, SavedOandaDisplaySnapshot } from '../serviceClient/localAnalysisService';

// Lazy-loaded so the ~500kB lightweight-charts dependency is not part of the initial bundle.
const CandlestickChartPanel = lazy(() => import('./chart/CandlestickChartPanel').then((module) => ({ default: module.CandlestickChartPanel })));

type DashboardProps = {
  analysis: SafeAnalysis;
  candleResult: CandleDatasetParseResult;
  dashboardState?: DashboardState;
  serviceAvailability?: 'checking' | ServiceAvailability['kind'];
  manualRunState?: 'idle' | 'running' | ManualRunResult['kind'];
  manualRunResult?: ManualRunResult | null;
  onManualRun?: () => void;
  historyOpen?: boolean;
  history?: HistoryResult | { kind: 'loading' } | null;
  historyDetail?: RunDetailResult | { kind: 'loading' } | null;
  selectedHistoryRunKey?: string | null;
  onOpenHistory?: () => void;
  onCloseHistory?: () => void;
  onRefreshHistory?: () => void;
  historyLimit?: number;
  onChangeHistoryLimit?: (limit: number) => void;
  onSelectHistoryRun?: (runKey: string) => void;
  onViewHistoryInDashboard?: (snapshot: SavedOandaDisplaySnapshot) => void;
  savedOandaProvenance?: string | null;
  savedSourceCandleTime?: string | null;
  onReturnToMock?: () => void;
  liveObservationStatus?: string | null;
  liveObservationPrice?: number | null;
  onOpenOandaPreview?: () => void;
  savedMetadata?: { provenance: string; sourceTime: string | null; latestPrice: number | null; liveStatus: string | null };
  oandaStatus?: 'checking' | OandaProviderStatus;
};

export function Dashboard({ analysis, candleResult, dashboardState, serviceAvailability, manualRunState, manualRunResult, onManualRun, historyOpen = false, history, historyDetail, selectedHistoryRunKey = null, onOpenHistory, onCloseHistory, onRefreshHistory, historyLimit, onChangeHistoryLimit, onSelectHistoryRun, onViewHistoryInDashboard, savedOandaProvenance, savedSourceCandleTime, onReturnToMock, liveObservationStatus, liveObservationPrice, onOpenOandaPreview, savedMetadata, oandaStatus }: DashboardProps) {
  const state = dashboardState;

  return (
    <div className="dashboard" data-testid="dashboard">
      <header className="dashboard-topbar">
        <DashboardHeader
          displayName={analysis.displayName}
          instrument={analysis.instrument}
          timeframe={analysis.timeframe}
          serviceAvailability={serviceAvailability}
          manualRunState={manualRunState}
          manualRunResult={manualRunResult}
          onManualRun={onManualRun}
          onOpenHistory={onOpenHistory}
          savedOandaProvenance={savedOandaProvenance}
          savedSourceCandleTime={savedSourceCandleTime}
          onReturnToMock={onReturnToMock}
          liveObservationStatus={liveObservationStatus}
          liveObservationPrice={liveObservationPrice}
          onOpenOandaPreview={onOpenOandaPreview}
          oandaStatus={oandaStatus}
        />
        <PrimaryActionBanner
          action={state?.action ?? analysis.action}
          label={state?.actionLabel}
          reason={state?.primaryReason ?? analysis.reason}
        />
        <SetupSummary
          score={state?.score ?? analysis.score}
          grade={state?.grade ?? analysis.grade}
          dailyRegime={state?.marketRegime ?? analysis.dailyRegime}
          status={state?.setupStatus ?? analysis.status}
          bias={state?.bias ?? analysis.bias}
          confidence={analysis.confidence}
          isActionable={state?.isActionable}
          premiumSetupState={state?.premiumSetupState}
        />
      </header>
      <div className="dashboard-main">
        <Suspense fallback={<div className="chart-panel-loading" role="status">Loading chart…</div>}>
          <CandlestickChartPanel
            analysis={analysis}
            candleResult={candleResult}
            dashboardState={state}
            savedMetadata={savedMetadata}
          />
        </Suspense>
        <AnalysisSidebar analysis={analysis} dashboardState={state} />
      </div>
      <MetricsFooter analysis={analysis} dashboardState={state} />
      {onCloseHistory && onRefreshHistory && onSelectHistoryRun ? <AnalysisHistoryPanel open={historyOpen} history={history ?? null} detail={historyDetail ?? null} selectedRunKey={selectedHistoryRunKey} onClose={onCloseHistory} onRefresh={onRefreshHistory} historyLimit={historyLimit} onChangeHistoryLimit={onChangeHistoryLimit} onSelect={onSelectHistoryRun} onViewInDashboard={onViewHistoryInDashboard} /> : null}
    </div>
  );
}
