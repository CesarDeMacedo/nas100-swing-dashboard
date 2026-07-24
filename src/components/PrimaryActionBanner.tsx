import { getActionState } from '../domain/actionStates';
import type { Action } from '../domain/analysis';
import type { CSSProperties } from 'react';

type PrimaryActionBannerProps = {
  action: Action;
  reason?: string;
  label?: string;
};

export function PrimaryActionBanner({ action, reason, label }: PrimaryActionBannerProps) {
  const state = getActionState(action);
  const Icon = state.icon;
  const visibleLabel = label ?? state.label;

  return (
    <section
      className={state.bannerClassName}
      style={
        {
          '--action-color': state.primaryColor,
          '--action-border': state.borderColor,
          '--action-icon': state.iconColor,
        } as CSSProperties
      }
      aria-label={`Current action: ${visibleLabel}`}
      data-testid="primary-action-banner"
    >
      <Icon className="action-banner__icon" aria-hidden="true" size={26} strokeWidth={2.1} />
      <div>
        <span className="action-banner__label">{visibleLabel}</span>
        {reason ? <span className="action-banner__reason">{reason}</span> : null}
      </div>
    </section>
  );
}
