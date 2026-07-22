import { formatEnum } from '../lib/format';

type SetupSummaryProps = {
  score: number | null;
  grade: string | null;
  dailyRegime: string;
  status: string;
  bias: string;
  confidence: number;
  isActionable?: boolean;
  premiumSetupState?: string;
};

const premiumSetupLabel = (state?: string) => {
  switch (state) {
    case 'confirmed_entry':
      return 'Confirmed premium setup';
    case 'high_quality_forming':
      return 'High-quality setup forming';
    case 'high_quality_waiting_confirmation':
      return 'High-quality setup awaiting confirmation';
    case 'high_quality_blocked':
      return 'High technical score, blocked';
    case 'below_threshold':
      return 'Below premium threshold';
    default:
      return 'Score unavailable';
  }
};

export function SetupSummary({
  score,
  grade,
  dailyRegime,
  status,
  bias,
  confidence,
  isActionable,
  premiumSetupState,
}: SetupSummaryProps) {
  return (
    <section className="setup-summary" aria-label="Setup summary">
      <div className="setup-summary__primary">
        <span>Setup score</span>
        <strong data-testid="summary-score">{score ?? 'Not available'}</strong>
        <small>/ 100</small>
      </div>
      <div className="setup-summary__primary">
        <span>Grade</span>
        <strong data-testid="summary-grade">{grade ?? 'Not available'}</strong>
        <small data-testid="summary-actionability">
          {isActionable === undefined
            ? `${confidence}% confidence`
            : isActionable
              ? 'Actionable'
              : premiumSetupLabel(premiumSetupState)}
        </small>
      </div>
      <div className="setup-summary__wide">
        <span>Market regime</span>
        <strong>{formatEnum(dailyRegime)}</strong>
      </div>
      <div className="setup-summary__secondary">
        <span>Status</span>
        <strong>{formatEnum(status)}</strong>
      </div>
      <div className="setup-summary__secondary">
        <span>Bias</span>
        <strong>{formatEnum(bias)}</strong>
      </div>
    </section>
  );
}
