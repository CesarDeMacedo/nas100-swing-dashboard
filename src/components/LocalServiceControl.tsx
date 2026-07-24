import type { ManualRunResult, ServiceAvailability } from '../serviceClient/localAnalysisService';

type LocalServiceControlProps = {
  availability: 'checking' | ServiceAvailability['kind'];
  runState: 'idle' | 'running' | ManualRunResult['kind'];
  result: ManualRunResult | null;
  onRun: () => void;
  onOpenHistory?: () => void;
};

const statusLabel = (availability: LocalServiceControlProps['availability']) => {
  if (availability === 'checking') return 'Checking service';
  if (availability === 'available') return 'Service online';
  return 'Service unavailable';
};

const runMessage = (result: ManualRunResult | null) => {
  if (!result) return null;
  if (result.kind === 'failed' || result.kind === 'malformed_response') return 'Could not save mock analysis';
  return result.kind === 'already_exists' ? 'Mock analysis already recorded' : 'Mock analysis saved';
};

export function LocalServiceControl({ availability, runState, result, onRun, onOpenHistory }: LocalServiceControlProps) {
  const unavailable = availability === 'unavailable' || availability === 'malformed_response';
  const running = runState === 'running';
  return (
    <section className="local-service-control" aria-label="Synthetic local analysis service" title="Synthetic fixture persistence only">
      <span className={`local-service-control__status local-service-control__status--${availability}`} data-testid="local-service-status">
        <i aria-hidden="true" />
        {statusLabel(availability)}
      </span>
      <button type="button" className="local-service-control__mock-run" onClick={onRun} disabled={running || unavailable}>
        {running ? 'Saving mock analysis' : 'Run mock analysis'}
      </button>
      {onOpenHistory ? <button type="button" className="header-action-button" onClick={onOpenHistory} disabled={unavailable} aria-label="Open analysis history">Analysis history</button> : null}
      {unavailable ? <small className="local-service-control__hint">Start the local analysis service to enable manual persistence.</small> : null}
      {result ? <small className="local-service-control__result" aria-live="polite">{runMessage(result)}</small> : null}
    </section>
  );
}
