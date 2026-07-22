import { z } from 'zod';

import { CandleDatasetSchema, CandleSchema, type Candle, type CandleDataset } from '../schemas';
import { normalizeCandleDatasetInput } from './normalization';
import { prepareVersionedInput, type UnsupportedSchemaVersionError } from './versioning';

export { CandleDatasetSchema, CandleSchema };
export type { Candle, CandleDataset };

export type CandleDatasetParseResult =
  | { success: true; dataset: CandleDataset; appliedMigrations: string[] }
  | { success: false; error: z.ZodError<CandleDataset> | UnsupportedSchemaVersionError };

export function parseCandleDataset(source: unknown): CandleDatasetParseResult {
  const versioned = prepareVersionedInput(source);
  if (!versioned.success) return versioned;

  const normalized = normalizeCandleDatasetInput(versioned.value);
  const parsed = CandleDatasetSchema.safeParse(normalized);

  return parsed.success
    ? {
        success: true,
        dataset: parsed.data,
        appliedMigrations: versioned.appliedMigrations,
      }
    : { success: false, error: parsed.error };
}
