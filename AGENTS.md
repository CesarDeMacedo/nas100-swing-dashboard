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

The live OANDA feature is experimental and is not approved as complete. Its intended design is a server-side OANDA pricing stream relayed to the browser through local SSE. It may update only an open H4 visual candle and must never modify saved report values or strategy decisions. Required remaining work includes robust lifecycle tests for shared subscribers, reconnect, H4 rollover, saved-candle immutability, and saved-report invariance. Do not claim reliable real-time behavior until those tests are complete.

# Immediate Next Steps

1. After the next H4 close, create a new manual OANDA report and verify `alreadyExists: false`.
2. Open that OANDA record through Analysis History → View in dashboard.
3. Confirm real saved OANDA candles, calculated levels, provenance, and source candle time.
4. Keep default mock behavior unchanged until the saved OANDA view is validated.
5. Complete experimental live-stream lifecycle tests before relying on real-time chart behavior.
6. Only after validation, consider explicitly enabling OANDA scheduler mode.
7. Future milestones are cross-market confirmation, event-risk data, notifications, packaging, and optional AI narrative; all remain out of scope for now.

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
