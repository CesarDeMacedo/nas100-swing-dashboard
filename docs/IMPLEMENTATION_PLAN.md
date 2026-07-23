# Implementation Plan

Each phase is an independently reviewable request. Do not start the next phase without user approval of the current stop point.

## Phase 0: Foundation and tooling

- Objective: establish the TypeScript workspace and test baseline.
- Scope: React/Vite, Node local service, Tailwind, shared package boundaries, linting, Vitest, RTL, and Playwright configuration.
- Likely files: root workspace files; `apps/web/`, `apps/service/`, `packages/domain/`, `tests/e2e/`.
- Dependencies: user approval; Node.js package installation.
- Tasks: scaffold only the agreed architecture; add scripts; add one smoke test per runtime; document local commands.
- Acceptance: clean install, typecheck, unit test, and blank app/service health response work locally.
- Tests: smoke unit test and Playwright page-load test.
- Risks: over-scaffolding or a premature monorepo decision.
- Still mocked: all analysis, API data, storage, notifications, and export.
- Stop point: review generated structure and dependency list.

## Phase 1: Static dashboard shell using mock JSON

- Objective: render the approved desktop visual direction from `mock/current-analysis.json`.
- Scope: browser UI only; reusable shell, header, banner, summary, sidebar cards, footer, loading/error states, and action-state fixtures.
- Likely files: `apps/web/src/components/`, `apps/web/src/features/dashboard/`, `apps/web/src/styles/`, `packages/test-fixtures/`.
- Dependencies: Phase 0.
- Tasks: validate the existing mock JSON with a Phase 1 compatibility schema; implement 16:9 desktop layout plus graceful narrow-screen stacking; render fields only from fixtures; add centralized action color mappings; add open-candle, stale-data, missing-narrative, and invalid-data states.
- Acceptance: no hardcoded market facts in components; all six action states render from fixtures; open-candle BUY/SELL is visibly downgraded to WAIT or NO_TRADE; stale data is NO_TRADE; approved images are not part of the DOM or CSS.
- Tests: RTL assertions for action, score/grade, core levels, freshness badge, open-candle protection, stale fallback, optional narrative, invalid data, and error/loading states; visual screenshot baseline if practical.
- Risks: visually coupling cards to mock-specific fields or treating the image as an implementation asset.
- Still mocked: chart is a labeled chart placeholder; calculations, local API, persistence, and exports.
- Stop point: visual and component-boundary review before a chart library is introduced.

## Phase 2: Real candlestick chart using mock OHLC (implemented)

- Objective: replace the Phase 1 chart placeholder with a data-driven candlestick chart.
- Scope: Lightweight Charts integration, OHLC adapter, chart header, time/price scales, and report-derived zones/markers.
- Likely files: `packages/charts/`, `apps/web/src/components/chart/`, chart fixtures.
- Dependencies: Phase 1 and an approved chart-library choice.
- Tasks: map candles to the chart library; add support/resistance/entry/invalidation overlays; resize safely; keep overlays derived from the report.
- Acceptance: no decorative candle image; plotted candles match mock OHLC order and values; overlays change with a fixture.
- Tests: chart adapter unit tests and Playwright screenshot/canvas-visible checks.
- Risks: chart-library overlay limitations and high-DPI export behavior.
- Still mocked: all market data, indicators, strategy, report generator, and service API.
- Stop point: chart behavior review against the OANDA reference.

Implementation record:

- Selected TradingView Lightweight Charts 5.2.0.
- Added a deterministic 90-candle synthetic H4 fixture for July 1-21, 2026 in `America/Toronto`; no runtime candle generation or external data is used.
- Added a Zod candle collection boundary with timezone, ordering, duplicate, OHLC, and `isClosed` validation.
- Added a pure adapter for candles, support/resistance/entry zones, current price, invalidation, stop, and targets.
- Implemented filled zones as a series primitive using chart price coordinates, with native price lines for discrete levels.
- Added responsive resize and unmount cleanup, accessible summaries, completed/open candle status, chart-only validation failure behavior, and fixture-driven tests.
- Remaining mocked: market data, indicator values, strategy decisions, Setup Score, report generation, service API, persistence, scheduling, notifications, and export.
- Phase 3 is implemented below; Phase 4 has not started.

## Phase 3: Shared schemas and validation (implemented)

