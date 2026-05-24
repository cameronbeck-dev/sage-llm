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

export interface RoleModel {
  provider: string;
  model: string;
}

interface SettingsState {
  provider: string | null;
  model: string | null;
  availableProviders: ProviderInfo[];
  credentials: Record<string, CredentialInfo>;
  isLoading: boolean;
  pendingChanges: {
    provider?: string;
    model?: string;
    chatModel?: RoleModel | null;
    wikiMaintenanceModel?: RoleModel | null;
    factExtractionModel?: RoleModel | null;
  } | null;
  monthlyBudgetUsd: number | null;
  chatModel: RoleModel | null;
  wikiMaintenanceModel: RoleModel | null;
  factExtractionModel: RoleModel | null;
  loadSettings: () => Promise<void>;
  loadProviders: () => Promise<void>;
  updateProvider: (provider: string) => void;
  updateModel: (model: string) => void;
  setChatModel: (value: RoleModel | null) => void;
  setWikiMaintenanceModel: (value: RoleModel | null) => void;
  setFactExtractionModel: (value: RoleModel | null) => void;
  flushPending: () => Promise<void>;
  saveCredential: (provider: string, apiKey: string) => Promise<void>;
  deleteCredential: (provider: string) => Promise<void>;
  loadCredentialStatus: (provider: string) => Promise<CredentialInfo>;
  saveBudget: (monthlyBudgetUsd: number | null) => Promise<void>;
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
  provider: null as string | null,
  model: null as string | null,
  availableProviders: [],
  credentials: {},
  isLoading: true,
  pendingChanges: null,
  monthlyBudgetUsd: null,
  chatModel: null,
  wikiMaintenanceModel: null,
  factExtractionModel: null,

  async loadSettings() {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = (await res.json()) as {
        activeProvider: string;
        activeModel: string;
        credentials?: Record<string, CredentialInfo>;
        monthlyBudgetUsd?: number | null;
        chatModel?: RoleModel | null;
        wikiMaintenanceModel?: RoleModel | null;
        factExtractionModel?: RoleModel | null;
      };
      set({
        provider: data.activeProvider,
        model: data.activeModel,
        credentials: data.credentials ?? {},
        monthlyBudgetUsd: data.monthlyBudgetUsd ?? null,
        chatModel: data.chatModel ?? null,
        wikiMaintenanceModel: data.wikiMaintenanceModel ?? null,
        factExtractionModel: data.factExtractionModel ?? null,
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

  setChatModel(value) {
    const { pendingChanges } = get();
    set({ pendingChanges: { ...pendingChanges, chatModel: value }, chatModel: value });
    debouncedFlush();
  },

  setWikiMaintenanceModel(value) {
    const { pendingChanges } = get();
    set({ pendingChanges: { ...pendingChanges, wikiMaintenanceModel: value }, wikiMaintenanceModel: value });
    debouncedFlush();
  },

  setFactExtractionModel(value) {
    const { pendingChanges } = get();
    set({ pendingChanges: { ...pendingChanges, factExtractionModel: value }, factExtractionModel: value });
    debouncedFlush();
  },

  async flushPending() {
    const stateBefore = useSettingsStore.getState();
    const { pendingChanges } = stateBefore;
    if (!pendingChanges) return;
    const body: Record<string, unknown> = {
      activeProvider: pendingChanges.provider ?? stateBefore.provider,
      activeModel: pendingChanges.model ?? stateBefore.model,
    };
    if ('chatModel' in pendingChanges) body.chatModel = pendingChanges.chatModel;
    if ('wikiMaintenanceModel' in pendingChanges) body.wikiMaintenanceModel = pendingChanges.wikiMaintenanceModel;
    if ('factExtractionModel' in pendingChanges) body.factExtractionModel = pendingChanges.factExtractionModel;
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  async saveBudget(monthlyBudgetUsd) {
    const res = await fetch('/api/settings/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudgetUsd }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? 'Failed to save budget');
    }
    set({ monthlyBudgetUsd });
  },
}));