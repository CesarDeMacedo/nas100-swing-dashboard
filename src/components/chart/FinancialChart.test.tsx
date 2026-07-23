import { render } from '@testing-library/react';
import { createChart } from 'lightweight-charts';
import { vi } from 'vitest';

import { parseCandleDataset } from '../../domain/candles';
import { currentCandleDatasetSource } from '../../domain/fixtures';
import { FinancialChart, chartNavigationOptions } from './FinancialChart';

describe('FinancialChart lifecycle', () => {
  it('enables zoom, pan, pinch, and scale reset without enabling wheel scrolling', () => {
    expect(chartNavigationOptions.handleScale).toMatchObject({ mouseWheel: true, axisPressedMouseMove: true, axisDoubleClickReset: true, pinch: true });
    expect(chartNavigationOptions.handleScroll).toMatchObject({ pressedMouseMove: true, mouseWheel: false });
  });
  it('mounts the chart and cleans up the chart instance and resize observer', () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = disconnect;
      },
    );

    const result = parseCandleDataset(currentCandleDatasetSource);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const { unmount, rerender } = render(
      <FinancialChart
        candles={result.dataset.candles}
        zones={[]}
        priceLines={[]}
        accessibleLabel="Test NAS100 chart"
      />,
    );
    const chart = vi.mocked(createChart).mock.results.at(-1)?.value;

    expect(createChart).toHaveBeenCalled();
    expect(chart?.addSeries).toHaveBeenCalled();
    rerender(<FinancialChart candles={result.dataset.candles} zones={[]} priceLines={[]} accessibleLabel="Test NAS100 chart" resetKey={1} />);
    const resetChart = vi.mocked(createChart).mock.results.at(-1)?.value;
    expect(resetChart).toBe(chart);
    expect(resetChart?.timeScale().fitContent).toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(chart?.remove).toHaveBeenCalledOnce();
  });
});