- Objective: make the validated report contract the only analysis-data boundary.
- Scope: Zod schemas, inferred types, fixture validation, API response guards, and schema error models.
- Likely files: `packages/domain/src/`, `packages/test-fixtures/`, `apps/web/src/data/`.
- Dependencies: Phase 0; Phase 1 fixtures.
- Tasks: define centralized schemas and inferred types; version and migrate committed fixtures; normalize incoming representations; create invalid and unsafe fixtures; enforce non-strategy safety rules.
- Acceptance: invalid reports cannot reach dashboard rendering; valid fixture renders unchanged through schema parsing.
- Tests: schema boundary, enum, timestamp, zone, and cross-field validation tests.
- Risks: breaking compatibility with the approved mock before a migration path exists.
- Still mocked: indicators, strategy, local service, persistence, scheduler, and export.
- Stop point: schema review and confirmation of any mock-v2 migration.

Implementation record:

- Added the schema authority under `src/schemas/` for reports, candles, zones, indicators, cross-market snapshots, event risk, data health, score breakdown, provider status, settings, enums, timestamps, and semantic schema version.
- Added `src/domain/normalization.ts`, `versioning.ts`, and `safety.ts`; raw JSON is parsed once before presentation.
- Canonicalized the official timeframe to `H4`, enum values to uppercase tokens, and valid timestamps to UTC RFC 3339 strings without inventing market facts.
- Versioned both committed fixtures as `1.0.0`; preserved the approved dashboard action, score, price levels, narratives, and 90-candle chart structure.
- Added safe conversion for stale/invalid health, open candles, missing event risk, sub-2.0 reward-to-risk, and missing targets.
- Added schema, enum, normalization, versioning, safety, fixture, application, and chart regression tests.
- Remaining mocked: all indicator values, classifications, strategy decisions, Setup Score category calculations, local service, providers, persistence, scheduling, notifications, and export.
- Phase 4 has not started.

## Phase 4: Indicator engine

Phase 4 is complete. Phase 4A implemented pure EMA, RSI14 (Wilder), and ATR14 (Wilder) series functions that exclude open candles and return explicit insufficient-data states. Phase 4B added a standalone latest-value snapshot with per-indicator availability, precision-preserving EMA20/ATR distance, and a non-failing fixture comparison utility. Phase 4C added a deterministic 222-candle synthetic H4 fixture and validated EMA200 availability, determinism, source-candle attribution, and input immutability. Snapshot writes to reports or UI, regime classification, strategy logic, and scoring remain deferred.

- Objective: calculate deterministic EMA, RSI, ATR, and distance metrics from normalized candles.
- Scope: pure TypeScript indicator functions and indicator snapshot builder.
- Likely files: `packages/indicators/src/`, `packages/domain/src/`, indicator fixtures.
- Dependencies: Phase 3; a documented warm-up candle policy.
- Tasks: implement formulas, period configuration, precision policy, and insufficent-history result.
- Acceptance: same input returns same snapshot; insufficient data produces non-actionable typed result.
- Tests: known-value vectors, edge cases, precision tests, and property-oriented monotonic input tests.
- Risks: provider precision and indicator warm-up disagreement.
- Still mocked: regime, strategy, score, report, service, persistence, scheduler, notifications, export.
- Stop point: indicator output and rounding review.

## Phase 5: Daily regime and H4 structure classification

Phase 5 is complete. Phase 5A implemented `src/domain/dailyRegime.ts`: a completed-candle-only classifier using current price, EMA20/50/200, RSI14, and EMA slopes over a five-candle lookback with a 0.01 tolerance. It returns `strong_bullish`, `defensive_bullish`, `neutral`, `defensive_bearish`, `strong_bearish`, or `unavailable`, plus deterministic evidence and missing inputs. Phase 5B implemented `src/domain/h4Structure.ts`: completed-candle H4 classification with a two-candle confirmed-swing window, a 0.10 ATR breakout buffer, 0.20 ATR EMA-cluster threshold, and four-ATR compressed-range threshold. It supports bullish/bearish trends, pullbacks, breakouts, reversal attempts, consolidation, and unavailable states. Phase 5C implemented `src/domain/technicalContext.ts`, which combines the existing calculations and classifiers, keeps lowercase canonical values authoritative, maps supported values explicitly to legacy report enums, and returns `ready`, `partial`, or `unavailable` context status. Phase 6 will consume this context boundary for deterministic entry gates and Patience Filter inputs.

