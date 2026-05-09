import { create } from 'zustand';
import type { Conversation, Message } from '@sage/shared';
import type { SageState } from '../hooks/useSageState';

interface ConversationState {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeMessages: Message[];
  streamingText: string;
  isStreaming: boolean;
  thinkingMessageId: string | null;
  previousConversationId: string | null;
  sageState: SageState;
  sageMessage: string;
  lastTurnCostUsd: number | null;
  loadConversations: () => Promise<void>;
  createConversation: (title?: string) => Promise<string>;
  setActive: (id: string | null) => Promise<void>;
  setThinkingMessage: (id: string) => void;
  updateThinkingMessage: (delta: string) => void;
  appendThinkingDelta: (delta: string) => void;
  setStreamingError: (errorMessage: string) => void;
  finalizeStreaming: () => void;
  addMessage: (message: Message) => void;
  deleteConversation: (id: string) => Promise<void>;
  setSageState: (state: SageState) => void;
  setSageMessage: (message: string) => void;
  updateConversationTitle: (id: string, title: string) => Promise<void>;
  setLastTurnCost: (value: number | null) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  activeMessages: [],
  streamingText: '',
  isStreaming: false,
  thinkingMessageId: null,
  previousConversationId: null,
  sageState: 'idle',
  sageMessage: 'Ready when you are.',
  lastTurnCostUsd: null,

  async loadConversations() {
    const res = await fetch('/api/conversations');
    if (!res.ok) return;
    const data = (await res.json()) as Conversation[];
    set({ conversations: data });
  },

  async createConversation(title) {
    const state = get();
    const prevId = state.activeConversationId ?? state.previousConversationId;
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, previousId: prevId }),
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    const convo = (await res.json()) as Conversation;
    set((s) => ({ conversations: [convo, ...s.conversations], previousConversationId: prevId }));
    return convo.id;
  },

  async setActive(id) {
    if (id === null) {
      set((s) => ({
        activeConversationId: null,
        previousConversationId: s.activeConversationId ?? s.previousConversationId,
        activeMessages: [],
        streamingText: '',
        isStreaming: false,
        thinkingMessageId: null,
      }));
      return;
    }
    set({ activeConversationId: id, activeMessages: [], streamingText: '', isStreaming: false, thinkingMessageId: null });
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as Conversation & { messages: Message[] };
    set({ activeMessages: data.messages });
  },

  setThinkingMessage(id) {
    set({ thinkingMessageId: id, isStreaming: true });
  },

  updateThinkingMessage(delta) {
    set((s) => {
      const msgs = s.activeMessages;
      const idx = msgs.findIndex((m) => m.id === s.thinkingMessageId);
      if (idx === -1) return {};
      const updated = [...msgs];
      const existing = updated[idx].content.find((b) => b.type === 'text');
      const newText = (existing?.text ?? '') + delta;
      updated[idx] = {
        ...updated[idx],
        content: [{ type: 'text', text: newText }],
      };
      return { activeMessages: updated };
    });
  },

  appendThinkingDelta(delta) {
    set((s) => {
      const msgs = s.activeMessages;
      const idx = msgs.findIndex((m) => m.id === s.thinkingMessageId);
      if (idx === -1) return {};
      const updated = [...msgs];
      updated[idx] = {
        ...updated[idx],
        thinking: (updated[idx].thinking ?? '') + delta,
      };
      return { activeMessages: updated };
    });
  },

  setStreamingError(errorMessage: string) {
    set((s) => {
      const msgs = s.activeMessages;
      const idx = msgs.findIndex((m) => m.id === s.thinkingMessageId);
      if (idx === -1) return { isStreaming: false, thinkingMessageId: null };
      const updated = [...msgs];
      updated[idx] = {
        ...updated[idx],
        role: 'assistant',
        content: [{ type: 'text', text: errorMessage }],
      };
      return { activeMessages: updated, isStreaming: false, thinkingMessageId: null };
    });
  },

  finalizeStreaming() {
    set({ isStreaming: false, thinkingMessageId: null });
  },

  addMessage(message) {
    set((s) => ({ activeMessages: [...s.activeMessages, message] }));
  },

  async deleteConversation(id) {
    const res = await fetch('/api/conversations/' + id, { method: 'DELETE' });
    if (!res.ok) return;
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      if (s.activeConversationId === id) {
        return {
          conversations,
          activeConversationId: null,
          activeMessages: [],
          streamingText: '',
          isStreaming: false,
          thinkingMessageId: null,
        };
      }
      return { conversations };
    });
  },

  setSageState(state: SageState) {
    set({ sageState: state });
  },

  setSageMessage(message: string) {
    set({ sageMessage: message });
  },

  async updateConversationTitle(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    });
    if (!res.ok) return;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title: trimmed } : c
      ),
    }));
  },

  setLastTurnCost(value: number | null) {
    set({ lastTurnCostUsd: value });
  },
}));
