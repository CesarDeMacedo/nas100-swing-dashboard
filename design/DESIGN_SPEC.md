# NAS100 Dashboard Design Specification

## Approved references

Main interface reference:

`/design/nas100-dashboard-approved-template-v1.png`

Real chart reference:

`/design/nas100-oanda-h4-chart-reference.png`

## Important rule

Do not use either image as a background or as part of the final application interface.

Recreate the dashboard with real React components.

The candlestick chart must be rendered from structured OHLC market data using a financial chart library.

## Preserve from the approved template

- 16:9 desktop composition
- dark navy and black background
- large chart area on the left
- stacked analysis cards on the right
- dominant action banner at the top
- score, grade, regime, status, and bias summary
- green support zones
- red resistance and invalidation zones
- orange WAIT guidance
- bottom metrics strip
- premium financial-dashboard appearance
- high contrast and large readable typography

## Dynamic action states

The interface must support:

- BUY
- SELL
- WAIT
- NO TRADE
- WAIT FOR PULLBACK
- WAIT FOR NEXT 4H CLOSE

All text, scores, prices, levels, and chart markers must come from the same structured analysis JSON.
