import type { Analysis } from '../domain/analysis';
import { formatTimeframeLabel } from '../lib/format';
import { formatPrice } from '../lib/format';
import type { ManualRunResult, OandaProviderStatus, ServiceAvailability } from '../serviceClient/localAnalysisService';
import { LocalServiceControl } from './LocalServiceControl';
import { OandaManualRunControl } from './OandaManualRunControl';
import { OandaStatusBadge } from './OandaStatusBadge';

type DashboardHeaderProps = Pick<Analysis, 'displayName' | 'instrument' | 'timeframe'> & {
  serviceAvailability?: 'checking' | ServiceAvailability['kind'];
  manualRunState?: 'idle' | 'running' | ManualRunResult['kind'];
  manualRunResult?: ManualRunResult | null;
  onManualRun?: () => void;
  onOpenHistory?: () => void;
  onOpenStrategies?: () => void;
  onOpenBacktests?: () => void;
  savedOandaProvenance?: string | null;
  savedSourceCandleTime?: string | null;
  onReturnToMock?: () => void;
  onOpenOandaPreview?: () => void;
  liveObservationStatus?: string | null;
  liveObservationPrice?: number | null;
  oandaStatus?: 'checking' | OandaProviderStatus;
  oandaManualRunState?: 'idle' | 'running' | ManualRunResult['kind'];
  oandaManualRunResult?: ManualRunResult | null;
  onRunOandaNow?: () => void;
};

export function DashboardHeader({ displayName, instrument, timeframe, serviceAvailability, manualRunState, manualRunResult, onManualRun, onOpenHistory, onOpenStrategies, onOpenBacktests, savedOandaProvenance, savedSourceCandleTime, onReturnToMock, onOpenOandaPreview, liveObservationStatus, liveObservationPrice, oandaStatus, oandaManualRunState, oandaManualRunResult, onRunOandaNow }: DashboardHeaderProps) {
  const oandaConfigured = typeof oandaStatus === 'object' && oandaStatus.kind === 'configured';
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
      <div className="dashboard-header__actions">
        <div className="saved-oanda-actions">
          {onOpenStrategies ? <button type="button" className="header-action-button" onClick={onOpenStrategies}>Strategies</button> : null}
          {onOpenBacktests ? <button type="button" className="header-action-button" onClick={onOpenBacktests}>Backtests</button> : null}
        </div>
        {savedOandaProvenance ? (
          <div className="saved-oanda-actions">
            {onOpenHistory ? <button type="button" className="header-action-button" onClick={onOpenHistory}>Analysis history</button> : null}
            {onReturnToMock ? <button type="button" className="header-action-button" onClick={onReturnToMock}>Return to mock dashboard</button> : null}
          </div>
        ) : null}
        {serviceAvailability && manualRunState && onManualRun ? (
          <LocalServiceControl availability={serviceAvailability} runState={manualRunState} result={manualRunResult ?? null} onRun={onManualRun} onOpenHistory={onOpenHistory} />
        ) : null}
        {!savedOandaProvenance && serviceAvailability === 'available' ? (
          <div className="dashboard-header__oanda-actions">
            {oandaStatus ? <OandaStatusBadge status={oandaStatus} /> : null}
            {oandaConfigured && oandaManualRunState && onRunOandaNow ? (
              <OandaManualRunControl runState={oandaManualRunState} result={oandaManualRunResult ?? null} onRun={onRunOandaNow} />
            ) : null}
            {onOpenOandaPreview ? <button type="button" className="header-action-button" onClick={onOpenOandaPreview}>OANDA chart preview</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
