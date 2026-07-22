import { z } from 'zod';

import { TimeframeSchema } from './enums';
import { NonEmptyStringSchema } from './primitives';
import { SchemaVersionSchema } from './version';

const ReviewTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Expected a 24-hour HH:mm review time');

export const ApplicationSettingsSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  timezone: z.literal('America/Toronto'),
  timeframe: TimeframeSchema,
  scheduledReviewTimes: z.array(ReviewTimeSchema).min(1),
  minimumRewardRisk: z.number().finite().min(2),
  staleDataThresholdMinutes: z.number().int().positive(),
  preferredInstrument: NonEmptyStringSchema,
  notificationsEnabled: z.boolean(),
  exportDirectory: NonEmptyStringSchema.nullable(),
});

export type ApplicationSettings = z.infer<typeof ApplicationSettingsSchema>;
