import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

class ResizeObserverMock implements ResizeObserver {
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lightweight-charts')>();

  return {
    ...actual,
    createChart: vi.fn(() => {
      const series = {
        setData: vi.fn(),
        attachPrimitive: vi.fn(),
        detachPrimitive: vi.fn(),
        createPriceLine: vi.fn(),
        removePriceLine: vi.fn(),
        priceToCoordinate: vi.fn((price: number) => price),
      };
      const timeScale = { setVisibleLogicalRange: vi.fn(), fitContent: vi.fn() };

      return {
        addSeries: vi.fn(() => series),
        timeScale: vi.fn(() => timeScale),
        resize: vi.fn(),
        remove: vi.fn(),
        takeScreenshot: vi.fn(() => document.createElement('canvas')),
      };
    }),
  };
});
