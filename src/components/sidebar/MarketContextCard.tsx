import { Globe2 } from 'lucide-react';

import { InstructionCard, NarrativeList } from './InstructionCard';

export function MarketContextCard({ items }: { items?: string[] }) {
  return (
    <InstructionCard title="Market Context" icon={Globe2} tone="context" emphasis="secondary">
      <NarrativeList items={items} fallback="No additional market context was provided." />
    </InstructionCard>
  );
}
