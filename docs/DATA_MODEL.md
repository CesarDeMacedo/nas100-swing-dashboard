# Data Model

## Current runtime guarantees

Reports and runs are immutable local records. OANDA H4 and Daily candle datasets remain separate, and only completed candles can support confirmed report decisions. Saved OANDA display snapshots contain non-sensitive chart/report data for historical dashboard review; Chart Preview data is on-demand and is not persisted. No schema contains trade execution capability, browser credentials, or broker-order data.

## Phase 3 status

Phase 3 is implemented. Runtime contracts live in `src/schemas/`; TypeScript types are inferred from Zod. The existing `src/domain/analysis.ts` and `src/domain/candles.ts` modules are thin parsing and compatibility boundaries, not competing schema definitions.

The current schema version is semantic version `1.0.0`. Both committed JSON fixtures carry that version and validate through the same contracts used by the application.

## Contract principles

- Zod schemas are the runtime source of truth; do not maintain parallel interfaces.
- Raw analysis and candle JSON are normalized and parsed once at the application boundary.
- Presentation components receive validated `AnalysisReport` and `CandleDataset` values only.
- Missing prices, scores, indicator values, or candle-completion state are never fabricated.
- Timestamps are RFC 3339 with `Z` or a numeric offset and are normalized to UTC ISO strings.
- `America/Toronto` is the official application timezone and `H4` is the canonical timeframe.
- Unsafe entry input is converted to a safe display action after structural validation.
- The dashboard is analysis-only and no schema contains broker-order or execution fields.

## Schema locations

```text
src/schemas/version.ts       current semantic schema version
src/schemas/enums.ts         centralized enum values, schemas, inferred unions
src/schemas/primitives.ts    timestamp, percentage, price, and text primitives
src/schemas/candles.ts       Candle and CandleDataset
src/schemas/analysis.ts      AnalysisReport and nested market/report schemas
src/schemas/settings.ts      ApplicationSettings
src/schemas/index.ts         public schema exports
src/domain/normalization.ts  deterministic input normalization
src/domain/versioning.ts     version gate and future migration registry
src/domain/safety.ts         non-strategy entry safety enforcement
src/domain/analysis.ts       version -> normalize -> validate -> safety pipeline
src/domain/candles.ts        version -> normalize -> validate pipeline
```

## Central enums

The following literal sets are defined only in `src/schemas/enums.ts`:

- `Action`: `BUY`, `SELL`, `WAIT`, `NO_TRADE`, `WAIT_FOR_PULLBACK`, `WAIT_FOR_NEXT_4H_CLOSE`.
- `SetupStatus`: forming, confirmed, invalidated, awaiting-close, blocked, no-setup, and unavailable states.
- `Bias`: bullish, bearish, neutral, and cautious variants.
- `DailyRegime`: bullish, bearish, defensive variants, neutral, and transitional.
- `H4Structure`: pullback, continuation, breakout/breakdown, range, and unknown.
- `CandleStatus`: `COMPLETED`, `OPEN`, `UNKNOWN`.
- `DataFreshness`: `FRESH`, `STALE`, `MISSING`, `INVALID`, `MOCK`.
- `DataHealthStatus`: `HEALTHY`, `DEGRADED`, `STALE`, `INVALID`, `UNAVAILABLE`.
- `ProviderStatus`: healthy, degraded, unavailable, unconfigured, or mock.
- `EventRiskSeverity`: none through blocking.
- `ZoneType`: support, resistance, entry, invalidation, or target.
- `SetupGrade`: `D`, `C`, `C+`, `B`, `A`, `A+`.
- Cross-market confirmation and instrument enums for US500, US30, and Russell 2000.

## AnalysisReport

`AnalysisReportSchema` includes:

- identity and version: `schemaVersion`, `strategyVersion`, `id`;
- time and market identity: `generatedAt`, `completedCandleAt`, `officialTimezone`, `instrument`, `displayName`, `timeframe`;
- provenance and health: `dataProvider`, `dataFreshness`, `latestCandleStatus`, `dataHealth`, `candlesReference`;
- classification inputs/results: `dailyRegime`, `h4Structure`, `bias`, `status`, `action`;
- display score: `score`, `grade`, `confidence`, `setupScoreBreakdown`;
- market facts: `currentPrice`, `changePercent`, zones, trigger, invalidation, stop, targets, and `estimatedRR`;
- report content: `reason`, `whyNoEntry`, `whatToDoNext`, and `marketContext`;
- prepared analysis inputs: `indicators`, `crossMarket`, and `eventRisk`.

Required market facts remain required in the current dashboard contract. Narrative `reason`, entry trigger, preferred entry, invalidation, stop, and reward-to-risk may be absent where the report is non-actionable. Narrative arrays and event-risk arrays normalize to empty arrays. This does not authorize entry: an empty event-risk array blocks incoming BUY/SELL.

## Nested schemas

### Candle and CandleDataset

`Candle` requires `time`, `open`, `high`, `low`, `close`, and explicit `isClosed`. Optional fields are `volume`, `source`, `instrument`, and `timeframe`.

`CandleDataset` adds schema version, dataset identity, source timezone, instrument, canonical timeframe, synthetic-data flag, description, and a non-empty candle collection. Collection validation requires strict chronological order, unique timestamps, consistent instrument/timeframe metadata, and valid OHLC geometry.

