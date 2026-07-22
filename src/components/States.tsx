import { LoaderCircle, RotateCcw, ShieldAlert } from 'lucide-react';

type ErrorStateProps = {
  title?: string;
  detail?: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = 'Analysis data unavailable',
  detail = 'The analysis object could not be validated. No trading view is shown.',
  onRetry,
}: ErrorStateProps) {
  return (
    <section className="state-panel state-panel--error" role="alert" data-testid="error-state">
      <ShieldAlert aria-hidden="true" size={42} />
      <div>
        <p className="state-panel__eyebrow">Safe state</p>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {onRetry ? (
        <button type="button" className="state-panel__action" onClick={onRetry}>
          <RotateCcw aria-hidden="true" size={16} />
          Retry validation
        </button>
      ) : null}
    </section>
  );
}

export function LoadingState({ label = 'Validating local analysis' }: { label?: string }) {
  return (
    <section className="state-panel" aria-live="polite" data-testid="loading-state">
      <LoaderCircle className="state-panel__spinner" aria-hidden="true" size={38} />
      <div>
        <p className="state-panel__eyebrow">Local analysis</p>
        <h1>{label}</h1>
      </div>
    </section>
  );
}
