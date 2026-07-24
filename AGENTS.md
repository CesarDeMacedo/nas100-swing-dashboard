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

`.env` is local and ignored by Git. The service CLI loads the project-root `.env`; existing operating-system variables retain priority. `NAS100_DASHBOARD_SCHEDULER_PROVIDER` defaults to `fixture`; OANDA scheduling requires explicit opt-in.

# Current Architecture

The deterministic pipeline includes indicators, Daily Regime, H4 Structure, Trade Plan, Patience Filter, Strategy Decision, Setup Score, and report generation. The mock dashboard remains the default after reload.

Manual OANDA analysis fetches separate H4 and Daily datasets. Daily candles feed Daily Regime only; H4 candles feed H4 Structure and decision logic. Open candles are excluded from confirmed reports. OANDA support, resistance, entry, and invalidation levels are calculated from completed H4 swings. Saved OANDA reports contain immutable, non-sensitive display snapshots and eligible records can be opened from Analysis History in the main dashboard.

OANDA Chart Preview is an on-demand, chart-only visual tool and does not run strategy analysis. The scheduler is local and in-process, uses the approved America/Toronto schedule, and defaults to the fixture provider.

The shared candlestick chart supports zoom, drag-to-pan, price-scale adjustment, pinch zoom, double-click scale reset, and explicit Reset view. Chart identity is stable so live/overlay updates do not reset the user viewport.

# Current Worktree Status

Future agents must run `git status` and inspect the diff before changing anything. Recent work may be intentionally uncommitted, including optional OANDA scheduler mode, saved OANDA dashboard display snapshots, experimental live OANDA H4 observation work, and OANDA Chart Preview. Do not discard, reset, stash, overwrite, or commit these changes blindly.

# Experimental Live-Price Feature

The live OANDA feature is opt-in and still labeled experimental. Its design is a server-side OANDA pricing stream relayed to the browser through local SSE. It updates only an open H4 visual candle and never modifies saved report values or strategy decisions. Lifecycle tests for shared subscribers, reconnect/backoff, H4 rollover, saved-candle immutability, and saved-report invariance are complete (`src/service/liveStream.test.ts`); two real bugs (late-subscriber replay, reconnect-backoff bypass) were found and fixed during that work.

# Immediate Next Steps

Steps 1-5 of the original validation sequence (manual OANDA report after H4 close, saved-view review, mock-default regression check, live-stream lifecycle tests) are complete. Standing items:

1. Enabling OANDA scheduler mode in production remains an explicit, separate decision — not advanced without direct approval.
2. Future milestones are cross-market confirmation, event-risk data, notifications, PNG export, Windows packaging, and optional AI narrative (`docs/IMPLEMENTATION_PLAN.md` phases 11-13, 15-16) — all remain out of scope until explicitly approved.
3. A batch of smaller improvements (test coverage, doc hygiene, live-stream structural cleanup, data-health states, history screen, PNG export) may be in progress or completed under separate approval — check recent commits and `git log` rather than assuming this file is exhaustive.

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