### PriceZone

Every zone has a stable `id`, typed purpose, low/high prices, label, source, confidence, and lock flag. Low cannot exceed high. Support and resistance collections enforce matching zone types; the preferred entry zone must use `ENTRY`.

### IndicatorSnapshot

EMA 5/8/13/20/21/50/200, RSI14, ATR14, and EMA20 ATR distance are prepared as optional validated fields. Phase 3 validates fixture values but does not calculate them. Phase 4 will consume validated candles and produce this object deterministically.

### CrossMarketSnapshot

US500 and US30 are required primary instrument snapshots; Russell 2000 is the required complementary snapshot. Each contains confirmation, freshness, optional market values/timestamp, and notes. The aggregate contains confirmation status, freshness, and notes.

### EventRisk

Each item includes availability status, severity, event name/time, source, freshness, block flag, and notes. Missing, stale, invalid, or explicitly unavailable event-risk information cannot authorize BUY/SELL.

### DataHealth

Data health records overall and provider status, successful/expected/available timestamps, provider-confirmed candle closure, stale threshold, validation errors, and warnings. Invalid or unavailable health blocks entry with `NO_TRADE`; stale health always produces `NO_TRADE`.

### SetupScoreBreakdown

The prepared categories are trend, structure, momentum, location, cross-market, event risk, reward/risk, Patience Filter, and total. Phase 3 validates non-negative values and enforces total parity with report score. It does not calculate category values. Grade validation follows the approved bands.

### ApplicationSettings

Settings include version, `America/Toronto`, `H4`, scheduled review times, minimum reward-to-risk, stale threshold, preferred instrument, notification flag, and optional export directory. Minimum reward-to-risk cannot be below 2.0. Scheduling is implemented (fixture and OANDA modes); scheduler-outcome notifications are implemented via `node-notifier` but are unconditional, not yet wired to this settings schema's notification flag.

## Validation pipeline

```text
unknown JSON
  -> schema-version gate
  -> deterministic normalization
  -> Zod structural validation
  -> entry-safety enforcement
  -> validated domain object
  -> dashboard/chart presentation
```

Analysis and candle datasets remain independent parse results. A structurally invalid analysis withholds the dashboard. An invalid candle dataset withholds only the chart, leaving a valid report visible.

## Normalization rules

- `4H`, `H4`, and case/whitespace variants normalize to `H4`.
- Action labels normalize case, spaces, and hyphens; `WAIT FOR NEXT H4 CLOSE` maps to the approved `WAIT_FOR_NEXT_4H_CLOSE` action.
- Enum-like report fields normalize to uppercase underscore tokens.
- Valid timestamps normalize to UTC ISO 8601; invalid values are preserved for Zod to reject.
- Missing optional narrative arrays, event-risk arrays, and targets normalize to empty arrays.
- Zone types and nested cross-market/event/data-health enum fields normalize without changing numeric facts.
- The normalizer never supplies price, score, indicator, or candle-completion values.

Unknown enum tokens and unsupported object shapes are preserved long enough to fail explicitly at the Zod boundary rather than being guessed.

## Safety enforcement

Safety is a post-validation guard, not the Phase 6 strategy engine:

- Stale market data or stale data health produces `NO_TRADE`.
- Missing/invalid market freshness produces `NO_TRADE`.
- Invalid/unavailable data health produces `NO_TRADE`.
- Open or unconfirmed latest H4 candles convert incoming BUY/SELL to `WAIT_FOR_NEXT_4H_CLOSE`.
- Missing, unavailable, stale, or blocking event risk converts incoming BUY/SELL to `WAIT`.
- Estimated reward-to-risk below 2.0, or absent, converts incoming BUY/SELL to `WAIT`.
- Empty targets convert incoming BUY/SELL to `WAIT`.
- WAIT-family and NO_TRADE reports do not gain entry facts through normalization.

The result retains `originalAction` and a machine-readable `safetyReason` when an input action is changed. Setup Score cannot participate in or override these gates.

## Versioning and migration

`1.0.0` is the only accepted version. `src/domain/versioning.ts` exposes an intentionally empty pure migration registry. Future support follows these steps:

1. add a pure migration from one known prior version to the current shape;
2. preserve source facts and record the migration name;
3. validate the migrated value with the current Zod schema;
4. retain original persisted JSON when persistence is implemented.

Unknown past and future versions are rejected safely. Missing versions are not assumed to be current and fail schema validation.

## Fixture migration

`mock/current-analysis.json` now carries canonical versioned fields, explicit candle status, stable typed zone ids, cross-market context, event-risk context, data health, score breakdown, and a reference to the dedicated candle dataset. Its visible action, score, grade, prices, guidance, and chart levels are unchanged.

`mock/nas100-h4-candles.json` now carries schema version `1.0.0` and canonical timeframe `H4`. Its 90 synthetic candle values and completed-candle structure are unchanged. It remains unsuitable for backtesting or validating indicator formulas.

## Phase 4 input

Phase 4 may consume only validated `CandleDataset.candles`. It will return a validated `IndicatorSnapshot` and define warm-up, insufficient-history, precision, and rounding behavior. No indicator formula, regime classification, strategy action, or Setup Score calculation is implemented in Phase 3.
