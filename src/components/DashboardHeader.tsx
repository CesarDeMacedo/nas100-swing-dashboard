import type { Analysis } from '../domain/analysis';
import { formatTimeframeLabel } from '../lib/format';
import type { ManualRunResult, ServiceAvailability } from '../serviceClient/localAnalysisService';
import { LocalServiceControl } from './LocalServiceControl';

type DashboardHeaderProps = Pick<Analysis, 'displayName' | 'instrument' | 'timeframe'> & {
  serviceAvailability?: 'checking' | ServiceAvailability['kind'];
  manualRunState?: 'idle' | 'running' | ManualRunResult['kind'];
  manualRunResult?: ManualRunResult | null;
  onManualRun?: () => void;
  onOpenHistory?: () => void;
  savedOandaProvenance?: string | null;
  savedSourceCandleTime?: string | null;
  onReturnToMock?: () => void;
};

export function DashboardHeader({ displayName, instrument, timeframe, serviceAvailability, manualRunState, manualRunResult, onManualRun, onOpenHistory, savedOandaProvenance, savedSourceCandleTime, onReturnToMock }: DashboardHeaderProps) {
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
      {savedOandaProvenance ? <div role="status"><strong>{savedOandaProvenance} — SAVED ANALYSIS</strong><small>Source H4: {savedSourceCandleTime ?? 'Unavailable'}</small>{onReturnToMock ? <button type="button" onClick={onReturnToMock}>Return to mock dashboard</button> : null}</div> : null}
      {serviceAvailability && manualRunState && onManualRun ? (
        <LocalServiceControl availability={serviceAvailability} runState={manualRunState} result={manualRunResult ?? null} onRun={onManualRun} onOpenHistory={onOpenHistory} />
      ) : null}
    </div>
  );
}
