# Architecture

## Current implementation status

The application is local-first and analysis-only. React/Vite/TypeScript renders a mock-default dashboard while the Node service owns read-only OANDA access and SQLite immutable reports. OANDA credentials remain server-side. Manual OANDA analysis uses separate completed H4 and Daily inputs: Daily is for Daily Regime, H4 is for structure and decisions. Saved reports include non-sensitive immutable display snapshots and can be opened from Analysis History. Chart Preview is on-demand and read-only, and can export itself as a PNG. The scheduler is in-process, defaults to fixture mode, OANDA mode is explicit opt-in, and its OANDA fetch retries with backoff without ever accepting a stale/wrong-window H4 candle. Cross-market confirmation (US500/US30/Russell 2000) is live, fetched from the same OANDA account. Event-risk is a validation spike (unofficial feed), not a resolved production input; entry authorization from the OANDA pipeline stays hard-blocked regardless of either input until that spike is resolved (see `docs/DECISIONS.md` ADR-016). Scheduler outcomes trigger a local, informational-only OS notification. The browser never connects to OANDA.

The candlestick chart supports zoom, horizontal pan, price-scale adjustment, pinch zoom, double-click scale reset, and explicit Reset view. Its instance is stable for a chart identity; live/overlay updates update the series without fitting or replacing the user viewport. Live observation remains an opt-in, experimental feature (not the default); lifecycle coverage for shared subscribers, reconnect/backoff, H4 rollover, saved-candle immutability, and saved-report invariance is now complete (`src/service/liveStream.test.ts`).

## System overview

NAS100 Swing Intelligence Dashboard will be a local-first, read-only desktop-oriented web application. React renders the dashboard and report from one validated `AnalysisReport`. A Node.js local service owns data acquisition, completed-candle checks, deterministic calculations, report assembly, scheduling, persistence, notifications, and exports. It must contain no broker credentials, order APIs, order simulation, or trade-execution code.

The initial runtime path is mock JSON. Live providers, SQLite, scheduling, notifications, export, and packaging are deferred to their named phases.

```text
Market provider adapters / mock fixtures
              |
              v
       Candle and market-data layer
              |
              v
 Indicator engine -> regime / structure -> strategy + Patience Filter
              |                                     |
              +---------------> Setup Score --------+
                                                    |
                                                    v
              Zod-validated AnalysisReport (shared contract)
                         |                  |                 \
                         v                  v                  v
                React presentation      local SQLite       report / PNG export
                         |                  |                 |
                         +--- UI state <----+---- scheduler --+---- notifications
```

## Frontend architecture

Use React, Vite, TypeScript, Tailwind CSS, Zustand, and React Testing Library. The browser receives a validated `AnalysisReport` through a local API and keeps only view state in Zustand: selected report, loading/error state, active screen, and display preferences. It must not calculate indicators, choose an action, compose trading facts, or duplicate business rules.

Presentation components accept typed view models derived from the report. Prices, levels, score, action, status, bias, written guidance, and chart markers come from that object. Components may format values and choose visual treatment, but must not create facts or strategy text.

The chart panel uses TradingView Lightweight Charts unless a later proof-of-concept shows a material requirement it cannot meet. Its candle series is fed structured OHLC candles; zone and decision overlays are derived from report fields through a chart adapter. The approved PNG is never rendered in the product.

### Phase 2 chart implementation

Phase 2 uses `lightweight-charts` 5.2.0 behind `FinancialChart` and a pure chart adapter. The adapter converts validated application candles to UTC chart timestamps and maps analysis zones and price levels into chart-specific view models. Native candlesticks, scales, crosshair behavior, and price lines stay inside the chart module.

Filled support, resistance, and preferred-entry ranges use an attached series primitive. The primitive asks the candlestick series for `priceToCoordinate` values on every draw, so zone geometry remains coupled to the active price scale during resize, pan, and zoom. Its autoscale contribution includes all zone boundaries plus current, invalidation, stop, and target prices. Native price lines render current price, invalidation, stop, targets, and an optional completed-close comparison.

`mock/nas100-h4-candles.json` is a deterministic synthetic dataset with 90 H4 candles from July 1 through July 21, 2026 in `America/Toronto`. It is not provider data and does not calculate indicators or actions. The latest fixture candle is explicitly closed. A separate open-candle fixture drives the existing display safety path and the chart's unconfirmed-candle status.

The chart owns one `ResizeObserver`; it resizes the chart API to the available panel, disconnects the observer on unmount, detaches its custom primitive, and removes the chart instance. An invalid candle collection withholds only the chart and leaves the validated analysis dashboard available.

## Local backend architecture

