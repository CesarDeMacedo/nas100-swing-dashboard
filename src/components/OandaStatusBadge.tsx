import type { OandaProviderStatus } from '../serviceClient/localAnalysisService';

type OandaStatusBadgeProps = {
  status: 'checking' | OandaProviderStatus;
};

const badgeVariant = (status: OandaStatusBadgeProps['status']) => {
  if (status === 'checking') return 'checking';
  if (status.kind === 'configured') return status.configuredInstrument ? 'ready' : 'partial';
  if (status.kind === 'unconfigured') return 'unconfigured';
  return 'error';
};

const badgeLabel = (status: OandaStatusBadgeProps['status']) => {
  if (status === 'checking') return 'Checking OANDA status';
  if (status.kind === 'configured') return status.configuredInstrument ? 'OANDA ready' : 'OANDA configured, no instrument set';
  if (status.kind === 'unconfigured') return 'OANDA not configured';
  if (status.kind === 'invalid') return 'OANDA configuration invalid';
  return 'OANDA status unavailable';
};

/**
 * Distinguishes "not configured" (the normal default state — no credentials set, nothing
 * wrong) from "invalid"/"unavailable" (a real problem needing attention). Previously the
 * only signal a user got was an inline error after clicking a manual OANDA action; this
 * consumes GET /providers/oanda/status (already credential-safe) to surface it passively.
 */
export function OandaStatusBadge({ status }: OandaStatusBadgeProps) {
  const variant = badgeVariant(status);
  return (
    <span className={`oanda-status-badge oanda-status-badge--${variant}`} data-testid="oanda-status-badge">
      <i aria-hidden="true" />
      {badgeLabel(status)}
    </span>
  );
}
