import { create } from 'zustand';

type DashboardState = {
  selectedReportId: string | null;
  dataState: 'idle' | 'ready' | 'error';
  setReady: (reportId: string) => void;
  setError: () => void;
  reset: () => void;
};

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedReportId: null,
  dataState: 'idle',
  setReady: (reportId) => set({ selectedReportId: reportId, dataState: 'ready' }),
  setError: () => set({ selectedReportId: null, dataState: 'error' }),
  reset: () => set({ selectedReportId: null, dataState: 'idle' }),
}));
