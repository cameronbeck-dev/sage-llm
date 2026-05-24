import { create } from 'zustand';
import type { Conversation, Message } from '@sage/shared';
import type { SageState } from '../hooks/useSageState';

export interface ToolCallUI {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
}

// Rebuild tool-call indicators from persisted `tool_use`/`tool_result` blocks.
// Accumulated calls are attached to the turn's final assistant message (the
// one with no tool_use blocks), so the indicators render at the top of the
// answer bubble — matching the during-streaming UI.
export function reconstructToolCalls(messages: Message[]): Record<string, ToolCallUI[]> {
  const result: Record<string, ToolCallUI[]> = {};
  const resultByToolUseId = new Map<string, { content: string; isError: boolean }>();

  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        resultByToolUseId.set(b.tool_use_id, { content: b.content, isError: b.is_error ?? false });
      }
    }
  }

  let accumulated: ToolCallUI[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const toolUseBlocks = m.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use'
    );
    if (toolUseBlocks.length > 0) {
      for (const tu of toolUseBlocks) {
        const r = resultByToolUseId.get(tu.id);
        if (!r) {
          accumulated.push({ id: tu.id, name: tu.name, input: tu.input, status: 'running' });
        } else if (r.isError) {
          accumulated.push({
            id: tu.id, name: tu.name, input: tu.input,
            status: 'error', error: r.content.replace(/^Error:\s*/, ''),
          });
        } else {
          let parsed: unknown = r.content;
          try { parsed = JSON.parse(r.content); } catch { /* keep raw */ }
          accumulated.push({ id: tu.id, name: tu.name, input: tu.input, status: 'done', result: parsed });
        }
      }
    } else if (accumulated.length > 0) {
      result[m.id] = accumulated;
      accumulated = [];
    }
  }

  return result;
}

interface ConversationState {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  activeMessages: Message[];
  streamingText: string;
  isStreaming: boolean;
  thinkingMessageId: string | null;
  previousConversationId: string | null;
  sageState: SageState;
  sageMessage: string;
  lastTurnCostUsd: number | null;
  showArchived: boolean;
  isLoadingConversations: boolean;
  pendingExtractions: Record<string, Array<{ id: string; label: string }>>;
  toolCalls: Record<string, ToolCallUI[]>;
  setShowArchived: (value: boolean) => void;
  loadConversations: () => Promise<void>;
  createConversation: (title?: string, seedFromPackId?: string) => Promise<string>;
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
  setPreferredModel: (provider: string, model: string) => Promise<void>;
  updateMessage: (message: Message) => void;
  setExtractionStarted: (conversationId: string, label: string) => void;
  appendExtractionDestinations: (conversationId: string, indicators: Array<{ id: string; label: string }>) => void;
  clearExtractionDestination: (conversationId: string, id: string) => void;
  clearAllExtractions: (conversationId: string) => void;
  startToolCall: (messageId: string, call: { id: string; name: string; input: unknown }) => void;
  completeToolCall: (messageId: string, id: string, result: unknown) => void;
  failToolCall: (messageId: string, id: string, error: string) => void;
}

