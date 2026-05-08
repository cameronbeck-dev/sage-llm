import { create } from 'zustand';
import type { UsageReport } from '@sage/shared';

interface UsageState {
  report: UsageReport | null;
  isLoading: boolean;
  error: string | null;
  from: string | null;
  to: string | null;
  loadReport: (from?: string, to?: string) => Promise<void>;
  setRange: (from: string | null, to: string | null) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  report: null,
  isLoading: false,
  error: null,
  from: null,
  to: null,

  async loadReport(from, to) {
    set({ isLoading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString() ? '?' + params.toString() : '';
      const res = await fetch('/api/usage' + qs, { credentials: 'include' });
      if (!res.ok) {
        set({ error: `Failed to load usage (${res.status})`, isLoading: false });
        return;
      }
      const report = (await res.json()) as UsageReport;
      set({ report, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  setRange(from, to) {
    set({ from, to });
  },
}));