- Objective: classify deterministic Daily regime and H4 structure from validated inputs.
- Scope: pure classifiers, reason codes, and classification evidence.
- Likely files: `packages/strategy/src/classification/`, domain enums and fixtures.
- Dependencies: Phase 4 plus normalized Daily and H4 candles.
- Tasks: implement the EMA regime rules; define neutral/transitional cases; classify H4 pullback, continuation, breakdown, and insufficient-data states.
- Acceptance: every classifier result includes evidence and a non-ambiguous enum; unresolved data is non-actionable.
- Tests: bullish, bearish, neutral, transitional, and insufficient-data fixtures.
- Risks: underspecified structure definitions beyond the initial EMA rules.
- Still mocked: cross-market evidence, event risk, action selection, scoring, service, persistence, scheduler, notifications, export.
- Stop point: approve classification taxonomy and reason-code wording.

## Phase 6: Strategy engine and Patience Filter

Phase 6 is complete. Phase 6A implemented `src/domain/patienceFilter.ts`. It evaluates long and short directions independently with `allowed`, `blocked`, `waiting`, and `unavailable` states. Stale/invalid data, unavailable providers, open candles, blocking events, sub-2.0 R:R, structural invalidation, and invalid required levels block; confirmation, location, event-risk, and primary cross-market gaps wait. Phase 6B implemented `src/domain/tradePlan.ts`: location uses a 0.35 ATR zone/EMA tolerance, confirmation requires a completed directional candle closing in the relevant 60% range, triggers use 0.05 ATR, and stops use a 0.25 ATR buffer beyond structural invalidation. Targets use directional zones then swings, with deterministic R-multiple fallback. Phase 6C implemented `src/domain/strategyDecision.ts`: it applies NO_TRADE safety precedence, then gated BUY/SELL, conflict handling, pullback and next-close waits, and generic WAIT. Bias and setup status map from the technical context and plan/filter states. Phase 7 will consume the final decision as an input only; scoring cannot override it.

- Objective: enforce hard entry gates and produce a deterministic action.
- Scope: completed-candle protection, location, confirmation, cross-market placeholders, R:R, event/stale checks, and Patience Filter.
- Likely files: `packages/strategy/src/gates/`, `packages/strategy/src/action/`, fixtures.
- Dependencies: Phases 3-5 and agreed definitions for first retest/event blocking.
- Tasks: encode action precedence; ensure hard gates run before score; generate structured blockers and next actions.
- Acceptance: open, unavailable, or inconsistent H4 candles never produce BUY/SELL; stale market data becomes NO_TRADE; missing macro/event-risk data becomes WAIT or NO_TRADE; R:R below 2.0 blocks BUY/SELL; score input cannot bypass Patience Filter.
- Tests: decision table covering every required rule and action state.
- Risks: terms such as “acceptable location” and “aligned confirmation” require thresholds.
- Still mocked: live cross-market and event inputs, persistence, scheduler, notifications, export.
- Stop point: review the explicit decision table before score implementation.

## Phase 7: Setup Score

Phase 7 is complete. Phase 7A implemented `src/domain/setupScore.ts`: independent long/short descriptive scores across trend (20), H4 structure (20), momentum (15), location (15), cross-market (10), event risk (5), reward-to-risk (10), and Patience readiness (5). Grades use the approved D through A+ bands. Phase 7B implemented `src/domain/scoredDecision.ts`: it selects the official descriptive score from the already-fixed decision, labels premium states, and keeps entry authorization dependent on the Patience Filter and trade plan. Phase 8 will consume the synchronized decision and selected score for deterministic report content.

- Objective: produce transparent, reproducible score breakdown and grade.
- Scope: weighted categories, score caps, explanations, grade mapping, and card eligibility.
- Likely files: `packages/strategy/src/scoring/`, domain schemas, fixtures.
- Dependencies: Phase 6 and the approved fixed grade thresholds.
- Tasks: implement the PRD weights; compute totals; apply `0-49 D`, `50-59 C`, `60-69 C+`, `70-79 B`, `80-89 A`, and `90-100 A+`; expose component evidence; enforce score-70 card eligibility separately from action gates.
- Acceptance: total equals component sum and never overrides an action blocker.
- Tests: category maximums, totals, boundaries, missing-data treatment, and Patience Filter regression.
- Risks: “premium setup card” threshold versus score/action semantics needs a final policy.
- Still mocked: live inputs, service, persistence, scheduler, notifications, export.
- Stop point: approve weights, grade thresholds, and missing-data policy.

