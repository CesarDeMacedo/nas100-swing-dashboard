import { Target } from 'lucide-react';
import type { CSSProperties } from 'react';

import { getActionState } from '../../domain/actionStates';
import type { Action } from '../../domain/analysis';
import { InstructionCard } from './InstructionCard';

type SetupScoreCardProps = {
  score: number | null;
  grade: string | null;
  action: Action;
  premiumSetupState?: string;
  isActionable?: boolean;
  reason?: string;
};

const premiumSetupText = (state?: string) => {
  switch (state) {
    case 'confirmed_entry':
      return 'Confirmed premium setup';
    case 'high_quality_forming':
      return 'High-quality setup forming';
    case 'high_quality_waiting_confirmation':
      return 'High-quality setup awaiting confirmation';
    case 'high_quality_blocked':
      return 'High technical score, blocked';
    case 'below_threshold':
      return 'Below premium threshold';
    default:
      return 'Score unavailable';
  }
};

export function SetupScoreCard({
  score,
  grade,
  action,
  premiumSetupState,
  isActionable,
  reason,
}: SetupScoreCardProps) {
  const actionState = getActionState(action);
  const numericScore = score ?? 0;
  const scoreStyle = { '--score-width': `${numericScore}%` } as CSSProperties;

  return (
    <InstructionCard title="Setup Score" icon={Target} tone="score" testId="setup-score-card">
      <div className="score-card__summary">
        <strong>{score ?? 'Not available'}</strong>
        <span>/ 100</span>
        <b>Grade {grade ?? 'Not available'}</b>
      </div>
      <div className="score-card__track" aria-label={`Setup score ${score ?? 'unavailable'} out of 100`}>
        <span style={scoreStyle} />
      </div>
      <div className="score-card__decision">
        <span>
          {premiumSetupState === undefined
            ? numericScore >= 70
              ? 'Premium setup forming'
              : 'Standard setup watch'
            : premiumSetupText(premiumSetupState)}
        </span>
        <strong
          className={actionState.badgeClassName}
          style={{ '--action-color': actionState.primaryColor } as CSSProperties}
        >
          {isActionable === undefined ? actionState.label : isActionable ? actionState.label : 'NO ACTIVE ENTRY'}
        </strong>
      </div>
      {reason ? <p className="instruction-card__lead">{reason}</p> : null}
    </InstructionCard>
  );
}
