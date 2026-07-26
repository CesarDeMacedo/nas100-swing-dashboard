# Changelog

## Mean-Reversion Strategy Kinds (Connors RSI-2 and Double Seven)

- Added `strategyKind: 'pipeline' | 'rsi2' | 'double7'` to strategy parameters (Zod-defaulted to `'pipeline'`; every pre-existing config is unchanged). The two new kinds are Connors-style long-only condition-exit mean-reversion engines — the family with the strongest published evidence on equity indices — implemented as a pure domain module (`src/domain/meanReversionStrategy.ts`: Wilder RSI/ATR, SMA filter, zero-lookahead walker, optional ATR protective stop, unit-tested including a no-lookahead invariant).
- Scope decision (user-approved): these kinds have no planned target price, so the `minRewardRisk` >= 2.0 floor is structurally inapplicable and is NOT consulted for them. The floor remains fully enforced for the `'pipeline'` kind; nothing here touches the production entry-authorization path, and no live/scheduled run selects these kinds yet.
- New CLI runner `scripts/backtest/runMeanReversionBacktest.ts` (single-pass over cached D or H4 candles; indicators always warm up on pre-range history) persisting to a new `backtest_mr_trades` table in the harness SQLite (separate from `backtest_signals`, whose NOT NULL stop/target columns encode pipeline geometry).
- First results on NAS100 (full cached history, no cost model, entry/exit at bar close): RSI-2 daily 32 trades / 81% win / PF 2.36; Double Seven daily 80 trades / 76% win / PF 2.54 — both in line with the published QQQ/SPY numbers. The H4 transfer test degrades materially (RSI-2 H4: PF 1.12; Double Seven H4: PF 1.64 with thin +0.21%/trade), consistent with the literature being a daily-bar phenomenon.

## Mean-Reversion Strategy Visibility (Sidebar Card + Chart Overlay)

- Diagnosis: the live Double Seven strategy's status was only reachable through a modal opened
  via a header button (`MeanReversionPanel`), showed raw ISO-8601 timestamps, and had zero
  presence on the H4 chart the user actually watches — everything else on the dashboard
  (action banner, setup score, sidebar cards) is built entirely around the dormant pipeline
  strategy, so the strategy actually being traded had no visible home.
- Added a persistent `MeanReversionStrategyCard` at the top of the sidebar, always visible
  (not behind a modal): current signal (ENTER/HOLD/EXIT/FLAT, color-coded), reference
  price/date, stop, suggested position size, and last-evaluated time, all in human-readable
  Toronto time via `formatTorontoTime` — plus a link into the existing panel for full history.
  `App.tsx` now fetches the latest evaluation as soon as the service is available (previously
  only fetched on-demand when the modal was opened).
- Added `mapMeanReversionPriceLines` (`chartAdapter.ts`): draws the MR entry reference and stop
  as extra price lines directly on the H4 chart, in a violet/magenta distinct from the
  pipeline's own entry/invalidation/stop/target palette, and only while a position is actually
  tracked (ENTER/HOLD) — not stale after EXIT/FLAT.
- `MeanReversionPanel` relabeled as the evaluation-history audit view (its raw-timestamp rows
  now also use `formatTorontoTime`) now that the live status has its own persistent home;
  `describeMrPositionSize`/`num` extracted from it so the card and panel never describe the
  same evaluation differently. Verified end-to-end in a real browser session (Vite dev server):
  card renders correctly, chart shows both new price lines, history modal opens with the
  updated copy, zero console errors.

## Configurable MR Risk Per Trade (Desk Rules Update)

- Added `NAS100_MR_RISK_PER_TRADE_PCT` (account-level env var, sanity-capped at 5) feeding the
  live MR evaluator's position sizing; code default stays the conservative 0.73%. Sized for the
  desk's confirmed rules (5% daily / 10% total DD): 1.9% per trade keeps the projected worst
  case at ~7.9% total and ~2.9% on a gap day — see docs/MR_LIVE_INTEGRATION_PLAN.md.

## Coherent Invalidation Anchor + All-Frames Gate Funnel Diagnostics