Run a Node.js TypeScript local service as a separate process during browser-first development. It exposes a deliberately small local API, for example:

- `GET /api/health`: service and provider health.
- `GET /api/analysis/current`: latest validated report.
- `POST /api/analysis/run`: manual, local analysis run; never a trade action.
- `GET /api/analysis/history`: persisted run summaries.
- `GET /api/settings`: application settings.
- `PUT /api/settings`: validated local settings.
- `GET /api/events`: optional SSE updates for the open dashboard.

Internally, the service separates provider adapters, normalizers, indicator calculations, classification, strategy gating, scoring, report construction, repositories, scheduler, notification adapters, and export jobs. Each stage receives typed input and returns typed output or an explicit error result.

## Process boundaries

1. The React process displays validated data and requests local operations.
2. The local service owns all market data, calculations, scheduling, local filesystem access, SQLite, notifications, and exports.
3. The persistence layer owns database access; UI and strategy code do not issue SQL.
4. Provider adapters return normalized market-domain data, not UI-shaped data.
5. Optional AI, if introduced, receives a finalized validated report and can produce a clearly marked narrative only. Its output cannot change numeric values, actions, zones, score, or written mandatory guidance.

## Shared schemas and data flow

Define Zod schemas in a dependency-light shared TypeScript package or source folder. Infer TypeScript types from schemas, rather than maintaining parallel interfaces. The service validates data on provider ingress, validates settings before persistence, constructs the report, validates the final report, persists it, then returns it. The UI validates API responses again at its boundary and displays `ErrorState` for failures.

```text
provider payload -> normalize -> validate market snapshot -> calculate -> validate report
-> persist AnalysisRun -> serve exact report -> validate in UI -> render dashboard and report
```

No report text should be independently composed in the UI. The local report generator and dashboard share the same report object; templates select fields but cannot invent data.

### Phase 3 implementation

Phase 3 centralizes runtime contracts under `src/schemas/`. `enums.ts`, `primitives.ts`, `candles.ts`, `analysis.ts`, `settings.ts`, and `version.ts` are dependency-light and infer all public TypeScript types from Zod. Existing `src/domain/analysis.ts` and `src/domain/candles.ts` are thin boundary modules retained for stable application imports.

The browser pipeline is `version gate -> normalize -> Zod validate -> safety enforce -> render`. Raw analysis and candle JSON are each parsed once in `App`. Presentation components receive validated values and do not import or call Zod. Analysis failure withholds the dashboard; candle failure remains chart-local.

`src/domain/normalization.ts` canonicalizes H4, action labels, enum casing, and timestamps; it defaults only optional arrays. It does not invent price, score, indicator, or candle-completion facts. `src/domain/versioning.ts` accepts schema `1.0.0`, rejects unsupported versions, and exposes an empty pure migration registry for future one-version-at-a-time adapters.

`src/domain/safety.ts` is an input-safety boundary, not strategy logic. It prevents unsafe incoming BUY/SELL values from reaching presentation when candles are open/unconfirmed, event-risk information is unavailable, reward-to-risk is below 2.0, targets are missing, or data health is invalid. Stale market data is always `NO_TRADE`. Phase 4 consumes validated candles and produces indicator snapshots; Phase 6 remains responsible for the complete strategy decision table.

## Scheduler strategy

Start with manual mock refresh. Later, use a single scheduler inside the local service. The official application timezone is `America/Toronto`, the primary timeframe is H4, and the priority scheduled analysis times are 13:01 and 21:01 in that timezone. These times are one minute after the expected H4 closes to reduce incomplete-candle risk. It should:

1. calculate the most recent expected H4 close in `America/Toronto`;
2. ask the provider whether that H4 candle is explicitly marked closed;
3. reject open, missing, duplicate, or stale candles;
4. acquire all required market snapshots;
5. run deterministic analysis once per instrument/timeframe/candle close;
6. persist an `AnalysisRun` with a unique run key; and
7. emit a local event after successful persistence.

The scheduler must use an idempotency key such as `instrument:timeframe:completedCandleAt:strategyVersion`. A 13:01 or 21:01 clock tick is not evidence that a candle closed. The provider-confirmed closed status and completed-candle timestamp are authoritative. An open, unavailable, stale, or inconsistent latest candle cannot produce `BUY` or `SELL`.

## SQLite strategy

SQLite will be local-only and accessed only by the service. Use migrations, foreign keys, WAL mode, busy timeout, and transactional persistence. Proposed tables are `application_settings`, `analysis_runs`, `analysis_reports`, `provider_status`, `notification_log`, `export_log`, and `schema_migrations`. Store report JSON alongside queryable summary columns such as action, score, instrument, timeframe, completed-candle timestamp, and run status. Immutable reports preserve auditability; user-locked levels and settings are separate user-owned records.

