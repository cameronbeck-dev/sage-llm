import { create } from 'zustand';
import type { KnowledgePack, KnowledgeFile, KnowledgeChunk } from '@sage/shared';

interface KnowledgeState {
  packs: KnowledgePack[];
  filesByPack: Record<string, KnowledgeFile[]>;
  chunksByPack: Record<string, KnowledgeChunk[]>;
  isLoading: boolean;
  loadPacks: () => Promise<void>;
  createPack: (name: string, description?: string) => Promise<KnowledgePack>;
  updatePack: (packId: string, updates: { name?: string; description?: string | null }) => Promise<void>;
  deletePack: (packId: string) => Promise<void>;
  loadFiles: (packId: string) => Promise<void>;
  loadChunks: (packId: string) => Promise<void>;
  uploadFile: (packId: string, file: File) => Promise<void>;
  attachPack: (conversationId: string, packId: string) => Promise<void>;
  detachPack: (conversationId: string, packId: string) => Promise<void>;
  pollPendingFiles: (packId: string) => void;
}

const pollingTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  packs: [],
  filesByPack: {},
  chunksByPack: {},
  isLoading: false,

  async loadPacks() {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/knowledge/packs');
      if (!res.ok) return;
      const data = (await res.json()) as KnowledgePack[];
      set({ packs: data });
    } finally {
      set({ isLoading: false });
    }
  },

  async createPack(name, description) {
    const res = await fetch('/api/knowledge/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) throw new Error('Failed to create pack');
    const pack = (await res.json()) as KnowledgePack;
    set(s => ({ packs: [pack, ...s.packs] }));
    return pack;
  },

  async updatePack(packId, updates) {
    const res = await fetch(`/api/knowledge/packs/${packId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as KnowledgePack;
    set(s => ({ packs: s.packs.map(p => p.id === packId ? updated : p) }));
  },

  async deletePack(packId) {
    const res = await fetch(`/api/knowledge/packs/${packId}`, { method: 'DELETE' });
    if (!res.ok) return;
    set(s => {
      const filesByPack = { ...s.filesByPack };
      delete filesByPack[packId];
      return { packs: s.packs.filter(p => p.id !== packId), filesByPack };
    });
  },

  async loadFiles(packId) {
    const res = await fetch(`/api/knowledge/packs/${packId}/files`);
    if (!res.ok) return;
    const files = (await res.json()) as KnowledgeFile[];
    set(s => ({ filesByPack: { ...s.filesByPack, [packId]: files } }));
  },

  async loadChunks(packId) {
    const res = await fetch(`/api/knowledge/packs/${packId}/chunks`);
    if (!res.ok) return;
    const chunks = (await res.json()) as KnowledgeChunk[];
    set(s => ({ chunksByPack: { ...s.chunksByPack, [packId]: chunks } }));
  },

  async uploadFile(packId, file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`/api/knowledge/packs/${packId}/files`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    await get().loadFiles(packId);
    get().pollPendingFiles(packId);
  },

  async attachPack(conversationId, packId) {
    await fetch(`/api/knowledge/conversations/${conversationId}/packs/${packId}`, { method: 'POST' });
  },

  async detachPack(conversationId, packId) {
    await fetch(`/api/knowledge/conversations/${conversationId}/packs/${packId}`, { method: 'DELETE' });
  },

  pollPendingFiles(packId) {
    if (pollingTimers[packId]) clearTimeout(pollingTimers[packId]);

    const check = async () => {
      const files = get().filesByPack[packId] ?? [];
      const hasPending = files.some(f => f.status === 'pending' || f.status === 'parsing');
      if (!hasPending) return;

      await get().loadFiles(packId);
      pollingTimers[packId] = setTimeout(check, 2000);
    };

    pollingTimers[packId] = setTimeout(check, 2000);
  },
}));