let loadConversationsRequestId = 0;

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  activeMessages: [],
  streamingText: '',
  isStreaming: false,
  thinkingMessageId: null,
  previousConversationId: null,
  sageState: 'idle',
  sageMessage: 'Ready when you are.',
  lastTurnCostUsd: null,
  showArchived: false,
  isLoadingConversations: false,
  pendingExtractions: {},
  toolCalls: {},

  setShowArchived(value: boolean) {
    set({ showArchived: value });
  },

  async loadConversations() {
    const requestId = ++loadConversationsRequestId;
    set({ isLoadingConversations: true });
    try {
      const { showArchived } = get();
      const url = showArchived ? '/api/conversations?includeArchived=true' : '/api/conversations';
      const res = await fetch(url);
      if (requestId !== loadConversationsRequestId) return;
      if (!res.ok) return;
      const data = (await res.json()) as Conversation[];
      if (requestId !== loadConversationsRequestId) return;
      set({ conversations: data });
    } finally {
      if (requestId === loadConversationsRequestId) {
        set({ isLoadingConversations: false });
      }
    }
  },

  async createConversation(title, seedFromPackId) {
    const state = get();
    const prevId = state.activeConversationId ?? state.previousConversationId;
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        previousId: prevId,
        seedFromPackId: seedFromPackId ?? undefined,
      }),
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
        activeConversation: null,
        previousConversationId: s.activeConversationId ?? s.previousConversationId,
        activeMessages: [],
        streamingText: '',
        isStreaming: false,
        thinkingMessageId: null,
      }));
      return;
    }
    set({ activeConversationId: id, activeConversation: null, activeMessages: [], streamingText: '', isStreaming: false, thinkingMessageId: null });
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as Conversation & { messages: Message[] };
    const { messages: _, ...convoFields } = data;
    set({
      activeConversation: convoFields,
      activeMessages: data.messages,
      toolCalls: reconstructToolCalls(data.messages),
    });
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

  updateMessage(message: Message) {
    set((s) => ({
      activeMessages: s.activeMessages.map((m) => m.id === message.id ? message : m),
    }));
  },

  async setPreferredModel(provider: string, model: string) {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    set((s) => ({
      activeConversation: s.activeConversation
        ? { ...s.activeConversation, preferredProvider: provider, preferredModel: model }
        : s.activeConversation,
      conversations: s.conversations.map((c) =>
        c.id === activeConversationId
          ? { ...c, preferredProvider: provider, preferredModel: model }
          : c
      ),
    }));

    await fetch(`/api/conversations/${activeConversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredProvider: provider, preferredModel: model }),
    });
  },

  setExtractionStarted(conversationId, label) {
    set((s) => ({
      pendingExtractions: { ...s.pendingExtractions, [conversationId]: [{ id: '__started__', label }] },
    }));
  },

  // First call filters out the `__started__` sentinel; subsequent calls append. Never replaces existing entries.
  appendExtractionDestinations(conversationId, indicators) {
    set((s) => {
      const existing = (s.pendingExtractions[conversationId] ?? []).filter(e => e.id !== '__started__');
      return {
        pendingExtractions: { ...s.pendingExtractions, [conversationId]: [...existing, ...indicators] },
      };
    });
  },

  clearExtractionDestination(conversationId, id) {
    set((s) => {
      const existing = s.pendingExtractions[conversationId];
      if (!existing) return {};
      return {
        pendingExtractions: { ...s.pendingExtractions, [conversationId]: existing.filter(e => e.id !== id) },
      };
    });
  },

  clearAllExtractions(conversationId) {
    set((s) => ({
      pendingExtractions: { ...s.pendingExtractions, [conversationId]: [] },
    }));
  },

  startToolCall(messageId, call) {
    set((s) => {
      const existing = s.toolCalls[messageId] ?? [];
      return {
        toolCalls: {
          ...s.toolCalls,
          [messageId]: [...existing, { ...call, status: 'running' }],
        },
      };
    });
  },

  completeToolCall(messageId, id, result) {
    set((s) => {
      const existing = s.toolCalls[messageId] ?? [];
      return {
        toolCalls: {
          ...s.toolCalls,
          [messageId]: existing.map((tc) =>
            tc.id === id ? { ...tc, status: 'done', result } : tc
          ),
        },
      };
    });
  },

  failToolCall(messageId, id, error) {
    set((s) => {
      const existing = s.toolCalls[messageId] ?? [];
      return {
        toolCalls: {
          ...s.toolCalls,
          [messageId]: existing.map((tc) =>
            tc.id === id ? { ...tc, status: 'error', error } : tc
          ),
        },
      };
    });
  },
}));
