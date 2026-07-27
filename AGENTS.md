# Project Overview

This repository is a local-first NAS100 Swing Intelligence Dashboard. It is analysis-only: it must never execute, place, modify, or close trades. The frontend is React/Vite/TypeScript and the backend is a local Node service. SQLite stores immutable local reports and runs. OANDA v20 supplies read-only market data; credentials remain server-side only.

# Non-Negotiable Safety Rules

- Never expose API tokens, account IDs, authorization headers, raw provider responses, or `.env` contents.
- Never stage, commit, or push `.env`, SQLite files, WAL files, or secrets.
- Never use an open H4 candle for a confirmed BUY or SELL.
- The Patience Filter always overrides score and technical bias.
- Minimum actionable R:R is 2.0.
- Missing, stale, invalid, unavailable, cross-market, or event-risk data must fail safely.
- The browser must never connect directly to OANDA.
- No automated trading or broker integration exists or is permitted.
- Preserve immutable persisted reports; never silently overwrite historical records.
- Never mix mock values into a saved OANDA analysis view.

# Local Commands

```text
npm run dev
npm run service
npm run typecheck
npm run test
npm run build
```

The service is local-only, binds to `127.0.0.1`, and defaults to port `4310`.

# Environment Configuration

Variable names:

- `OANDA_ENVIRONMENT`
- `OANDA_ACCOUNT_ID`
- `OANDA_API_TOKEN`
- `OANDA_NAS100_INSTRUMENT`
- `NAS100_DASHBOARD_SCHEDULER_ENABLED`
- `NAS100_DASHBOARD_SCHEDULER_PROVIDER`
- `NAS100_DASHBOARD_DB_PATH`
- `NAS100_DASHBOARD_PORT`
- `NAS100_MR_ACCOUNT_SIZE` (mean-reversion live position sizing; unset means "report size in % only")
- `NAS100_MR_RISK_PER_TRADE_PCT` (mean-reversion risk per trade, shared across every active MR strategy; defaults to a conservative 0.73% if unset)

`.env` is local and ignored by Git. The service CLI loads the project-root `.env`; existing operating-system variables retain priority. `NAS100_DASHBOARD_SCHEDULER_PROVIDER` defaults to `fixture`; OANDA scheduling requires explicit opt-in.

# Current Architecture

The deterministic pipeline includes indicators, Daily Regime, H4 Structure, Trade Plan, Patience Filter, Strategy Decision, Setup Score, and report generation. The mock dashboard remains the default after reload.

Manual OANDA analysis fetches separate H4 and Daily datasets. Daily candles feed Daily Regime only; H4 candles feed H4 Structure and decision logic. Open candles are excluded from confirmed reports. OANDA support, resistance, entry, and invalidation levels are calculated from completed H4 swings. Saved OANDA reports contain immutable, non-sensitive display snapshots and eligible records can be opened from Analysis History in the main dashboard.

OANDA Chart Preview is an on-demand, chart-only visual tool and does not run strategy analysis; it can export itself as a PNG. The scheduler is local and in-process, uses the approved America/Toronto schedule, and defaults to the fixture provider. The scheduler's OANDA fetch retries with backoff on transient errors or a stale/not-yet-available H4 candle, without ever accepting data from the wrong H4 window (C4). Both the manual and scheduled OANDA paths fetch live cross-market H4 confirmation (US500/US30/Russell 2000, same OANDA account, A1) and an event-risk validation spike (unofficial Forex Factory feed, A2, not a production commitment). Entry authorization from the OANDA pipeline stays hard-blocked regardless of either input — see `docs/DECISIONS.md` ADR-016 — until a production-grade event-risk provider is resolved. Scheduler outcomes trigger a local, informational-only OS notification via `node-notifier` (A5).

The shared candlestick chart supports zoom, drag-to-pan, price-scale adjustment, pinch zoom, double-click scale reset, and explicit Reset view. Chart identity is stable so live/overlay updates do not reset the user viewport.

# Mean-Reversion Strategies (the strategies actually being traded live)

