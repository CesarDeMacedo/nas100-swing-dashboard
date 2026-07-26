# Mean-Reversion Live Integration — Implementation Handoff

Decisions in this document are FINAL (made with the user in the strategy-definition session
of 2026-07-26); the implementing session should execute, not re-litigate them. Context:
`CHANGELOG.md` ("Mean-Reversion Strategy Kinds") and `src/domain/meanReversionStrategy.ts`.

## Decided strategy (do not re-derive)

- Core: **Double Seven, daily bars, long-only, protective stop 2×ATR(14)** on NAS100.
  Backtested (no costs): 98 trades, 69% win, PF(R) 1.72, +21.5R, max closed-trade DD 3.1R.
- Prop-desk constraint (UPDATED 2026-07-26, after the user confirmed the desk's actual rules:
  5% max daily loss, 10% max total DD): internal target 8% of the 10% hard cap.
  **Risk per trade: 1.9%** of account (= 8% / (3.1R DD + 1R floating buffer)), configured via
  `NAS100_MR_RISK_PER_TRADE_PCT` (account-level env var; code default remains the conservative
  0.73% from the original 4%-cap sizing). Daily-loss check: worst realistic day is a gap
  through the stop (~1.5R) ≈ 2.9% < 5%.
- The H4 variant (PF 1.26–1.32, DD 7.3R) is displayed for information if cheap to include,
  but is NOT the recommended live strategy; under a shared DD budget it adds ~nothing.
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