Back up the database before destructive migrations. Database files, exports, and logs belong under an application-data directory rather than the source repository.

## Provider abstraction

Use a provider interface per data category: OHLC, market snapshots, event risk, and macro context. Providers normalize symbols, timestamp timezone, precision, market-session status, and freshness into shared types. A `MockMarketDataProvider` is the first implementation. Every provider response records provider name, source timestamp, received timestamp, latency, freshness state, and error details. Provider credentials must remain local service configuration, never browser bundles. US500 and US30 are the primary cross-market confirmation instruments; Russell 2000 is complementary confirmation in the MVP. NAS100 and cross-market are both live via the same OANDA v20 account — no separate provider was needed. The event-risk provider remains unresolved for production; a Forex Factory validation spike is wired for observation only.

## Error handling and stale-data safeguards

Use typed error categories: validation, provider unavailable, rate limited, unsupported symbol, stale data, incomplete candle, calculation failure, persistence failure, scheduler duplicate, export failure, and notification failure. The service records failures as `AnalysisRun` entries where possible and returns a non-actionable result.

Safety gates run before score display or action selection:

- Stale market data always yields `NO_TRADE`.
- Missing macro or event-risk data yields `WAIT`, `WAIT_FOR_NEXT_4H_CLOSE`, or `NO_TRADE`; never `BUY` or `SELL`.
- An open, unavailable, or inconsistent H4 candle yields a `WAIT`-family action or `NO_TRADE`; never confirmed `BUY` or `SELL`.
- Estimated reward-to-risk below 2.0 blocks `BUY` and `SELL`.
- The Patience Filter is a hard gate; the Setup Score cannot override it.
- A premium setup card is eligible at score 70 or above, including when action is `WAIT`; eligibility describes setup quality, not entry authorization.
- The UI visibly shows provider, completed-candle timestamp, received timestamp, and freshness.

## Notifications and PNG export

Notifications are local-only. Begin with an in-app notification center; later add a platform adapter for Windows system notifications. Notify only after a persisted, validated report passes user-configured thresholds and deduplicate by run id. Failed notifications do not invalidate the analysis.

PNG export captures a dedicated, data-bound 16:9 export view of the dashboard after fonts and chart drawing are ready. It uses the rendered React/Lightweight Charts output, not image-generation or a template screenshot. The export manifest records the report id, schema version, export time, and error state.

Implemented so far, at a smaller scope than this spec: notifications fire directly via `node-notifier` (`src/service/schedulerNotifications.ts`) on every scheduler outcome, with no in-app center, no user-configured thresholds, and no dedicated dedup/audit log beyond existing scheduler status and SQLite history. PNG export captures the chart panel only (`lightweight-charts`' native `takeScreenshot()`), not a dedicated 16:9 export view, and writes no manifest. Both remain open follow-ups toward the full spec above.

## Test strategy

- Unit tests with Vitest for schemas, formatters, indicators, classification, gates, scoring, report construction, scheduling, repositories, and provider normalization.
- Component tests with React Testing Library for action states, data freshness, errors, card contents, and dashboard/report value parity.
- Integration tests for mock provider to persisted report, duplicate-run protection, and stale-data fallback.
- Playwright for a small set of user-visible flows: mock dashboard loads, action state changes from fixture, invalid report error, manual refresh record, notification setting, and PNG export.

Fixture data must cover every action state, missing data, stale data, open candle, sub-2:1 R:R, locked zones, and validation failures.

## Future packaging

Develop and test in a browser first. Tauri is the leading packaging candidate because it can ship the existing web UI with a small native shell, native notifications, filesystem access, and a local backend bridge. Electron remains a fallback if Node-process compatibility or chart/export tooling is materially simpler. Packaging is a later decision after browser-first acceptance tests pass.

## Recommended project structure

```text
docs/                         product, architecture, decisions, plans
design/                       approved reference images and design specification
mock/                         versioned fixture reports and provider payloads
src/schemas/                  current browser-first Zod contract authority
src/domain/                   normalization, safety, versioning, parse boundaries
apps/
  web/                        Vite React application
  service/                    Node.js local service
packages/
  domain/                     Zod schemas, types, enums, pure rules
  indicators/                 pure indicator calculations
  strategy/                   classification, Patience Filter, scoring
  report/                     report assembly and text templates
  charts/                     chart mapping and overlay adapters
  test-fixtures/              reusable valid and invalid fixtures
data/                         ignored local database, logs, exports
tests/
  e2e/                        Playwright flows
```

The eventual monorepo layout is a recommendation, not a scaffolding instruction for this phase.
