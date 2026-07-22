import { getActionState } from '../../domain/actionStates';
import type { Action } from '../../domain/analysis';

type ChartDecisionOverlayProps = {
  action: Action;
  reason?: string;
  label?: string;
};

export function ChartDecisionOverlay({ action, reason, label }: ChartDecisionOverlayProps) {
  const state = getActionState(action);
  const Icon = state.icon;

  return (
    <aside className={state.overlayClassName} data-testid="chart-decision-overlay">
      <Icon aria-hidden="true" size={20} />
      <div>
        <strong>{label ?? state.label}</strong>
        {reason ? <span>{reason}</span> : null}
      </div>
    </aside>
  );
}