- Added `invalidationAnchor: 'deepest' | 'traded_zone'` to strategy parameters (`src/domain/strategyParameters.ts`, Zod-defaulted to `'deepest'` in `src/schemas/strategyConfig.ts` so pre-existing persisted configs keep parsing and keep their exact historical behavior). `'traded_zone'` anchors invalidation/stop to the zone the entry is actually taken against (the same `nearZone` that defines entry location and the confirmation boundary), falling back to the recent swing on EMA-anchored entries — instead of the deepest of all candidate levels. Motivation: the deepest-candidate anchor measures risk to the farthest structure while `targets[0]` measures reward to the nearest one, systematically depressing planned R:R below the non-negotiable 2.0 floor.
- `TradePlan` now exposes `targetSource: 'structural' | 'synthetic' | 'none'` — whether `targets[0]` (the level planned R:R is computed against) is a real zone/swing level or the 2R fallback. Diagnostic motivation: every signal produced by every backtest run to date has planned R:R of exactly 2.0 (float-identical), the fingerprint of the synthetic fallback path.
- Fixed a silent backward-compatibility break found by the new funnel: strategy configs persisted before `confirmationClosePositionThreshold` was parameterized store no such field, and `toStrategyConfig` casts stored JSON without re-parsing through Zod, so `resolveStrategyParameters` resolved it to `undefined` — making the confirmation test `candlePosition >= undefined` permanently false and any signal impossible for those configs (v1–v3). Diagnosed from a 100%-fail rate on `confirmation_candle_valid` across all 3084 frames of a window in which the same config had previously produced a signal. Now falls back to `?? 0.6` (the value those configs were created under), with a dedicated regression test (`src/domain/strategyParameters.test.ts`).
- `scripts/backtest/diagnoseFrames.ts` now runs the 5-gate funnel over ALL frames in range (the premium-score threshold never gates signal generation, so the previous eligible-only funnel could hide the true binding constraint), prints the exact failed-gate-combination distribution (size-1 rows = "4 of 5 passed"), and, on frames where both geometric gates (location + confirmation) passed, the planned-R:R distribution split by `targetSource` with an explicit "exactly 2.0" bin.

