import currentAnalysis from '../../mock/current-analysis.json';

import { parseAnalysis } from './analysis';
import { CURRENT_SCHEMA_VERSION } from '../schemas';
import { prepareVersionedInput, UnsupportedSchemaVersionError } from './versioning';

describe('schema versioning boundary', () => {
  it('accepts the current schema version without migration', () => {
    const result = prepareVersionedInput(currentAnalysis);

    expect(result.success).toBe(true);
    if (result.success) expect(result.appliedMigrations).toEqual([]);
    expect(currentAnalysis.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('rejects unsupported future versions safely', () => {
    const source = { ...structuredClone(currentAnalysis), schemaVersion: '9.0.0' };
    const result = prepareVersionedInput(source);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeInstanceOf(UnsupportedSchemaVersionError);
    expect(parseAnalysis(source).success).toBe(false);
  });

  it('leaves missing versions for the authoritative schema to reject', () => {
    const source = structuredClone(currentAnalysis) as Record<string, unknown>;
    delete source.schemaVersion;

    expect(prepareVersionedInput(source).success).toBe(true);
    expect(parseAnalysis(source).success).toBe(false);
  });
});