The original pipeline above is dormant in practice (near-zero signal rate over 8 years of backtesting) and its default-view UI (action banner, setup score, and the sidebar's why-no-entry/next-action/market-context cards) has been removed — its computation, tests, and components are untouched, just unmounted. What the user actually trades day-to-day is Connors-style mean reversion (`strategyKind: 'rsi2' | 'double7'`, pure engine in `src/domain/meanReversionStrategy.ts`), evaluated live on every scheduler slot (`src/service/meanReversionRun.ts`) and shown in a persistent sidebar card + chart overlay + history panel (`MeanReversionStrategyCard`, `mapMeanReversionPriceLines`, `MeanReversionPanel`).

Two Double Seven strategies run simultaneously — D1 and H4 — each as its OWN strategy lineage (separate `strategyId`; `activateStrategyVersion` only allows one active version per lineage, not one active MR strategy globally). Sizing (`NAS100_MR_RISK_PER_TRADE_PCT`) is derived from the COMBINED backtested drawdown of both running together, not either alone — see `docs/MR_LIVE_INTEGRATION_PLAN.md` for the full derivation and a running log of incidents/fixes found while building this (including a real bug in `listLatestMeanReversionEvaluations` and a mis-activated strategy version). **Before assuming which version is active, call `listStrategies('active')` — do not trust memory of a prior session, especially since multiple sessions may operate on the same production SQLite file.**

Double Seven has no fixed exit price (the exit is a re-evaluated condition, an N-bar closing high) — `computeDouble7ExitWatchPrice` exposes the solvable "close at or above this and it exits" threshold wherever entry/stop are shown.

# Current Worktree Status

Future agents must run `git status` and inspect the diff before changing anything. Recent work may be intentionally uncommitted, including optional OANDA scheduler mode, saved OANDA dashboard display snapshots, experimental live OANDA H4 observation work, and OANDA Chart Preview. Do not discard, reset, stash, overwrite, or commit these changes blindly.

# Experimental Live-Price Feature

The live OANDA feature is opt-in and still labeled experimental. Its design is a server-side OANDA pricing stream relayed to the browser through local SSE. It updates only an open H4 visual candle and never modifies saved report values or strategy decisions. Lifecycle tests for shared subscribers, reconnect/backoff, H4 rollover, saved-candle immutability, and saved-report invariance are complete (`src/service/liveStream.test.ts`); two real bugs (late-subscriber replay, reconnect-backoff bypass) were found and fixed during that work.

# Immediate Next Steps

Steps 1-5 of the original validation sequence (manual OANDA report after H4 close, saved-view review, mock-default regression check, live-stream lifecycle tests) are complete. Standing items:

1. Enabling OANDA scheduler mode in production remains an explicit, separate decision — not advanced without direct approval.
2. Cross-market confirmation (A1), scheduler retry/backoff (C4), scheduler notifications (A5), and an event-risk validation spike (A2) are implemented — see `docs/DECISIONS.md` ADR-014/ADR-016. Entry authorization from the OANDA pipeline stays hard-blocked regardless of any of these inputs; do not loosen `safetyConstrainedState` in `src/service/oandaRun.ts` without explicit, separate approval — it's the sole entry gate for that pipeline (`enforceAnalysisSafety` only runs client-side).
3. Remaining future milestones: a production-grade event-risk provider (to replace the A2 spike), Windows packaging, and optional AI narrative (`docs/IMPLEMENTATION_PLAN.md` phases 13, 15-16) — all remain out of scope until explicitly approved.
4. A batch of smaller improvements (test coverage, doc hygiene, live-stream structural cleanup, OANDA status badge, history search/filter, PNG export) may be in progress or completed under separate approval — check recent commits and `git log` rather than assuming this file is exhaustive.

# Git Workflow

- Make small, focused commits only after user review.
- Always inspect `git status` and `git diff` before staging.
- Never use `git reset --hard` or discard user changes.
- Do not push without explicit user approval.
- Existing checkpoint history is useful, but the current repository state is authoritative.

# Working Style

- Prefer small, testable phases.
- Keep prompts and documentation updates concise to conserve model credits.
- Do not reread the entire PRD for narrow tasks.
- Run only typecheck, tests, and build when requested.
- Avoid screenshots and browser automation unless visual changes require review.
