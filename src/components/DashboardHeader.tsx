import type { Analysis } from '../domain/analysis';
import { formatTimeframeLabel } from '../lib/format';
import type { ManualRunResult, ServiceAvailability } from '../serviceClient/localAnalysisService';
import { LocalServiceControl } from './LocalServiceControl';

type DashboardHeaderProps = Pick<Analysis, 'displayName' | 'instrument' | 'timeframe'> & {
  serviceAvailability?: 'checking' | ServiceAvailability['kind'];
  manualRunState?: 'idle' | 'running' | ManualRunResult['kind'];
  manualRunResult?: ManualRunResult | null;
  onManualRun?: () => void;
};

export function DashboardHeader({ displayName, instrument, timeframe, serviceAvailability, manualRunState, manualRunResult, onManualRun }: DashboardHeaderProps) {
  const titleTimeframe = formatTimeframeLabel(timeframe);

  return (
    <div className="dashboard-header">
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
      {serviceAvailability && manualRunState && onManualRun ? (
        <LocalServiceControl availability={serviceAvailability} runState={manualRunState} result={manualRunResult ?? null} onRun={onManualRun} />
      ) : null}
    </div>
  );
}
