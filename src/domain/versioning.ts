import { CURRENT_SCHEMA_VERSION } from '../schemas';

export class UnsupportedSchemaVersionError extends Error {
  readonly version: unknown;

  constructor(version: unknown) {
    super(`Unsupported schema version: ${String(version)}`);
    this.name = 'UnsupportedSchemaVersionError';
    this.version = version;
  }
}

export type Migration = (source: Record<string, unknown>) => Record<string, unknown>;

// Add pure, one-version-at-a-time migrations here when a prior version is supported.
export const ANALYSIS_MIGRATIONS: Readonly<Record<string, Migration>> = Object.freeze({});

export type VersionPreparationResult =
  | { success: true; value: unknown; appliedMigrations: string[] }
  | { success: false; error: UnsupportedSchemaVersionError };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function prepareVersionedInput(source: unknown): VersionPreparationResult {
  if (!isRecord(source) || source.schemaVersion === undefined) {
    return { success: true, value: source, appliedMigrations: [] };
  }

  if (source.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return { success: true, value: source, appliedMigrations: [] };
  }

  const migration =
    typeof source.schemaVersion === 'string'
      ? ANALYSIS_MIGRATIONS[source.schemaVersion]
      : undefined;

  if (!migration) {
    return { success: false, error: new UnsupportedSchemaVersionError(source.schemaVersion) };
  }

  const migrated = migration(source);
  return {
    success: true,
    value: migrated,
    appliedMigrations: [`${String(source.schemaVersion)}->${CURRENT_SCHEMA_VERSION}`],
  };
}
