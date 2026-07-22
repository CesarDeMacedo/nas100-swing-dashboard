const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const canonicalToken = (value: unknown): unknown =>
  typeof value === 'string'
    ? value
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_')
        .replace(/__+/g, '_')
    : value;

export const normalizeTimeframe = (value: unknown): unknown => {
  const token = canonicalToken(value);
  return token === '4H' || token === 'H4' ? 'H4' : token;
};

export const normalizeAction = (value: unknown): unknown => {
  const token = canonicalToken(value);

  if (token === 'WAIT_FOR_NEXT_H4_CLOSE') return 'WAIT_FOR_NEXT_4H_CLOSE';
  return token;
};

export const normalizeTimestamp = (value: unknown): unknown => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return value;
  return new Date(value).toISOString();
};

const normalizeStringArray = (value: unknown): unknown => (value === undefined ? [] : value);

const normalizeZone = (value: unknown, fallbackType?: string): unknown => {
  if (!isRecord(value)) return value;

  return {
    ...value,
    type: canonicalToken(value.type ?? fallbackType),
  };
};

const normalizeInstrumentSnapshot = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  return {
    ...value,
    confirmation: canonicalToken(value.confirmation),
    dataFreshness: canonicalToken(value.dataFreshness),
    completedCandleAt: normalizeTimestamp(value.completedCandleAt),
    notes: normalizeStringArray(value.notes),
  };
};

const normalizeCrossMarket = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  return {
    ...value,
    us500: normalizeInstrumentSnapshot(value.us500),
    us30: normalizeInstrumentSnapshot(value.us30),
    russell2000: normalizeInstrumentSnapshot(value.russell2000),
    confirmationStatus: canonicalToken(value.confirmationStatus),
    dataFreshness: canonicalToken(value.dataFreshness),
    notes: normalizeStringArray(value.notes),
  };
};

const normalizeEventRisk = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  return {
    ...value,
    status: canonicalToken(value.status),
    severity: canonicalToken(value.severity),
    eventTime: normalizeTimestamp(value.eventTime),
    freshness: canonicalToken(value.freshness),
    notes: normalizeStringArray(value.notes),
  };
};

const normalizeDataHealth = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  return {
    ...value,
    status: canonicalToken(value.status),
    providerStatus: canonicalToken(value.providerStatus),
    lastSuccessfulUpdate: normalizeTimestamp(value.lastSuccessfulUpdate),
    latestExpectedCandleTime: normalizeTimestamp(value.latestExpectedCandleTime),
    latestAvailableCandleTime: normalizeTimestamp(value.latestAvailableCandleTime),
    validationErrors: normalizeStringArray(value.validationErrors),
    warnings: normalizeStringArray(value.warnings),
  };
};

export function normalizeAnalysisInput(source: unknown): unknown {
  if (!isRecord(source)) return source;

  const eventRisk = source.eventRisk === undefined ? [] : source.eventRisk;

  return {
    ...source,
    generatedAt: normalizeTimestamp(source.generatedAt),
    completedCandleAt: normalizeTimestamp(source.completedCandleAt),
    timeframe: normalizeTimeframe(source.timeframe),
    dataFreshness: canonicalToken(source.dataFreshness),
    latestCandleStatus: canonicalToken(source.latestCandleStatus),
    dailyRegime: canonicalToken(source.dailyRegime),
    h4Structure: canonicalToken(source.h4Structure),
    bias: canonicalToken(source.bias),
    status: canonicalToken(source.status),
    action: normalizeAction(source.action),
    grade: canonicalToken(source.grade),
    supportZones: Array.isArray(source.supportZones)
      ? source.supportZones.map((zone) => normalizeZone(zone, 'SUPPORT'))
      : source.supportZones,
    resistanceZones: Array.isArray(source.resistanceZones)
      ? source.resistanceZones.map((zone) => normalizeZone(zone, 'RESISTANCE'))
      : source.resistanceZones,
    preferredEntryZone:
      source.preferredEntryZone === undefined
        ? undefined
        : normalizeZone(source.preferredEntryZone, 'ENTRY'),
    whyNoEntry: normalizeStringArray(source.whyNoEntry),
    whatToDoNext: normalizeStringArray(source.whatToDoNext),
    marketContext: normalizeStringArray(source.marketContext),
    crossMarket: normalizeCrossMarket(source.crossMarket),
    eventRisk: Array.isArray(eventRisk) ? eventRisk.map(normalizeEventRisk) : eventRisk,
    dataHealth: normalizeDataHealth(source.dataHealth),
    targets: source.targets === undefined ? [] : source.targets,
    candlesReference: isRecord(source.candlesReference)
      ? {
          ...source.candlesReference,
          timeframe: normalizeTimeframe(source.candlesReference.timeframe),
          latestCandleTime: normalizeTimestamp(source.candlesReference.latestCandleTime),
        }
      : source.candlesReference,
  };
}

export function normalizeCandleDatasetInput(source: unknown): unknown {
  if (!isRecord(source)) return source;

  return {
    ...source,
    timeframe: normalizeTimeframe(source.timeframe),
    candles: Array.isArray(source.candles)
      ? source.candles.map((candle) =>
          isRecord(candle)
            ? {
                ...candle,
                time: normalizeTimestamp(candle.time),
                timeframe:
                  candle.timeframe === undefined ? undefined : normalizeTimeframe(candle.timeframe),
              }
            : candle,
        )
      : source.candles,
  };
}