## Phase 8: Local report generation

Phase 8A implemented `src/application/buildDashboardState.ts`. It orchestrates validated reports and candle datasets through technical context, directional plans, Patience Filters, decision, scoring, and scored-decision selection, then owns the UI-ready dashboard state. The default fixture resolves to a non-actionable `WAIT_FOR_PULLBACK`; legacy injected UI fixtures remain available for isolated presentation tests.

Phase 8B connects `DashboardState` to the presentation boundary. Calculated action, bias, setup status, score, grade, premium state, actionability, primary reason, and plan values now take precedence over static report values. Unavailable plan values render explicit non-actionable text and are omitted from chart price lines. Fixture-backed zones, market context, current price, change, and secondary narrative remain available as supporting context.

Phase 8C implemented `src/application/buildSwingReport.ts`. It creates a versioned structured report and a fixed-order Markdown report directly from `DashboardState`, preserving dashboard/report parity without AI or additional calculations. Unavailable plan values remain explicit; Phase 9 will add scheduling and Phase 10 will add persistence.

- Objective: generate the full report from the finalized report object.
- Scope: report screen/view model, deterministic text templates, scenario sections, position-sizing examples, and parity checks.
- Likely files: `packages/report/`, `apps/web/src/features/report/`.
- Dependencies: Phases 3 and 6-7.
- Tasks: map report fields to sections; make absent optional data visible rather than inferred; render long/short scenarios only when valid.
- Acceptance: report and dashboard show identical core values; no financial facts are hardcoded in templates.
- Tests: report snapshots, report/dashboard parity, and absent-data states.
- Risks: narrative fields currently lack provenance and structured scenario fields.
- Still mocked: local persistence, scheduler, notifications, export, live providers.
- Stop point: review report wording and auditability.

## Phase 9: Local scheduler

Local scheduler foundation is implemented. `src/service/scheduler/torontoSchedule.ts` identifies the approved `America/Toronto` slots and `fixtureScheduler.ts` evaluates them every 15 seconds while the Node service runs. It triggers Monday-Friday at 13:01 and Sunday-Friday at 21:01 only, tracks each in-memory Toronto slot once, and delegates to the shared fixture-run path. The runner requires a valid completed synthetic H4 candle, records blocked runs without a report when completion is absent, and relies on SQLite run-key uniqueness after service restarts. Health exposes concise scheduler status. Set `NAS100_DASHBOARD_SCHEDULER_ENABLED=false` to disable it; notifications, live providers, browser polling, and dashboard history changes remain deferred.

- Objective: run mock analysis at 13:01 and 21:01 `America/Toronto` after expected H4 closes without duplicates.
- Scope: service scheduler, manual trigger, idempotency, run logging, and UI update event.
- Likely files: `apps/service/src/scheduler/`, service routes, integration tests.
- Dependencies: Phase 6 and a local service from Phase 0.
- Tasks: implement the approved Toronto schedule; verify provider-marked closed status after every scheduled tick; run only confirmed closed fixture candles; add durable duplicate protection interface.
- Acceptance: one completed candle creates one run; an open candle is recorded as blocked; manual and scheduled paths share logic.
- Tests: clock-boundary, duplicate, retry, and DST/timezone tests.
- Risks: provider session conventions, daylight-saving transitions, and Windows background-process behavior.
- Still mocked: real provider data, SQLite durability, platform notifications, export.
- Stop point: scheduler timeline and log review.

## Persistence milestone: local SQLite foundation (implemented)

This cost-conscious foundation is intentionally earlier than the scheduler and does not expose a service or UI. `src/persistence/analysisRepository.ts` uses Node's built-in `node:sqlite` module, so no native dependency was added. It creates migrations plus immutable `analysis_reports` and `analysis_runs` tables, enables foreign keys, WAL mode, and a busy timeout, and persists completed report/run pairs transactionally. Blocked and failed runs can be recorded without a report. `run_key` is unique to reserve the scheduler's future idempotency boundary. The default database location is `%LOCALAPPDATA%\\NAS100 Swing Dashboard\\nas100-swing-dashboard.sqlite`; no database is created until a future local service explicitly opens the repository. Tests cover transactions, retrieval, ordering, duplicate run keys, reopening, and safe argument validation. Scheduling, notifications, live data, AI, packaging, UI history, and browser access remain out of scope.

