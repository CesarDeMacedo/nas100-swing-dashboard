import { render } from '@testing-library/react';
import { createChart } from 'lightweight-charts';
import { vi } from 'vitest';

import { parseCandleDataset } from '../../domain/candles';
import { currentCandleDatasetSource } from '../../domain/fixtures';
import { FinancialChart } from './FinancialChart';

describe('FinancialChart lifecycle', () => {
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

    const { unmount } = render(
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
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(chart?.remove).toHaveBeenCalledOnce();
  });
});
