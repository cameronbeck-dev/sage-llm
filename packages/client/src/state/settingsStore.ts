import { create } from 'zustand';

interface ProviderInfo {
  id: string;
  displayName: string;
  models: { id: string; displayName: string }[];
  hasKey?: boolean;
  keyError?: string | null;
}

interface CredentialInfo {
  hasKey: boolean;
  updatedAt: string | null;
}

interface SettingsState {
  provider: string;
  model: string;
  availableProviders: ProviderInfo[];
  credentials: Record<string, CredentialInfo>;
  isLoading: boolean;
  pendingChanges: { provider?: string; model?: string } | null;
  loadSettings: () => Promise<void>;
  loadProviders: () => Promise<void>;
  updateProvider: (provider: string) => void;
  updateModel: (model: string) => void;
  flushPending: () => Promise<void>;
  saveCredential: (provider: string, apiKey: string) => Promise<void>;
  deleteCredential: (provider: string) => Promise<void>;
  loadCredentialStatus: (provider: string) => Promise<CredentialInfo>;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 400;

function debouncedFlush() {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    useSettingsStore.getState().flushPending();
  }, DEBOUNCE_MS);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  provider: 'openai',
  model: 'gpt-4o-mini',
  availableProviders: [],
  credentials: {},
  isLoading: false,
  pendingChanges: null,

  async loadSettings() {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = (await res.json()) as {
        activeProvider: string;
        activeModel: string;
        credentials?: Record<string, CredentialInfo>;
      };
      set({
        provider: data.activeProvider,
        model: data.activeModel,
        credentials: data.credentials ?? {},
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  async loadProviders() {
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) return;
      const data = (await res.json()) as ProviderInfo[];
      set({ availableProviders: data });
    } catch {
      // ignore
    }
  },

  updateProvider(provider) {
    const { pendingChanges } = get();
    set({
      pendingChanges: { ...pendingChanges, provider },
      provider,
    });
    debouncedFlush();
  },

  updateModel(model) {
    const { pendingChanges } = get();
    set({
      pendingChanges: { ...pendingChanges, model },
      model,
    });
    debouncedFlush();
  },

  async flushPending() {
    const stateBefore = useSettingsStore.getState();
    const { pendingChanges } = stateBefore;
    if (!pendingChanges) return;
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeProvider: pendingChanges.provider ?? stateBefore.provider,
        activeModel: pendingChanges.model ?? stateBefore.model,
      }),
    });
    if (res.ok) {
      set({ pendingChanges: null });
    }
  },

  async saveCredential(provider, apiKey) {
    const res = await fetch(`/api/settings/credentials/${provider}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? 'Failed to save credential');
    }
    const data = (await res.json()) as { credentials: Record<string, CredentialInfo> };
    set({ credentials: data.credentials });
  },

  async deleteCredential(provider) {
    const res = await fetch(`/api/settings/credentials/${provider}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error('Failed to delete credential');
    }
    const data = (await res.json()) as { credentials: Record<string, CredentialInfo> };
    set({ credentials: data.credentials });
  },

  async loadCredentialStatus(provider) {
    const res = await fetch(`/api/settings/credentials/${provider}`);
    if (!res.ok) {
      return { hasKey: false, updatedAt: null };
    }
    return (await res.json()) as CredentialInfo;
  },
}));