## Manual local-service milestone (implemented)

`src/service/server.ts` adds a manual-only Node HTTP boundary around the existing validated synthetic pipeline, `DashboardState`, `SwingReport`, and `AnalysisRepository`. It binds exclusively to `127.0.0.1` on port `4310` by default, creating the local SQLite database only at service startup. `POST /runs/manual-fixture` persists an immutable fixture report and uses a run key composed of instrument, timeframe, source candle time, report version, strategy version, and `fixture`; repeated requests return the existing run. `GET /health`, `GET /runs`, and `GET /runs/:runKey` return JSON only. `NAS100_DASHBOARD_DB_PATH` and `NAS100_DASHBOARD_PORT` are the sole environment overrides. Scheduling, notifications, live data, AI, packaging, and a UI history screen remain out of scope.

## Browser-to-local-service validation milestone (implemented)

The fixture-driven dashboard now checks `GET /health` and can call `POST /runs/manual-fixture` through `src/serviceClient/localAnalysisService.ts`. `App.tsx` owns the request state, while the header control only presents availability and manual persistence results. The Vite dashboard uses `VITE_NAS100_SERVICE_URL` or `http://127.0.0.1:4310`; start `npm run service` before `npm run dev`. The service allows only local Vite development origins and remains bound to `127.0.0.1`. This does not replace fixture dashboard data, add a history UI, or implement scheduling.

## Read-only browser history milestone (implemented)

The dashboard now exposes a compact Analysis history overlay using only `GET /runs?limit=10` and `GET /runs/:runKey` through the typed local service client. The overlay lazy-loads local records, supports explicit refresh, and presents immutable report detail without recalculating or changing the fixture-driven dashboard state. It requires `npm run service`; scheduling, live data, and any write action beyond the existing manual fixture control remain out of scope.

## Phase 10: SQLite history

- Objective: persist immutable report history and run records locally.
- Scope: database migrations, repositories, history screen, and retention/back-up policy.
- Likely files: `apps/service/src/db/`, migrations, `apps/web/src/features/history/`.
- Dependencies: Phase 9 and user approval to initialize SQLite.
- Tasks: create schema, transactions, repositories, history query API, and list/detail UI.
- Acceptance: reports and failed/blocked runs survive service restart; duplicate key is enforced.
- Tests: migration, repository, transaction, and restart integration tests.
- Risks: native SQLite dependency and application-data location.
- Still mocked: live provider, system notifications, export.
- Stop point: inspect schema, stored JSON, and history retention behavior.

## Phase 11: Notifications

- Objective: deliver deduplicated local notification summaries for completed runs.
- Scope: preference UI, in-app notification center, optional Windows adapter, and audit log.
- Likely files: `apps/service/src/notifications/`, settings UI, notification tests.
- Dependencies: Phases 9-10.
- Tasks: define opt-in thresholds; notify only persisted eligible reports; add failed-delivery logs.
- Acceptance: one report yields at most one notification per channel; disabled settings suppress output.
- Tests: eligibility, deduplication, settings, and adapter failure tests.
- Risks: Windows permissions and notification reliability.
- Still mocked: live provider and export.
- Stop point: approve notification copy and opt-in defaults.

## Phase 12: PNG export

- Objective: export a data-bound 16:9 setup card as PNG.
- Scope: dedicated export route/view, chart-ready wait, local file writing, and export history.
- Likely files: export package/service, `apps/web/src/features/export/`, Playwright tests.
- Dependencies: Phases 2, 8, and 10.
- Tasks: render export view from report id; capture after fonts/chart readiness; write metadata manifest.
- Acceptance: export includes the same report values as dashboard and no reference image pixels.
- Tests: visual regression, metadata parity, and export failure tests.
- Risks: canvas capture and fonts across browser/packaged runtime.
- Still mocked: live provider only.
- Stop point: inspect exported sample at target resolution.

## Phase 13: Market-data provider integration

Read-only OANDA v20 foundation is implemented but remains isolated from broader Phase 13 integration. `src/providers/oanda/` parses environment-only configuration, uses a GET-only Bearer client, normalizes account instruments and midpoint H4 candles, and preserves OANDA's `complete` flag. Local service endpoints expose configuration status, explicit verification, explicit-instrument candle retrieval, and a manual completed-candle report path without startup calls, dashboard use, or scheduler use. `OANDA_NAS100_INSTRUMENT` is deliberately not guessed; account discovery returns candidates only. `.env.example` documents local placeholders. No order, trade, position, or account-configuration code exists.

