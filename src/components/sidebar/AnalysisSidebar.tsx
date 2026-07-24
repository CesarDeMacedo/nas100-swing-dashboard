import type { SafeAnalysis } from '../../domain/analysis';
import type { DashboardState } from '../../application/buildDashboardState';
import { formatPrice } from '../../lib/format';
import { MarketContextCard } from './MarketContextCard';
import { NextActionCard } from './NextActionCard';
import { SetupScoreCard } from './SetupScoreCard';
import { WhyNoEntryCard } from './WhyNoEntryCard';

type AnalysisSidebarProps = {
  analysis: SafeAnalysis;
  dashboardState?: DashboardState;
};

const uniqueItems = (items: string[]) => [...new Set(items.filter(Boolean))];

const planValue = (label: string, value: number | null) =>
  `${label}: ${value === null ? 'Not available' : formatPrice(value)}.`;

function nextSteps(state: DashboardState, fallback: string[]) {
  if (state.action === 'WAIT_FOR_PULLBACK') {
    return [
      'Wait for price to reach an acceptable pullback location.',
      'Wait for a completed H4 confirmation candle.',
      'Only act when reward-to-risk is at least 2:1.',
      'Remain flat if structural invalidation occurs.',
      'Entry: Waiting for pullback location.',
      'Stop: Not calculated. Targets: Not calculated. R:R: Not available.',
    ];
  }

  return uniqueItems([
    ...state.reasons,
    ...fallback,
    state.entryTrigger ? `Entry trigger: ${state.entryTrigger}` : 'Entry trigger: Not available.',
    planValue('Entry', state.entryPrice),
    planValue('Invalidation', state.invalidationPrice),
    planValue('Stop', state.stopPrice),
    state.targets.length
      ? `Targets: ${state.targets.map((target) => formatPrice(target)).join(', ')}.`
      : 'Targets: Not calculated.',
    state.estimatedRewardRisk === null
      ? 'R:R: Not available.'
      : `R:R: ${state.estimatedRewardRisk.toFixed(2)}.`,
  ]);
}

export function AnalysisSidebar({ analysis, dashboardState }: AnalysisSidebarProps) {
  const action = dashboardState?.action ?? analysis.action;
  const rationale = dashboardState
    ? uniqueItems([
        ...dashboardState.reasons,
        ...dashboardState.warnings,
        ...analysis.whyNoEntry,
      ])
    : analysis.whyNoEntry;
  const actions = dashboardState
    ? nextSteps(dashboardState, analysis.whatToDoNext)
    : analysis.whatToDoNext;

  return (
    <aside className="analysis-sidebar" aria-label="Setup analysis">
      <WhyNoEntryCard
        action={action}
        items={rationale}
        reason={dashboardState?.primaryReason ?? analysis.reason}
      />
      <SetupScoreCard
        score={dashboardState?.score ?? analysis.score}
        grade={dashboardState?.grade ?? analysis.grade}
        action={action}
        premiumSetupState={dashboardState?.premiumSetupState}
        isActionable={dashboardState?.isActionable}
        reason={dashboardState?.primaryReason}
      />
      <NextActionCard items={actions} />
      <MarketContextCard items={analysis.marketContext} />
    </aside>
  );
}
