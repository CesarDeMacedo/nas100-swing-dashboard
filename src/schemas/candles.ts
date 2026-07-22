import { z } from 'zod';

import { TimeframeSchema } from './enums';
import { NonEmptyStringSchema, PositivePriceSchema, TimestampSchema } from './primitives';
import { SchemaVersionSchema } from './version';

export const CandleSchema = z
  .object({
    time: TimestampSchema,
    open: PositivePriceSchema,
    high: PositivePriceSchema,
    low: PositivePriceSchema,
    close: PositivePriceSchema,
    isClosed: z.boolean(),
    volume: z.number().finite().nonnegative().optional(),
    source: NonEmptyStringSchema.optional(),
    instrument: NonEmptyStringSchema.optional(),
    timeframe: TimeframeSchema.optional(),
  })
  .superRefine((candle, context) => {
    if (candle.high < Math.max(candle.open, candle.close)) {
      context.addIssue({
        code: 'custom',
        message: 'Candle high must be greater than or equal to open and close',
        path: ['high'],
      });
    }

    if (candle.low > Math.min(candle.open, candle.close)) {
      context.addIssue({
        code: 'custom',
        message: 'Candle low must be less than or equal to open and close',
        path: ['low'],
      });
    }

    if (candle.high < candle.low) {
      context.addIssue({
        code: 'custom',
        message: 'Candle high must be greater than or equal to candle low',
        path: ['high'],
      });
    }
  });

export const CandleDatasetSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    datasetId: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    isSynthetic: z.boolean(),
    timezone: z.literal('America/Toronto'),
    instrument: NonEmptyStringSchema,
    timeframe: TimeframeSchema,
    generatedFor: NonEmptyStringSchema.optional(),
    candles: z.array(CandleSchema).min(1),
  })
  .superRefine((dataset, context) => {
    const seen = new Set<string>();

    dataset.candles.forEach((candle, index) => {
      if (seen.has(candle.time)) {
        context.addIssue({
          code: 'custom',
          message: 'Candle timestamps must be unique',
          path: ['candles', index, 'time'],
        });
      }
      seen.add(candle.time);

      const previous = dataset.candles[index - 1];
      if (previous && Date.parse(candle.time) <= Date.parse(previous.time)) {
        context.addIssue({
          code: 'custom',
          message: 'Candles must be in ascending timestamp order',
          path: ['candles', index, 'time'],
        });
      }

      if (candle.instrument && candle.instrument !== dataset.instrument) {
        context.addIssue({
          code: 'custom',
          message: 'Candle instrument must match its dataset',
          path: ['candles', index, 'instrument'],
        });
      }

      if (candle.timeframe && candle.timeframe !== dataset.timeframe) {
        context.addIssue({
          code: 'custom',
          message: 'Candle timeframe must match its dataset',
          path: ['candles', index, 'timeframe'],
        });
      }
    });
  });

export type Candle = z.infer<typeof CandleSchema>;
export type CandleDataset = z.infer<typeof CandleDatasetSchema>;
