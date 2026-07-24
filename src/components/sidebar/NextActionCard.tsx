import { ClipboardCheck } from 'lucide-react';

import { InstructionCard, NarrativeList } from './InstructionCard';

export function NextActionCard({ items }: { items?: string[] }) {
  return (
    <InstructionCard title="What to do next" icon={ClipboardCheck} tone="warning" emphasis="secondary">
      <NarrativeList items={items} fallback="No additional next-step guidance was provided." />
    </InstructionCard>
  );
}
