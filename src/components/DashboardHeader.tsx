import type { Analysis } from '../domain/analysis';
import { formatTimeframeLabel } from '../lib/format';

type DashboardHeaderProps = Pick<Analysis, 'displayName' | 'instrument' | 'timeframe'>;

export function DashboardHeader({ displayName, instrument, timeframe }: DashboardHeaderProps) {
  const titleTimeframe = formatTimeframeLabel(timeframe);

  return (
    <div className="dashboard-title-block">
      <p className="dashboard-title-block__kicker">Swing intelligence</p>
      <h1>
        {instrument} {titleTimeframe} Setup Check
      </h1>
      <p>
        Current market view <span aria-hidden="true">·</span> {displayName}{' '}
        <span aria-hidden="true">·</span> {timeframe}
      </p>
    </div>
  );
}
