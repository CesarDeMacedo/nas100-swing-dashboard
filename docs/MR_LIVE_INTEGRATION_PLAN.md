# Mean-Reversion Live Integration — Implementation Handoff

Decisions in this document are FINAL (made with the user in the strategy-definition session
of 2026-07-26); the implementing session should execute, not re-litigate them. Context:
`CHANGELOG.md` ("Mean-Reversion Strategy Kinds") and `src/domain/meanReversionStrategy.ts`.

## Decided strategy (do not re-derive)

- **UPDATED 2026-07-26 (later same day)**: the user asked to run BOTH Double Seven D1 and
  Double Seven H4 live simultaneously, visible together on the chart/app — the earlier "H4 is
  not recommended" note below reflected a D1-only budget and no longer applies as written.
  Both are active, each as its OWN strategy lineage (separate `strategyId`) — see "Two
  independent strategy lineages" under Scope.
- Core: **Double Seven, daily bars, long-only, protective stop 2×ATR(14)** on NAS100.
  Backtested (no costs): 98 trades, 69% win, PF(R) 1.72, +21.5R, max closed-trade DD 3.1R.
- Prop-desk constraint (confirmed 2026-07-26: 5% max daily loss, 10% max total DD): internal
  target 8% of the 10% hard cap.
- **Combined D1+H4 sizing (supersedes the D1-only 1.9% figure)**: re-backtested both at
  protectiveStopAtrMultiple=2 and merged their trade-exit timelines into one equity curve.
  Combined max closed-trade DD = **8.72R** (both strategies overlap significantly on the same
  instrument/direction — their drawdowns are correlated, not additive, but combining still
  digs slightly deeper than H4 alone at ~7.1R). Combined net = 70.6R over the full cached
  history (642 trades total).
  **Risk per trade: 0.75%** of account, shared by both strategies (= 8% / (8.72R DD + 2R
  floating buffer, since two strategies can each hold one open position at once)), configured
  via `NAS100_MR_RISK_PER_TRADE_PCT` (account-level env var, applies uniformly to every active
  MR strategy — see `evaluateActiveMeanReversionStrategies` in `server.ts`). Daily-loss check:
  worst-case same-day double stop-out (~3R) at 0.75% ≈ 2.24% < 5%.
- No-stop variants are for research only — never suggest them for the prop account.

## Scope

1. **Persist config v15**: strategy `1cd2f98d-e811-4183-b4e6-0552cb69cd61`, next version,
   name `v15 - Double Seven D1 stop 2xATR (mesa proprietaria)`, parameters = existing v12
   parameters with `meanReversion.protectiveStopAtrMultiple: 2`. Activate it
   (`activateStrategyVersion`). Use `AnalysisRepository.saveStrategyConfig` (the Zod choke
   point) — never raw SQL.
2. **Live evaluator** (new module, e.g. `src/service/meanReversionRun.ts`): given fresh OANDA
   candles (completed bars only) and an active MR-kind strategy config, compute the current
   state by running `runMeanReversionBacktest` over the recent window and inspecting the last
   trade/position:
   - `signal: 'ENTER' | 'HOLD' | 'EXIT' | 'FLAT'` (ENTER = entry condition true on the just-
     completed bar; EXIT = exit/stop condition true while a position is tracked).
   - Include: reference close, computed stop price (entry − 2×ATR), ATR, SMA200 filter state,
     and suggested position size for a configurable `riskPerTradePct` (default 0.73) and
     account size (config/env, e.g. `NAS100_MR_ACCOUNT_SIZE`; if unset, report size in % only).
   - Daily bars come from the existing daily fetch (`getDailyCandles` path used by
     `oandaRun.ts`); H4 from the H4 fetch. Completed bars only — same rule as the pipeline.
3. **Scheduler hook**: on each existing scheduler slot (no new slots), after the pipeline run,
   evaluate every ACTIVE strategy config whose `strategyKind` is `rsi2`/`double7` and send one
   OS notification via the existing `node-notifier` path (`schedulerNotifications.ts` pattern)
   when the signal is ENTER or EXIT (HOLD/FLAT: no notification, but persist the evaluation).
   Persist evaluations (new small table in the production SQLite via `AnalysisRepository`,
   or reuse the analysis-run pattern — follow whichever existing pattern is closest; keep
   records immutable).
4. **Dashboard panel**: a read-only panel (pattern: `StrategyManagerPanel`/`BacktestResultsPanel`)
   listing each active MR strategy with its latest evaluation: signal, reference price, stop,
   suggested size, evaluation time. Served by a new GET route following the `/backtests` pattern
   (service reads its own DB; browser never touches OANDA).

