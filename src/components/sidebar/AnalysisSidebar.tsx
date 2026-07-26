import type { MrEvaluationsListResult } from '../../serviceClient/localAnalysisService';
import { MeanReversionStrategyCard } from './MeanReversionStrategyCard';

type AnalysisSidebarProps = {
  mrEvaluationsList?: MrEvaluationsListResult | { kind: 'loading' } | null;
  onOpenMrEvaluations?: () => void;
};

/** Pipeline-only cards (why no entry, setup score, next action, market context) were removed
 * from this default view — the pipeline strategy is dormant (near-zero signal rate) and the
 * live strategies actually being traded are the mean-reversion ones below. The pipeline's own
 * components/tests are untouched and still render inside the History panel for anyone
 * reviewing a saved OANDA/pipeline report. */
export function AnalysisSidebar({ mrEvaluationsList, onOpenMrEvaluations }: AnalysisSidebarProps) {
  return (
    <aside className="analysis-sidebar" aria-label="Setup analysis">
      <MeanReversionStrategyCard
        list={mrEvaluationsList ?? null}
        onOpenHistory={onOpenMrEvaluations}
      />
    </aside>
  );
}
