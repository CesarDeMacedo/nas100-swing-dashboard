import { lazy, Suspense } from 'react';

import type { SafeAnalysis } from '../domain/analysis';
import type { CandleDatasetParseResult } from '../domain/candles';
import type { DashboardState } from '../application/buildDashboardState';
import type {
  ManualRunResult,
  OandaProviderStatus,
  ServiceAvailability,
} from '../serviceClient/localAnalysisService';
import { AnalysisSidebar } from './sidebar/AnalysisSidebar';
import { DashboardHeader } from './DashboardHeader';
import { MetricsFooter } from './MetricsFooter';
import { AnalysisHistoryPanel } from './AnalysisHistoryPanel';
import { StrategyManagerPanel } from './StrategyManagerPanel';
import { BacktestResultsPanel } from './BacktestResultsPanel';
import { MeanReversionPanel } from './MeanReversionPanel';
import type {
  BacktestListResult,
  BacktestReportResult,
  HistoryResult,
  MrEvaluationsListResult,
  RunDetailResult,
  SavedOandaDisplaySnapshot,
  StrategyDetailResult,
  StrategyListResult,
  StrategyMutationResult,
  StrategyParameters,
} from '../serviceClient/localAnalysisService';

// Lazy-loaded so the ~500kB lightweight-charts dependency is not part of the initial bundle.
const CandlestickChartPanel = lazy(() =>
  import('./chart/CandlestickChartPanel').then((module) => ({
    default: module.CandlestickChartPanel,
  })),
);

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
  savedMetadata?: {
    provenance: string;
    sourceTime: string | null;
    latestPrice: number | null;
    liveStatus: string | null;
  };
  oandaStatus?: 'checking' | OandaProviderStatus;
  oandaManualRunState?: 'idle' | 'running' | ManualRunResult['kind'];
  oandaManualRunResult?: ManualRunResult | null;
  onRunOandaNow?: () => void;
  strategiesOpen?: boolean;
  strategyList?: StrategyListResult | { kind: 'loading' } | null;
  strategyDetail?: StrategyDetailResult | { kind: 'loading' } | null;
  selectedStrategyId?: string | null;
  strategyCreateState?: 'idle' | 'running' | StrategyMutationResult['kind'];
  strategyCreateResult?: StrategyMutationResult | null;
  onOpenStrategies?: () => void;
  onCloseStrategies?: () => void;
  onRefreshStrategies?: () => void;
  onSelectStrategy?: (strategyId: string) => void;
  onCreateStrategy?: (name: string, parameters: StrategyParameters) => void;
  onCreateStrategyVersion?: (
    strategyId: string,
    name: string,
    parameters: StrategyParameters,
  ) => void;
  onActivateStrategyVersion?: (strategyId: string, version: number) => void;
  backtestsOpen?: boolean;
  backtestList?: BacktestListResult | { kind: 'loading' } | null;
  backtestDetail?: BacktestReportResult | { kind: 'loading' } | null;
  selectedBacktestId?: string | null;
  onOpenBacktests?: () => void;
  onCloseBacktests?: () => void;
  onRefreshBacktests?: () => void;
  onSelectBacktest?: (runId: string) => void;
  mrEvaluationsOpen?: boolean;
  mrEvaluationsList?: MrEvaluationsListResult | { kind: 'loading' } | null;
  onOpenMrEvaluations?: () => void;
  onCloseMrEvaluations?: () => void;
  onRefreshMrEvaluations?: () => void;
};