- Added a `ResolvedStrategyParameters` type and `DEFAULT_STRATEGY_PARAMETERS` (`src/domain/strategyParameters.ts`); `calculateTradePlan`, `evaluatePatienceFilter`, `decideStrategy`, `calculateSetupScore`, `selectOfficialSetupScore`, and `buildDashboardState` all accept it as an optional trailing argument. Every existing call site is unaffected — proven by a dedicated equality test comparing the output of omitting the argument against passing `DEFAULT_STRATEGY_PARAMETERS` explicitly (`src/application/buildDashboardState.test.ts`), not just by the rest of the suite continuing to pass.
- Added a `strategy_configs` table and repository methods (`saveStrategyConfig`, `getStrategyVersions`, `activateStrategyVersion`, ...) for named, versioned, immutable-once-active strategies (`draft -> active -> archived`), plus `POST/GET /strategies*` routes.
- Minimum R:R (>= 2.0) and Setup Score weights (sum to exactly 100) are validated by a shared Zod schema at the single write path; a test calls `POST /strategies` directly to prove the 422 rejection is server-side, not only a UI constraint (`src/service/server.strategies.test.ts`).
- `analysis_runs` gained an optional `strategy_config_id` column; `GET /runs`/`GET /runs/:runKey` now denormalize the strategy name/version onto each run so Analysis History can show it. `oandaRunKey` gained a trailing `strategyConfigId ?? 'default'` segment so two strategies analyzing the same candle close never collide — see `src/service/oandaRun.ts` for the one-time run-key-format-change caveat this introduces at deploy time.
- Added an isolated CLI backtest harness (`scripts/backtest/`, own `tsconfig.scripts.json`, own SQLite file separate from production): chunked OANDA historical backfill (`oandaHistoricalBackfill.ts`), a zero-lookahead replay engine (`replayWindow.ts`/`replayEngine.ts`, proven by a dedicated test rather than asserted by convention), a fill/outcome state machine per hypothetical signal with a documented conservative same-candle tie-break rule (`signalOutcome.ts`), and report aggregation (win rate, planned-vs-realized R:R, expectancy, hour/weekday breakdown — `backtestReport.ts`).
- Added `GET /backtests`/`GET /backtests/:id` (read-only against the harness's separate SQLite file) and two new dashboard overlay panels, `StrategyManagerPanel` and `BacktestResultsPanel`, matching the existing Analysis History pattern. "Run backtest" builds the CLI command to copy rather than triggering it over HTTP, keeping the harness isolated from the production service.
- Event-risk history is explicitly out of scope for this first backtest version; the replay always passes `eventRisk: []` (resolves to `clear`), never `undefined` (which would resolve to `unknown` and block every signal via the Patience Filter).
- No live or scheduled run selects a non-default strategy yet; only the backtest harness currently passes an explicit resolved strategy.

## Scheduler: Six Daily Runs Instead of Two

- Expanded the Toronto schedule from two daily slots (13:01, 21:01) to six — one per H4 close (01:01, 05:01, 09:01, 13:01, 17:01, 21:01) — to gather real data on when entries actually occur, ahead of upcoming backtest-driven parameter changes (`src/service/scheduler/torontoSchedule.ts`).
- Weekday gating: the four new slots run Monday-Friday (same as the existing 13:01 slot); 21:01 keeps its existing Sunday-Friday gating for the weekly market reopen. All six times are computed via `Intl.DateTimeFormat` against `America/Toronto`, not a fixed UTC offset, and are verified correct across both 2026 DST transitions (`torontoSchedule.test.ts`, `fixtureScheduler.test.ts`).
- `fixtureScheduler.ts` and `scheduledOandaRun.ts` (retry/backoff, H4-window correctness) required no changes — both were already generic to the number of configured slots.

## Immediate Dashboard Display After Manual OANDA Run

- Clicking "Run OANDA analysis now" now shows the resulting saved analysis on the dashboard immediately, instead of requiring the user to open Analysis History and click "View in dashboard" separately.
- On a `succeeded` or `already_exists` result, the client fetches the full saved report by `runKey` and reuses the existing saved-OANDA display path; a failed or malformed result leaves the dashboard untouched.

## Startup Auto-Load of the Last Saved OANDA Report

- On startup, the dashboard now shows the most recently persisted OANDA report instead of mock data, when one exists — a local history lookup only, no new OANDA API call and no automatically triggered analysis.
- Falls back to mock data (unchanged default) when the local service is unavailable or no OANDA report has ever been saved; "Return to mock dashboard" remains available at all times.

## Dashboard/Chart UX Pass

- Restructured the dashboard header and chart header into two clear rows (title, then actions/status) with `flex-wrap`, fixing real text-overlap bugs at standard viewport widths instead of a cosmetic tweak.
- Fixed resistance/support price labels overlapping and requiring manual panning by anchoring them dynamically to the last candle's real screen coordinate instead of a fixed pane-relative offset; moved the "COMPLETED H4" badge off the same corner.
- Fixed both the main dashboard chart and the OANDA chart preview screen not using their full available window height (a CSS Grid track/item-count mismatch and a missing layout class, respectively).
- Removed the large redundant "WAIT FOR PULLBACK" text overlay in the middle of the chart (already shown in the top banner) and shrank the oversized top action banner.
- Gave the sidebar's four analysis cards visual hierarchy (`emphasis: 'primary' | 'secondary'`) instead of identical treatment, and gave the previously unstyled `OandaManualRunControl` button the shared header-action-button skin.

## Manual OANDA Run Button

- Added a "Run OANDA analysis now" button to the dashboard header, reusing the existing `POST /runs/manual-oanda` endpoint (same safety clamp, same `runKey` dedup) instead of waiting for a scheduled slot.
- Disabled while a request is in flight to prevent duplicate concurrent calls; an `already_exists` result (current H4 candle already analyzed) is surfaced as expected dedup behavior, not an error. The scheduler and its Toronto slots are untouched.

## Safety-Clamp Regression Proof

- Added a dedicated test constructing a fully realistic scenario (confirmed bullish H4 pullback, cross-market CONFIRMING, clean event-risk, R:R >= 2.0) where the underlying pipeline genuinely computes `BUY`, then asserts the OANDA pipeline's `runManualOandaAnalysis` still returns WAIT.
- Verified by temporarily bypassing the safety clamp and confirming the test fails with the real `BUY` leaking through, then reverting — the same discipline already used for the C4/A1/A2 timeout tests.

## Event-Risk Validation Spike (A2)

- Added a Forex Factory event-risk adapter (`src/service/forexFactoryEventRisk.ts`): unofficial, undocumented feed, no auth, wired as a validation spike to observe whether real event-risk data changes computed decisions, not as a production provider commitment.
- Fail-safe by construction: any network error, timeout, non-200, malformed JSON, or non-array payload degrades to "not fetched," falling back to the existing UNAVAILABLE placeholder exactly as before this feature.
- BUY/SELL remains unconditionally blocked by the existing OANDA-pipeline safety clamp regardless of what this spike returns; only the clamp's now-inaccurate "event-risk unavailable" wording was corrected.

## Live Cross-Market Confirmation (A1)

- Both the manual and scheduled OANDA paths now fetch live H4 candles for US500, US30, and Russell 2000 from the existing OANDA account (no new provider needed — confirmed via a one-off account-instrument check) and classify each as confirming/contradicting/neutral against NAS100's own H4 structure.
- Fetches are best-effort, timeout-bounded, and outside the C4 window-retry loop: a failure or hang for one cross-market instrument degrades only that instrument to UNAVAILABLE, it never blocks or retries the NAS100 run.
- BUY/SELL remains unconditionally blocked by the existing OANDA-pipeline safety clamp regardless of cross-market confirmation.

## Scheduler Outcome Notifications (A5)

- Added a local OS notification (`node-notifier`) for every scheduler-evaluated slot outcome — `created`, `blocked`, or `failed` — via `src/service/schedulerNotifications.ts`.
- Messages are purely informational ("new report ready," "could not confirm the expected candle," "run failed") and never imply an entry action.
- The test suite always injects a no-op notify hook, so it never triggers a real OS notification.

## Scheduled OANDA Retry/Backoff (C4)

- The scheduler's OANDA fetch now retries with backoff (`[2000, 5000, 10000]` ms, configurable) on a transient network error or a stale/not-yet-available H4 candle.
- The expected H4 window is captured once at the start of the retry sequence and never recomputed mid-retry, so a retry can never silently accept data from the wrong window; a candle from a newer window than expected aborts immediately instead of retrying.
- Exhausted retries now persist a real `FAILED` run (previously only held in memory, lost on restart). The manual `/runs/manual-oanda` endpoint and `OandaClient`/`OandaProvider` remain single-attempt and untouched.

## PNG Chart Export

- Added on-demand PNG export of the H4 chart panel using `lightweight-charts`' native screenshot capability; client-side only, no server involvement.
- Modest scope: exports the chart panel itself, not a dedicated 16:9 setup-card export view with metadata manifest.

## Analysis History Search and Record Count

- Added a client-side text filter (action/direction/status/run key) and an adjustable record-count selector (10/25/50/100) to the Analysis History panel, reusing the existing `GET /runs?limit=` capability.
- Both are read-only; run deletion/pruning remains deliberately out of scope.

## OANDA Status Badge

- Added a passive `OandaStatusBadge` in the dashboard header surfacing OANDA configuration status (not configured / invalid / unavailable / healthy) once the local service is confirmed available, without requiring a manual OANDA action first.

## Scheduler Failure Tracking and Live-Stream Hardening

- Added an in-memory `consecutiveFailures` counter to scheduler status, incremented on each failed run and reset on any other outcome.
- Fixed two live-stream bugs found during lifecycle testing: a late-subscriber replay gap and a reconnect-backoff bypass.
- Fixed a display-only gap where opening a saved OANDA analysis skipped completed H4 candles between the saved snapshot and the current open candle.

## Saved OANDA Live Observation

- Added local SSE observation of live OANDA price and open H4 candle only while reviewing a saved OANDA analysis.
- Saved reports, scheduler, and persistence remain unchanged; open candles are not used for decisions.

## Optional OANDA Scheduler Mode

- Added explicit `NAS100_DASHBOARD_SCHEDULER_PROVIDER=oanda` opt-in; fixture scheduling remains the default.
- OANDA runs reuse the read-only manual pipeline and existing Toronto slots with safe scheduler health status.

## Saved OANDA Dashboard Review

- Added session-only viewing of supported saved OANDA report snapshots from Analysis History in the existing dashboard layout, with server-relayed OANDA v20 pricing-stream observation for the open H4 candle.
- This is historical saved analysis, not streaming; mock remains the refresh default and scheduler behavior is unchanged.

## Deterministic OANDA Market Levels

- New manual OANDA reports derive immutable completed-H4 swing support, resistance, preferred-entry, and informational invalidation levels with ATR-based buffers.
- Cross-market and event-risk remain unavailable; dashboard selection of OANDA reports remains deferred.

## OANDA Multi-Timeframe Data Foundation

- Manual OANDA analysis now fetches and validates separate H4 and Daily midpoint candle datasets; open candles are excluded from both.
- H4 remains the execution/run identity while Daily is used only for Daily Regime metadata; cross-market and event-risk remain unavailable.
- The dashboard remains mock-backed and the scheduler remains synthetic and unchanged.

## Manual OANDA Analysis Run

- Added a manual, read-only `POST /runs/manual-oanda` path that requests 250 OANDA H4 midpoint candles, excludes open candles, and saves immutable completed-candle reports locally.
- Cross-market confirmation and event-risk data remain explicitly unavailable, so OANDA reports cannot authorize an entry.
- The dashboard and synthetic scheduler remain unchanged; no trading capability was added.

## OANDA Read-Only Provider Foundation

- Added environment-only OANDA v20 configuration, GET-only account instrument discovery, candidate matching, and normalized midpoint H4 candle retrieval.
- Added local provider status, verification, and explicit-instrument candle endpoints with no credential exposure.
- OANDA data remains disconnected from dashboard, scheduler, strategy, SQLite persistence, and any trading capability.

## Local Synthetic Scheduler

- Added an in-process `America/Toronto` scheduler for the approved Monday-Friday 13:01 and Sunday-Friday 21:01 fixture slots.
- Reused the deterministic fixture pipeline and SQLite run-key idempotency, with completed-candle protection and scheduler status in health.
- No notifications, live data, browser polling, or trade execution behavior was added.

## Read-Only Analysis History

- Added a compact dashboard overlay for local persisted analysis history and immutable report detail.
- History loads on demand, supports manual refresh, and leaves the fixture dashboard state unchanged.
- No scheduler, live data, or trade execution behavior was added.

## Browser Manual-Run Control

- Added a typed native-fetch client for the local analysis service and a compact dashboard header control.
- The control reports local availability and manual fixture persistence results without changing the calculated fixture dashboard state.
- Added localhost Vite CORS/preflight support; no scheduler or history UI was added.

## Manual Local Service

- Added a localhost-only manual fixture service with health, run creation, history, and run lookup endpoints.
- Reuses the deterministic dashboard/report pipeline and persists immutable reports through `AnalysisRepository`.
- Added run-key idempotency and temporary SQLite service tests; scheduling remains unimplemented.

## Local persistence foundation

- Added a local SQLite repository for immutable analysis reports and analysis-run records.
- Added transactional persistence, unique run-key protection, durable reopening, and repository tests.
- Kept persistence disconnected from the browser dashboard, scheduling, notifications, live data, AI, and packaging.

## Phase 8C Checkpoint

- Completed the deterministic NAS100 strategy and report pipeline through Phase 8C.
- Dashboard and Markdown report now share the calculated `DashboardState`.
- Verified 160 passing tests with synthetic market data only and no trade execution capability.
- Added an on-demand read-only OANDA H4 chart preview; it does not run strategy analysis.
- Chart navigation and saved-OANDA layout were stabilized: pan/zoom state is preserved, Reset view is explicit, and saved provenance is compactly presented. Live OANDA observation remains experimental.
- Chart navigation and saved-OANDA layout were stabilized: pan/zoom state is preserved, Reset view is explicit, and saved provenance is compactly presented. Live OANDA observation remains experimental.
