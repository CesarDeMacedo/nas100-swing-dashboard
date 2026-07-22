import { Activity, BarChart3, CalendarClock, Clock3, TrendingUp } from 'lucide-react';

import type { SafeAnalysis } from '../domain/analysis';
import type { DashboardState } from '../application/buildDashboardState';
import { formatPercent, formatPrice, formatTorontoTime } from '../lib/format';
import { DataFreshnessBadge } from './DataFreshnessBadge';

type MetricsFooterProps = {
  analysis: SafeAnalysis;
  dashboardState?: DashboardState;
};

export function MetricsFooter({ analysis, dashboardState }: MetricsFooterProps) {
  const state = dashboardState;
  const metrics = [
    { label: 'Timeframe', value: state?.timeframe ?? analysis.timeframe, icon: Clock3 },
    { label: 'Instrument', value: state?.displayName ?? analysis.displayName, icon: BarChart3 },
    {
      label: 'Current price',
      value: formatPrice(state?.currentPrice ?? analysis.currentPrice),
      icon: Activity,
      tone: (state?.changePercent ?? analysis.changePercent) >= 0 ? 'positive' : 'negative',
    },
    {
      label: 'Daily change',
      value: formatPercent(state?.changePercent ?? analysis.changePercent),
      icon: TrendingUp,
      tone: (state?.changePercent ?? analysis.changePercent) >= 0 ? 'positive' : 'negative',
    },
    {
      label: 'Data time',
      value: formatTorontoTime(state?.sourceCandleTime ?? analysis.completedCandleAt),
      icon: CalendarClock,
    },
  ];

  return (
    <footer className="metrics-footer" aria-label="Market metrics">
      {metrics.map(({ label, value, icon: Icon, tone }) => (
        <div className="metric-item" key={label}>
          <Icon aria-hidden="true" size={25} strokeWidth={1.8} />
          <div>
            <span>{label}</span>
            <strong className={tone ? `metric-value--${tone}` : undefined}>{value}</strong>
          </div>
        </div>
      ))}
      <DataFreshnessBadge
        freshness={state?.dataFreshness ?? analysis.dataFreshness}
        provider={analysis.dataProvider}
      />
    </footer>
  );
}
