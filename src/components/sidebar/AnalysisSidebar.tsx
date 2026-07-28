import type { DashboardState } from '../../application/buildDashboardState';
import type { SafeAnalysis } from '../../domain/analysis';
import type { MrEvaluationsListResult } from '../../serviceClient/localAnalysisService';
import { MeanReversionStrategyCard } from './MeanReversionStrategyCard';
import { PipelineStrategyCard } from './PipelineStrategyCard';

type AnalysisSidebarProps = {
  dashboardState?: DashboardState;
  analysis?: SafeAnalysis;
  onOpenHistory?: () => void;
  mrEvaluationsList?: MrEvaluationsListResult | { kind: 'loading' } | null;
  onOpenMrEvaluations?: () => void;
};

/** The pipeline's why-no-entry/setup-score/next-action/market-context cards were removed from
 * this default view back when the pipeline was dormant (near-zero signal rate) — see git
 * history. PipelineStrategyCard restores a live status card now that the Patience Filter's
 * event-risk and cross-market gates are advisory-only instead of blocking (patienceFilter.ts),
 * which is expected to raise the pipeline's signal rate. The older cards' own
 * components/tests are untouched and still render inside the History panel for anyone
 * reviewing a saved OANDA/pipeline report. */
export function AnalysisSidebar({
  dashboardState,
  analysis,
  onOpenHistory,
  mrEvaluationsList,
  onOpenMrEvaluations,
}: AnalysisSidebarProps) {
  return (
    <aside className="analysis-sidebar" aria-label="Setup analysis">
      <PipelineStrategyCard state={dashboardState} analysis={analysis} onOpenHistory={onOpenHistory} />
      <MeanReversionStrategyCard
        list={mrEvaluationsList ?? null}
        onOpenHistory={onOpenMrEvaluations}
      />
    </aside>
  );
}
