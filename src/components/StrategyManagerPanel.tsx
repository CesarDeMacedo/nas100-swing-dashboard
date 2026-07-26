import { useEffect, useState } from 'react';

import type { StrategyConfig, StrategyDetailResult, StrategyListResult, StrategyMutationResult, StrategyParameters } from '../serviceClient/localAnalysisService';

type StrategyManagerPanelProps = {
  open: boolean;
  list: StrategyListResult | { kind: 'loading' } | null;
  detail: StrategyDetailResult | { kind: 'loading' } | null;
  selectedStrategyId: string | null;
  createState: 'idle' | 'running' | StrategyMutationResult['kind'];
  createResult: StrategyMutationResult | null;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (strategyId: string) => void;
  onCreate: (name: string, parameters: StrategyParameters) => void;
  onCreateVersion: (strategyId: string, name: string, parameters: StrategyParameters) => void;
  onActivate: (strategyId: string, version: number) => void;
};

/** Every field a strategy actually threads through the pipeline (see
 * src/domain/strategyParameters.ts) — this is the app's only default; the floor on
 * minRewardRisk is enforced server-side (>= 2.0), this default just starts a new draft
 * at today's hardcoded behavior so a first save changes nothing unless the user edits it. */
const DEFAULT_PARAMETERS: StrategyParameters = {
  minRewardRisk: 2,
  premiumScoreThreshold: 70,
  atrLocationTolerance: 0.35,
  atrTriggerBuffer: 0.05,
  atrStopBuffer: 0.25,
  atrInvalidationBuffer: 0.1,
  crossMarketPrimaryInstruments: ['us500', 'us30'],
  setupScoreWeights: { trend: 20, structure: 20, momentum: 15, location: 15, crossMarket: 10, eventRisk: 5, rewardRisk: 10, patienceReadiness: 5 },
  eventRisk: { blockingWindowMinutes: 60, minImpact: 'High' },
};

const weightsSum = (weights: StrategyParameters['setupScoreWeights']) =>
  weights.trend + weights.structure + weights.momentum + weights.location + weights.crossMarket + weights.eventRisk + weights.rewardRisk + weights.patienceReadiness;

const CROSS_MARKET_KEYS = ['us500', 'us30', 'russell2000'] as const;

function ParametersForm({ initial, onSubmit, submitLabel }: { initial: StrategyParameters; onSubmit: (name: string, parameters: StrategyParameters) => void; submitLabel: string }) {
  const [name, setName] = useState('');
  const [parameters, setParameters] = useState<StrategyParameters>(initial);
  const sum = weightsSum(parameters.setupScoreWeights);
  const rrTooLow = parameters.minRewardRisk < 2;

  const setWeight = (key: keyof StrategyParameters['setupScoreWeights'], value: number) =>
    setParameters((current) => ({ ...current, setupScoreWeights: { ...current.setupScoreWeights, [key]: value } }));

  const toggleCrossMarketPrimary = (key: (typeof CROSS_MARKET_KEYS)[number]) =>
    setParameters((current) => ({
      ...current,
      crossMarketPrimaryInstruments: current.crossMarketPrimaryInstruments.includes(key)
        ? current.crossMarketPrimaryInstruments.filter((entry) => entry !== key)
        : [...current.crossMarketPrimaryInstruments, key],
    }));

  return (
    <form
      className="history-detail"
      onSubmit={(event) => {
        event.preventDefault();
        if (rrTooLow || sum !== 100 || !name.trim()) return;
        onSubmit(name.trim(), parameters);
      }}
    >
      <dl>
        <div>
          <dt>Name</dt>
          <dd><input aria-label="Strategy name" value={name} onChange={(event) => setName(event.target.value)} required /></dd>
        </div>
        <div>
          <dt>Min R:R</dt>
          <dd>
            <input aria-label="Minimum reward to risk" type="number" step="0.1" min="2" value={parameters.minRewardRisk} onChange={(event) => setParameters((current) => ({ ...current, minRewardRisk: Number(event.target.value) }))} />
            {rrTooLow ? <span role="alert"> Must be at least 2.0 — this is a floor, not a target.</span> : null}
          </dd>
        </div>
        <div>
          <dt>Premium score threshold</dt>
          <dd><input aria-label="Premium score threshold" type="number" min="0" max="100" value={parameters.premiumScoreThreshold} onChange={(event) => setParameters((current) => ({ ...current, premiumScoreThreshold: Number(event.target.value) }))} /></dd>
        </div>
        <div>
          <dt>Cross-market primary</dt>
          <dd>
            {CROSS_MARKET_KEYS.map((key) => (
              <label key={key} style={{ marginRight: 10 }}>
                <input type="checkbox" checked={parameters.crossMarketPrimaryInstruments.includes(key)} onChange={() => toggleCrossMarketPrimary(key)} /> {key}
              </label>
            ))}
          </dd>
        </div>
        <div>
          <dt>Setup score weights</dt>
          <dd>
            {(Object.keys(parameters.setupScoreWeights) as (keyof StrategyParameters['setupScoreWeights'])[]).map((key) => (
              <label key={key} style={{ display: 'inline-block', marginRight: 8 }}>
                {key}
                <input aria-label={`${key} weight`} type="number" min="0" value={parameters.setupScoreWeights[key]} onChange={(event) => setWeight(key, Number(event.target.value))} style={{ width: 52, marginLeft: 4 }} />
              </label>
            ))}
            <div>Sum: {sum}/100{sum !== 100 ? <span role="alert"> must equal 100</span> : null}</div>
          </dd>
        </div>
      </dl>
      <button type="submit" disabled={rrTooLow || sum !== 100 || !name.trim()}>{submitLabel}</button>
    </form>
  );
}

