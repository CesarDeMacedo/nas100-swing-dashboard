# Design QA

## Findings

No actionable P0, P1, or P2 findings remain for Phase 2.

## Open Questions

- The approved dashboard reference shows a different market state (`WAIT / NO TRADE`, score 53) than the validated Phase 2 mock (`WAIT_FOR_PULLBACK`, score 74). The comparison therefore evaluates composition, hierarchy, chart behavior, and visual treatment rather than exact copy or numeric equality.
- The market-data provider remains unresolved, but it does not affect the deterministic Phase 2 mock chart.

## Evidence

- Source visual truth: `design/nas100-dashboard-approved-template-v1.png`
- Chart behavior reference: `design/nas100-oanda-h4-chart-reference.png`
- Browser implementation: `screenshots/phase-2/full-desktop-dashboard.png`
- Focused chart: `screenshots/phase-2/chart-focused.png`
- Normalized side-by-side comparison: `screenshots/phase-2/approved-comparison.png`
- Comparison page: `screenshots/phase-2/comparison.html`
- Browser viewport: 2134 x 1051 CSS pixels
- Approved dashboard pixels: 1672 x 941
- OANDA chart-reference pixels: 2736 x 1260
- Implementation pixels: 2134 x 1052
- Focused chart pixels: 1233 x 770
- Comparison pixels: 2666 x 1226
- Density normalization: the side-by-side page places the approved reference and browser capture in equal-width 16:9 containers with `object-fit: contain`; browser chrome is excluded.
- State: `WAIT_FOR_PULLBACK`, score 74, grade B, mock freshness, latest H4 candle completed

## Full-View Comparison

The implementation preserves the reference's desktop hierarchy: compact instrument identity, dominant action banner, adjacent score/regime summary, a large left chart, stacked analysis cards on the right, and a full-width metrics strip. The chart now provides authentic financial-chart behavior while remaining visually integrated with the near-black/navy dashboard.

The reference and implementation deliberately differ in market state and candle history. Phase 2 does not reproduce the OANDA broker toolbar, drawing tools, or exact historical candles. Those omissions are required product constraints, not fidelity defects.

## Focused-Region Comparison

The focused capture verifies that the chart renders OHLC candlesticks, right-side price scale, bottom time scale, support/resistance/entry bands, current price, invalidation, stop, and targets without label collision. The centered decision message wraps fully, and the completed-H4 status remains readable without obscuring the active candles.

## Required Fidelity Surfaces

- Fonts and typography: Barlow Condensed retains the narrow financial-display character of the reference; Inter is used for compact body copy. Labels remain readable at the verified viewport with no unintended clipping or negative letter spacing.
- Spacing and layout rhythm: chart/sidebar proportions, header density, compact card gaps, restrained radii, and footer height follow the approved composition. The chart fills its panel without changing surrounding layout dimensions.
- Colors and tokens: bullish candles and support use restrained green; bearish candles and resistance/risk use red; WAIT guidance uses orange; data context uses cyan; dark panel, grid, border, and scale tokens remain consistent.
- Image and asset fidelity: neither approved image is embedded in the application. The chart is rendered from structured OHLC data with Lightweight Charts. No CSS-drawn or raster candle substitute is used.
- Copy and content: all visible market facts, action text, levels, overlays, and sidebar narratives come from the validated analysis object or the validated candle dataset. The chart adds only static interface labels and attribution.

## Browser Verification

- The local dashboard loaded successfully at `http://localhost:4173/`.
- Lightweight Charts mounted seven internal canvases and rendered 90 deterministic H4 candles.
- Moving the pointer across the plot produced the native interactive crosshair behavior.
- The latest status displayed `Completed H4`.
- Chart and page resize behavior were exercised at the active desktop viewport; document `scrollWidth` equaled `clientWidth` at 2134 CSS pixels.
- The chart, decision overlay, status, legend, sidebar, and metrics strip had no visible overlap.
- Browser console errors: none.
- Automated tests cover chart mounting/cleanup, adapter mapping, invalid candle data, open-candle safety, and existing dashboard data binding.

## Comparison History

### Phase 2 Iteration 1

- Finding: P2 resistance and target levels above the candle range were initially excluded from autoscaling, and right-aligned zone labels competed with native price-line badges.
- Fix: the price-zone primitive now contributes zone boundaries and price-line values to autoscale, and zone labels are inset from the price scale.
- Post-fix evidence: `screenshots/phase-2/autoscale-review.png`, `screenshots/phase-2/chart-focused.png`, and `screenshots/phase-2/approved-comparison.png` show all upper levels with separated labels.

### Phase 2 Iteration 2

- Finding: P2 decision rationale was restricted to a single ellipsized line inside the chart overlay.
- Fix: removed the truncation constraint and enabled normal multiline wrapping while retaining the dominant action label.
- Post-fix evidence: `screenshots/phase-2/chart-focused.png` shows the complete rationale on two lines without obscuring the current recovery candles.

### Prior Phase 1 Banner Fix

- Finding: P2 primary action supporting text was clipped in the `WAIT_FOR_PULLBACK` state.
- Fix: removed restrictive overflow/no-wrap rules and allowed the banner to grow naturally.
- Phase 2 regression result: the full dashboard capture confirms the banner copy remains fully visible after chart integration.

## Implementation Checklist

- [x] Real candlestick series replaces the Phase 1 placeholder.
- [x] Structured candle data and analysis data are validated independently.
- [x] Price zones use chart-scale coordinates rather than fixed vertical guesses.
- [x] Price lines and decision/status overlays remain readable.
- [x] Resize observer and chart instance are cleaned up on unmount.
- [x] Desktop layout has no horizontal overflow.
- [x] Source and implementation were reviewed in one normalized comparison.

## Follow-up Polish

- P3: add a dedicated fixture-view route in a later approved phase if browser screenshots of every safety state become a product requirement. Phase 2 verifies the open-candle state through component tests rather than adding production fixture controls.
- P3: live-provider sessions may require session-break and exchange-hours formatting once a provider is selected.

final result: passed
