import type { ManualRunResult } from '../serviceClient/localAnalysisService';

type OandaManualRunControlProps = {
  runState: 'idle' | 'running' | ManualRunResult['kind'];
  result: ManualRunResult | null;
  onRun: () => void;
};

const runMessage = (result: ManualRunResult | null) => {
  if (!result) return null;
  if (result.kind === 'failed' || result.kind === 'malformed_response') return 'Could not run OANDA analysis.';
  return result.kind === 'already_exists'
    ? 'Already analyzed this H4 candle — no new run needed.'
    : 'OANDA analysis run saved.';
};

export function OandaManualRunControl({ runState, result, onRun }: OandaManualRunControlProps) {
  const running = runState === 'running';
  return (
    <div className="oanda-manual-run-control">
      <button type="button" onClick={onRun} disabled={running} aria-label="Run OANDA analysis now">
        {running ? 'Running OANDA analysis…' : 'Run OANDA analysis now'}
      </button>
      {result ? (
        <small className="oanda-manual-run-control__result" aria-live="polite">
          {runMessage(result)}
        </small>
      ) : null}
    </div>
  );
}