function VersionsList({ versions, onActivate }: { versions: StrategyConfig[]; onActivate: (strategyId: string, version: number) => void }) {
  return (
    <div className="history-list">
      {[...versions].sort((a, b) => b.version - a.version).map((version) => (
        <div key={version.id} className="history-row">
          <strong>{version.name} v{version.version}</strong>
          <span>{version.status} | Min R:R {version.parameters.minRewardRisk.toFixed(1)}</span>
          {version.status === 'draft' ? <button type="button" onClick={() => onActivate(version.strategyId, version.version)}>Activate</button> : null}
        </div>
      ))}
    </div>
  );
}

export function StrategyManagerPanel({ open, list, detail, selectedStrategyId, createState, createResult, onClose, onRefresh, onSelect, onCreate, onCreateVersion, onActivate }: StrategyManagerPanelProps) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (createState === 'succeeded') {
      setCreatingNew(false);
      setCreatingVersion(false);
    }
  }, [createState]);

  if (!open) return null;

  // Distinct strategies by strategyId, showing each one's highest version as the summary row.
  const strategySummaries =
    list?.kind === 'succeeded'
      ? Object.values(
          list.strategies.reduce<Record<string, StrategyConfig>>((byStrategy, strategy) => {
            const current = byStrategy[strategy.strategyId];
            if (!current || strategy.version > current.version) byStrategy[strategy.strategyId] = strategy;
            return byStrategy;
          }, {}),
        )
      : [];

  return (
    <div className="history-overlay" role="presentation">
      <aside className="history-panel" role="dialog" aria-modal="true" aria-label="Manage strategies">
        <header>
          <div><span>Local records</span><h2>Strategies</h2></div>
          <div>
            <button type="button" onClick={onRefresh}>Refresh</button>
            <button type="button" onClick={onClose} aria-label="Close strategy manager" autoFocus>Close</button>
          </div>
        </header>
        <div className="history-panel__content">
          {list?.kind === 'loading' ? <p>Loading strategies...</p> : null}
          {list?.kind === 'failed' || list?.kind === 'malformed_response' ? <p>{list.message}</p> : null}
          {list?.kind === 'succeeded' && strategySummaries.length === 0 && !creatingNew ? <p>No strategies yet.</p> : null}
          {list?.kind === 'succeeded' ? (
            <div className="history-list">
              {strategySummaries.map((strategy) => (
                <button key={strategy.strategyId} className={`history-row${selectedStrategyId === strategy.strategyId ? ' history-row--selected' : ''}`} type="button" onClick={() => onSelect(strategy.strategyId)}>
                  <strong>{strategy.name}</strong>
                  <span>v{strategy.version} | {strategy.status} | Min R:R {strategy.parameters.minRewardRisk.toFixed(1)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {!creatingNew ? <button type="button" onClick={() => setCreatingNew(true)}>Create new strategy</button> : null}
          {creatingNew ? <ParametersForm initial={DEFAULT_PARAMETERS} submitLabel="Create strategy" onSubmit={onCreate} /> : null}
          {createResult?.kind === 'validation_failed' || createResult?.kind === 'failed' ? <p role="alert">{createResult.message}</p> : null}

          {detail?.kind === 'loading' ? <p>Loading strategy...</p> : null}
          {detail?.kind === 'failed' || detail?.kind === 'malformed_response' ? <p>{detail.message}</p> : null}
          {detail?.kind === 'succeeded' ? (
            <section className="history-detail" aria-label="Strategy versions">
              <strong>{detail.strategyId}</strong>
              <VersionsList versions={detail.versions} onActivate={onActivate} />
              {!creatingVersion ? <button type="button" onClick={() => setCreatingVersion(true)}>Duplicate as new draft version</button> : null}
              {creatingVersion ? (
                <ParametersForm
                  initial={detail.versions.at(-1)?.parameters ?? DEFAULT_PARAMETERS}
                  submitLabel="Save new draft version"
                  onSubmit={(name, parameters) => onCreateVersion(detail.strategyId, name, parameters)}
                />
              ) : null}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