## Hard constraints (safety — violating any of these is a failed implementation)

- The app is analysis-only. No order placement, no broker integration, nothing that executes.
- Do NOT touch `safetyConstrainedState` in `src/service/oandaRun.ts`, the Patience Filter, or
  any pipeline entry-authorization logic. The MR path is parallel and additive.
- The `minRewardRisk >= 2.0` floor stays enforced for `strategyKind: 'pipeline'`; MR kinds do
  not consult it (already implemented — do not "fix" this).
- Completed candles only; never evaluate on an open bar.
- All new behavior behind the existing patterns: Zod at write paths, immutable records,
  server binds 127.0.0.1.

## Acceptance

- `npm run typecheck` and `npm test` green; new unit tests for the evaluator's signal
  derivation (ENTER/HOLD/EXIT/FLAT from a crafted candle series) and the sizing math.
- Manual: `npm run service` + a manual scheduler-style invocation produces a persisted
  evaluation and (on ENTER/EXIT) an OS notification; dashboard panel renders it.
- No changes to pipeline behavior: existing tests must pass unmodified except where a shared
  type gained an additive field.

## Follow-up work (2026-07-26, same-day second round)

1. **Two independent strategy lineages, run simultaneously.** `activateStrategyVersion`
   enforces at most one `active` version PER `strategyId` (draft->active->archived is a
   version history for ONE named strategy, not a global "one active MR strategy" limit).
   Running D1 and H4 live at the same time requires the H4 strategy to live under its OWN
   `strategyId`, not a new version of the D1 lineage — created via a one-off script mirroring
   `persistMrV15Strategy.ts` (`saveStrategyConfig` + `activateStrategyVersion` on a fresh
   `randomUUID()` strategyId), with `meanReversion: { timeframe: 'H4', protectiveStopAtrMultiple: 2, ... }`.
2. **Real bug found and fixed: `listLatestMeanReversionEvaluations` didn't filter by active
   status.** Its own docstring said "current signal per ACTIVE MR strategy" but the SQL only
   grouped by `strategy_config_id` with no join back to `strategy_configs.status` — so once a
   strategy accumulates more than one version in its history (draft -> active -> archived), an
   archived version's last evaluation kept showing up in `/mr-evaluations` forever, alongside
   the current one, including a stale suggested position size computed under whatever risk%
   was in effect back then. Fixed with an added `INNER JOIN strategy_configs ... status =
'active'`; regression test added in `analysisRepository.test.ts` (two versions of one
   strategy, only the active one's evaluation surfaces).
3. **Incident, not a code bug: v14 (an H4 research-only backtest config, no stop) got
   activated at some point after v15 (D1, the real live strategy) had already been activated
   — which per `activateStrategyVersion`'s archive-then-promote transaction silently archived
   v15.** Root cause not fully reconstructed (a second session — the Sonnet implementation
   session — was operating against the same real SQLite file concurrently; most likely
   explanation is it exercised v14 directly for some verification and that flipped the active
   flag). No live financial exposure was mis-sized: v14 has no protective stop configured, so
   its evaluation could only ever report `stopPrice: null` / no sizing, and it was FLAT (no
   open position) at the time this was caught. Fixed by cloning v15's exact parameters into a
   new v16 and activating that (versions are one-way — archived can't be re-activated
   directly, only a new version can be promoted). **Lesson for future sessions: don't assume
   which version is active without checking `listStrategies('active')` first, especially when
   another session might be operating on the same production SQLite file.**
4. **UI**: `MeanReversionStrategyCard` now renders one card per active MR strategy (not just
   the first); `mapMeanReversionPriceLines` accepts the full evaluation array and gives each
   timeframe its own color pair + labeled title (`MR entry (D1)`/`MR entry (H4)`, etc.) so two
   simultaneously-tracked positions are never visually ambiguous on the shared H4 chart.
5. **Pipeline-only UI removed from the default view** (user request, separate from the MR
   work): `PrimaryActionBanner`, `SetupSummary`, and the sidebar's `WhyNoEntryCard`/
   `SetupScoreCard`/`NextActionCard`/`MarketContextCard` are no longer rendered by
   `Dashboard`/`AnalysisSidebar` — the pipeline strategy is dormant (near-zero signal rate)
   and the actual live strategies are the MR ones. The components/tests for the underlying
   pipeline computation are untouched; only their default-view rendering was removed. Several
   `App.test.tsx` assertions that used the banner's `aria-label` as a convenience proxy for
   "did the right data reach the screen" were updated to check an equivalent surviving signal
   instead (or removed, where the safety property they protected is independently covered at
   the domain level, e.g. `buildDashboardState.test.ts`'s open-candle fixture case).
