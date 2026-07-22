import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = '1.0.0' as const;
export const SchemaVersionSchema = z.literal(CURRENT_SCHEMA_VERSION);

export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;
