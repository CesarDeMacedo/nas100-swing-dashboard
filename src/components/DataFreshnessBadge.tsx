import { CircleDot, Database, TriangleAlert } from 'lucide-react';

import type { DataFreshness } from '../domain/analysis';

type DataFreshnessBadgeProps = {
  freshness: DataFreshness;
  provider: string;
};

const FRESHNESS_LABELS: Record<DataFreshness, string> = {
  FRESH: 'Fresh data',
  MOCK: 'Mock data',
  STALE: 'Stale data',
  MISSING: 'Data missing',
  INVALID: 'Data invalid',
};

export function DataFreshnessBadge({ freshness, provider }: DataFreshnessBadgeProps) {
  const Icon = freshness === 'FRESH' ? CircleDot : freshness === 'MOCK' ? Database : TriangleAlert;
  const freshnessClass = freshness.toLowerCase();

  return (
    <span
      className={`freshness-badge freshness-badge--${freshnessClass}`}
      data-testid="freshness-badge"
    >
      <Icon aria-hidden="true" size={14} strokeWidth={2.1} />
      <span>{FRESHNESS_LABELS[freshness]}</span>
      <span className="freshness-badge__provider">{provider}</span>
    </span>
  );
}
