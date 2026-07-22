import { z } from 'zod';

const RFC3339_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const TimestampSchema = z
  .string()
  .regex(RFC3339_WITH_OFFSET, 'Expected an RFC 3339 timestamp with timezone offset')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected a valid timestamp');

export const PositivePriceSchema = z.number().finite().positive();
export const PercentageSchema = z.number().finite().min(0).max(100);
export const NonEmptyStringSchema = z.string().trim().min(1);
export const StringListSchema = z.array(NonEmptyStringSchema);
