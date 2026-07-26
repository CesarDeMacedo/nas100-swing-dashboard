/** One-off script: persists and activates the v15 strategy config decided in the strategy-
 * definition session (docs/MR_LIVE_INTEGRATION_PLAN.md) — Double Seven, daily bars, protective
 * stop 2xATR(14) on NAS100. Clones v12's parameters (the strategy's baseline) with only
 * `meanReversion.protectiveStopAtrMultiple` changed to 2. Goes through
 * `AnalysisRepository.saveStrategyConfig`, the single Zod choke point for writing strategy
 * parameters — never raw SQL.
 *
 * Usage: tsx scripts/persistMrV15Strategy.ts
 */

import { AnalysisRepository, defaultPersistencePath } from '../src/persistence/analysisRepository';
import { loadProjectEnvironmentForServiceCli } from '../src/service/server';

export const MR_STRATEGY_ID = '1cd2f98d-e811-4183-b4e6-0552cb69cd61';
export const V15_NAME = 'v15 - Double Seven D1 stop 2xATR (mesa proprietaria)';
const BASELINE_VERSION = 12;

export function persistAndActivateV15(repository: AnalysisRepository) {
  const existing = repository
    .getStrategyVersions(MR_STRATEGY_ID)
    .find((version) => version.name === V15_NAME);
  if (existing) {
    if (existing.status === 'draft') return repository.activateStrategyVersion(MR_STRATEGY_ID, existing.version);
    return existing;
  }

  const baseline = repository.getStrategyConfigById(`${MR_STRATEGY_ID}:${BASELINE_VERSION}`);
  if (!baseline) {
    throw new Error(`Strategy ${MR_STRATEGY_ID} version ${BASELINE_VERSION} was not found — cannot derive v15 parameters.`);
  }

  const parameters = {
    ...baseline.parameters,
    meanReversion: { ...baseline.parameters.meanReversion, protectiveStopAtrMultiple: 2 },
  };

  const version = repository.getNextStrategyVersion(MR_STRATEGY_ID);
  repository.saveStrategyConfig(MR_STRATEGY_ID, version, { name: V15_NAME, parameters });
  return repository.activateStrategyVersion(MR_STRATEGY_ID, version);
}

function main() {
  loadProjectEnvironmentForServiceCli();
  const repository = new AnalysisRepository(process.env.NAS100_DASHBOARD_DB_PATH ?? defaultPersistencePath());
  try {
    const result = persistAndActivateV15(repository);
    if (result.status === 'active') {
      console.log(`Activated strategy ${result.strategyId} version ${result.version} ("${result.name}").`);
    } else {
      console.log(`Strategy ${result.strategyId} version ${result.version} ("${result.name}") already exists with status "${result.status}" — left untouched (only a draft is auto-activated).`);
    }
    console.log(`meanReversion.protectiveStopAtrMultiple = ${result.parameters.meanReversion.protectiveStopAtrMultiple}`);
  } finally {
    repository.close();
  }
}

if (process.argv[1]?.endsWith('persistMrV15Strategy.ts')) {
  main();
}
