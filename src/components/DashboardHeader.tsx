import type { Analysis } from '../domain/analysis';
import { formatTimeframeLabel } from '../lib/format';
import { formatPrice } from '../lib/format';
import type { ManualRunResult, OandaProviderStatus, ServiceAvailability } from '../serviceClient/localAnalysisService';
import { LocalServiceControl } from './LocalServiceControl';
import { OandaStatusBadge } from './OandaStatusBadge';

type DashboardHeaderProps = Pick<Analysis, 'displayName' | 'instrument' | 'timeframe'> & {
  serviceAvailability?: 'checking' | ServiceAvailability['kind'];
  manualRunState?: 'idle' | 'running' | ManualRunResult['kind'];
  manualRunResult?: ManualRunResult | null;
  onManualRun?: () => void;
  onOpenHistory?: () => void;
  savedOandaProvenance?: string | null;
  savedSourceCandleTime?: string | null;
  onReturnToMock?: () => void;
  onOpenOandaPreview?: () => void;
  liveObservationStatus?: string | null;
  liveObservationPrice?: number | null;
  oandaStatus?: 'checking' | OandaProviderStatus;
};

export function DashboardHeader({ displayName, instrument, timeframe, serviceAvailability, manualRunState, manualRunResult, onManualRun, onOpenHistory, savedOandaProvenance, savedSourceCandleTime, onReturnToMock, onOpenOandaPreview, liveObservationStatus, liveObservationPrice, oandaStatus }: DashboardHeaderProps) {
  const titleTimeframe = formatTimeframeLabel(timeframe);

  return (
    <div className={`dashboard-header${savedOandaProvenance ? ' dashboard-header--saved-oanda' : ''}`}>
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
      {savedOandaProvenance ? <div className="saved-oanda-actions">{onOpenHistory ? <button type="button" onClick={onOpenHistory}>Analysis history</button> : null}{onReturnToMock ? <button type="button" onClick={onReturnToMock}>Return to mock dashboard</button> : null}</div> : null}
      {serviceAvailability && manualRunState && onManualRun ? (
        <LocalServiceControl availability={serviceAvailability} runState={manualRunState} result={manualRunResult ?? null} onRun={onManualRun} onOpenHistory={onOpenHistory} />
      ) : null}
      {!savedOandaProvenance && serviceAvailability === 'available' && onOpenOandaPreview ? <button type="button" onClick={onOpenOandaPreview}>OANDA chart preview</button> : null}
      {!savedOandaProvenance && serviceAvailability === 'available' && oandaStatus ? <OandaStatusBadge status={oandaStatus} /> : null}
    </div>
  );
}
