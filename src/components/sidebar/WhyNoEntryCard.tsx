import { CircleHelp } from 'lucide-react';

import type { Action } from '../../domain/analysis';
import { InstructionCard, NarrativeList } from './InstructionCard';

type WhyNoEntryCardProps = {
  action: Action;
  items?: string[];
  reason?: string;
};

export function WhyNoEntryCard({ action, items, reason }: WhyNoEntryCardProps) {
  const title = action === 'BUY' || action === 'SELL' ? 'Setup rationale' : 'Why no entry now?';

  return (
    <InstructionCard title={title} icon={CircleHelp} tone="danger" testId="why-no-entry-card">
      {reason ? <p className="instruction-card__lead">{reason}</p> : null}
      <NarrativeList items={items} fallback="No additional setup rationale was provided." />
    </InstructionCard>
  );
}
