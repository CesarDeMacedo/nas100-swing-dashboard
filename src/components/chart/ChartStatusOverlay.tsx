import { CheckCircle2, Clock3 } from 'lucide-react';

export function ChartStatusOverlay({ isClosed }: { isClosed: boolean }) {
  const Icon = isClosed ? CheckCircle2 : Clock3;

  return (
    <div
      className={`chart-status-overlay chart-status-overlay--${isClosed ? 'completed' : 'open'}`}
      data-testid="latest-candle-status"
    >
      <Icon aria-hidden="true" size={14} />
      <span>{isClosed ? 'Completed H4' : 'Open H4 - unconfirmed'}</span>
    </div>
  );
}