Manual OANDA analysis is implemented as a separate `POST /runs/manual-oanda` path. It requests 250 midpoint H4 candles and 250 Daily candles, excludes all open candles, and keeps H4 structure/decision inputs separate from Daily Regime inputs. Both source timestamps are persisted with the immutable local report, while H4 remains the run identity. The path is GET-only toward OANDA and manual only; no dashboard or scheduler integration exists. Cross-market and event-risk inputs are explicitly unavailable, so the resulting report cannot authorize an entry. No trade execution exists.

New manual OANDA reports derive deterministic support, resistance, preferred-entry, and informational invalidation levels from completed H4 confirmed swings with centralized ATR buffers. Historical reports are not changed. Dashboard selection of an OANDA report remains deferred.

Saved OANDA reports with a non-sensitive display snapshot can now be opened from History in the existing dashboard layout for the current browser session. This is historical review only: mock data remains the refresh default, and neither the scheduler nor browser starts OANDA loading automatically.

- Objective: replace mock provider with a licensed live provider through adapters.
- Scope: credentials, symbol mapping, OHLC, US500/US30 primary confirmation, Russell 2000 complementary confirmation, data health, and provider status.
- Likely files: `apps/service/src/providers/`, settings, secure local config docs.
- Dependencies: Phases 3-7 and a user-selected licensed provider.
- Tasks: implement adapter and normalizers; validate timezone, latency, sessions, and backfill; retain mock fallback.
- Acceptance: live data passes validation and produces auditable provider status; failures are NO_TRADE.
- Tests: recorded provider payload contracts, normalization, stale/rate-limit/failure tests.
- Risks: licensing, symbol mapping, availability, and session-close definitions.
- Still mocked: no macro/event input may be treated as sufficient for BUY/SELL; unavailable inputs must produce WAIT or NO_TRADE.
- Stop point: review provider contract, costs, and a recorded dry run.

## Phase 14: Data-health and failure states

- Objective: make failure behavior explicit, useful, and safe.
- Scope: health screen/badge, stale rules, degraded dependencies, manual retry, error history.
- Likely files: service health module, dashboard states, fixtures, e2e tests.
- Dependencies: Phase 13.
- Tasks: finalize freshness thresholds; expose provider status; ensure stale market data maps to NO_TRADE and missing macro/event-risk data maps to WAIT or NO_TRADE.
- Acceptance: stale, missing, invalid, or open-candle fixtures visibly explain blocked action.
- Tests: end-to-end failure matrix and visual checks for each state.
- Risks: alert fatigue and ambiguous partial-data policy.
- Still mocked: none required; optional providers may remain unavailable.
- Stop point: sign off on failure language and operational runbook.

## Phase 15: Windows packaging

- Objective: distribute a local Windows application without changing product behavior.
- Scope: Tauri/Electron proof of concept, installer, local data paths, update policy, and native integrations.
- Likely files: packaging configuration, installer assets, release scripts, platform tests.
- Dependencies: Phases 10-12 and resolved packaging ADR.
- Tasks: package browser UI/service; migrate local config/data location; test notifications and PNG export.
- Acceptance: installed app runs offline with mock data and preserves local history across restart.
- Tests: clean-machine smoke checklist and packaged e2e samples.
- Risks: native modules, signing, updates, and local firewall behavior.
- Still mocked: live provider where credentials are intentionally absent.
- Stop point: packaging technology and installer review.

## Phase 16: Optional AI narrative layer

- Objective: add an optional explanation layer after deterministic analysis is complete.
- Scope: sanitized report input, strict non-authoritative output, provenance, opt-in settings, and fallback copy.
- Likely files: isolated `apps/service/src/ai/`, settings, audit log, tests.
- Dependencies: all deterministic report paths and explicit user approval of provider/privacy model.
- Tasks: pass read-only validated report to AI; constrain output to explanation; label output and preserve deterministic report alongside it.
- Acceptance: disabling AI changes no numeric report fact, action, score, zones, or mandatory guidance.
- Tests: contract tests, prompt-injection resistance, deterministic parity, and unavailable-provider fallback.
- Risks: privacy, cost, hallucination, and accidental authority creep.
- Still mocked: AI can remain entirely absent; core application remains complete without it.
- Stop point: review privacy, prompt contract, and sample narratives before enabling it.
