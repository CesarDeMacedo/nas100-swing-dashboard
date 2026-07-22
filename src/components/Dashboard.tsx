import type { SafeAnalysis } from '../domain/analysis';
import type { CandleDatasetParseResult } from '../domain/candles';
import type { DashboardState } from '../application/buildDashboardState';
import type { ManualRunResult, ServiceAvailability } from '../serviceClient/localAnalysisService';
import { AnalysisSidebar } from './sidebar/AnalysisSidebar';
import { CandlestickChartPanel } from './chart/CandlestickChartPanel';
import { DashboardHeader } from './DashboardHeader';
import { MetricsFooter } from './MetricsFooter';
import { PrimaryActionBanner } from './PrimaryActionBanner';
import { SetupSummary } from './SetupSummary';
import { AnalysisHistoryPanel } from './AnalysisHistoryPanel';
import type { HistoryResult, RunDetailResult } from '../serviceClient/localAnalysisService';

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
  onSelectHistoryRun?: (runKey: string) => void;
};

export function Dashboard({ analysis, candleResult, dashboardState, serviceAvailability, manualRunState, manualRunResult, onManualRun, historyOpen = false, history, historyDetail, selectedHistoryRunKey = null, onOpenHistory, onCloseHistory, onRefreshHistory, onSelectHistoryRun }: DashboardProps) {
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
        <CandlestickChartPanel
          analysis={analysis}
          candleResult={candleResult}
          dashboardState={state}
        />
        <AnalysisSidebar analysis={analysis} dashboardState={state} />
      </div>
      <MetricsFooter analysis={analysis} dashboardState={state} />
      {onCloseHistory && onRefreshHistory && onSelectHistoryRun ? <AnalysisHistoryPanel open={historyOpen} history={history ?? null} detail={historyDetail ?? null} selectedRunKey={selectedHistoryRunKey} onClose={onCloseHistory} onRefresh={onRefreshHistory} onSelect={onSelectHistoryRun} /> : null}
    </div>
  );
}