export function Dashboard({
  analysis,
  candleResult,
  dashboardState,
  serviceAvailability,
  manualRunState,
  manualRunResult,
  onManualRun,
  historyOpen = false,
  history,
  historyDetail,
  selectedHistoryRunKey = null,
  onOpenHistory,
  onCloseHistory,
  onRefreshHistory,
  historyLimit,
  onChangeHistoryLimit,
  onSelectHistoryRun,
  onViewHistoryInDashboard,
  savedOandaProvenance,
  savedSourceCandleTime,
  onReturnToMock,
  liveObservationStatus,
  liveObservationPrice,
  onOpenOandaPreview,
  savedMetadata,
  oandaStatus,
  oandaManualRunState,
  oandaManualRunResult,
  onRunOandaNow,
  strategiesOpen = false,
  strategyList,
  strategyDetail,
  selectedStrategyId = null,
  strategyCreateState = 'idle',
  strategyCreateResult = null,
  onOpenStrategies,
  onCloseStrategies,
  onRefreshStrategies,
  onSelectStrategy,
  onCreateStrategy,
  onCreateStrategyVersion,
  onActivateStrategyVersion,
  backtestsOpen = false,
  backtestList,
  backtestDetail,
  selectedBacktestId = null,
  onOpenBacktests,
  onCloseBacktests,
  onRefreshBacktests,
  onSelectBacktest,
  mrEvaluationsOpen = false,
  mrEvaluationsList,
  onOpenMrEvaluations,
  onCloseMrEvaluations,
  onRefreshMrEvaluations,
}: DashboardProps) {
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
          onOpenStrategies={onOpenStrategies}
          onOpenBacktests={onOpenBacktests}
          onOpenMrEvaluations={onOpenMrEvaluations}
          savedOandaProvenance={savedOandaProvenance}
          savedSourceCandleTime={savedSourceCandleTime}
          onReturnToMock={onReturnToMock}
          liveObservationStatus={liveObservationStatus}
          liveObservationPrice={liveObservationPrice}
          onOpenOandaPreview={onOpenOandaPreview}
          oandaStatus={oandaStatus}
          oandaManualRunState={oandaManualRunState}
          oandaManualRunResult={oandaManualRunResult}
          onRunOandaNow={onRunOandaNow}
        />
      </header>
      <div className="dashboard-main">
        <Suspense
          fallback={
            <div className="chart-panel-loading" role="status">
              Loading chart…
            </div>
          }
        >
          <CandlestickChartPanel
            analysis={analysis}
            candleResult={candleResult}
            dashboardState={state}
            savedMetadata={savedMetadata}
            mrEvaluations={
              mrEvaluationsList?.kind === 'succeeded' ? mrEvaluationsList.evaluations : []
            }
          />
        </Suspense>
        <AnalysisSidebar
          mrEvaluationsList={mrEvaluationsList}
          onOpenMrEvaluations={onOpenMrEvaluations}
        />
      </div>
      <MetricsFooter analysis={analysis} dashboardState={state} />
      {onCloseHistory && onRefreshHistory && onSelectHistoryRun ? (
        <AnalysisHistoryPanel
          open={historyOpen}
          history={history ?? null}
          detail={historyDetail ?? null}
          selectedRunKey={selectedHistoryRunKey}
          onClose={onCloseHistory}
          onRefresh={onRefreshHistory}
          historyLimit={historyLimit}
          onChangeHistoryLimit={onChangeHistoryLimit}
          onSelect={onSelectHistoryRun}
          onViewInDashboard={onViewHistoryInDashboard}
        />
      ) : null}
      {onCloseStrategies &&
      onRefreshStrategies &&
      onSelectStrategy &&
      onCreateStrategy &&
      onCreateStrategyVersion &&
      onActivateStrategyVersion ? (
        <StrategyManagerPanel
          open={strategiesOpen}
          list={strategyList ?? null}
          detail={strategyDetail ?? null}
          selectedStrategyId={selectedStrategyId}
          createState={strategyCreateState}
          createResult={strategyCreateResult}
          onClose={onCloseStrategies}
          onRefresh={onRefreshStrategies}
          onSelect={onSelectStrategy}
          onCreate={onCreateStrategy}
          onCreateVersion={onCreateStrategyVersion}
          onActivate={onActivateStrategyVersion}
        />
      ) : null}
      {onCloseBacktests && onRefreshBacktests && onSelectBacktest ? (
        <BacktestResultsPanel
          open={backtestsOpen}
          list={backtestList ?? null}
          detail={backtestDetail ?? null}
          selectedRunId={selectedBacktestId}
          onClose={onCloseBacktests}
          onRefresh={onRefreshBacktests}
          onSelect={onSelectBacktest}
        />
      ) : null}
      {onCloseMrEvaluations && onRefreshMrEvaluations ? (
        <MeanReversionPanel
          open={mrEvaluationsOpen}
          list={mrEvaluationsList ?? null}
          onClose={onCloseMrEvaluations}
          onRefresh={onRefreshMrEvaluations}
        />
      ) : null}
    </div>
  );
}
