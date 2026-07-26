import { useState } from 'react';

type RunBacktestControlProps = {
  defaultInstrument?: string;
};

/** Per the confirmed v1 decision, this does NOT trigger a backtest over HTTP — it only
 * builds the exact CLI command for the operator to copy and run themselves. Keeps the
 * backtest harness genuinely isolated from the production web service (no child-process
 * spawning/job-queue to design and maintain here). */
export function RunBacktestControl({ defaultInstrument = 'NAS100_USD' }: RunBacktestControlProps) {
  const [strategyConfigId, setStrategyConfigId] = useState('');
  const [instrument, setInstrument] = useState(defaultInstrument);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [copied, setCopied] = useState(false);

  const command = `tsx scripts/backtest/runBacktest.ts --strategy ${strategyConfigId || '<strategyConfigId>'} --instrument ${instrument} --from ${from || '<YYYY-MM-DD>'} --to ${to || '<YYYY-MM-DD>'}`;

  return (
    <div className="oanda-manual-run-control">
      <label>
        Strategy config id
        <input aria-label="Strategy config id" value={strategyConfigId} onChange={(event) => setStrategyConfigId(event.target.value)} placeholder="strategyId:version" />
      </label>
      <label>
        Instrument
        <input aria-label="Backtest instrument" value={instrument} onChange={(event) => setInstrument(event.target.value)} />
      </label>
      <label>
        From
        <input aria-label="Backtest range start" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
      </label>
      <label>
        To
        <input aria-label="Backtest range end" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </label>
      <pre aria-label="Backtest CLI command">{command}</pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(command);
          setCopied(true);
        }}
      >
        Copy command
      </button>
      {copied ? <small className="oanda-manual-run-control__result" aria-live="polite">Command copied — run it in a terminal to start the backtest.</small> : null}
    </div>
  );
}
