import { useEffect, useRef, useState } from 'react';
import { useConversationStore } from '../state/conversationStore.js';
import { useAuthStore } from '../state/authStore.js';
import { useSettingsStore } from '../state/settingsStore.js';
import { useSageState } from '../hooks/useSageState.js';
import { streamChat } from '../api/chat.js';
import MessageBubble from '../components/chat/MessageBubble.js';
import ModelPicker from '../components/chat/ModelPicker.js';
import UserMenu from '../components/chat/UserMenu.js';
import SageAvatar from '../components/sage/SageAvatar.js';
import ConfirmModal from '../components/ui/ConfirmModal.js';
import type { Conversation, Message } from '@sage/shared';

function resizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

export default function Chat() {
  const { user, logout } = useAuthStore();
  const {
    conversations,
    activeConversationId,
    activeMessages,
    streamingText,
    isStreaming,
    thinkingMessageId,
    loadConversations,
    createConversation,
    setActive,
    setThinkingMessage,
    setStreamingError,
    finalizeStreaming,
    addMessage,
    deleteConversation,
    appendThinkingDelta,
    setLastTurnCost,
    updateConversationTitle,
  } = useConversationStore();

  const { sageState, sageMessage, startStreaming, stopStreaming, onStreamError } = useSageState();

  const [inputText, setInputText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem('sage.composer-hint-dismissed') === 'true');
  const transcriptRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamStartRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (isNearBottom && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [activeMessages, streamingText, isNearBottom]);

  useEffect(() => {
    setIsNearBottom(true);
  }, [activeConversationId]);

  useEffect(() => {
    if (textareaRef.current) resizeTextarea(textareaRef.current);
  }, [inputText]);

  function handleTranscriptScroll() {
    const el = transcriptRef.current;
    if (!el) return;
    setIsNearBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 64);
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  async function handleNewConversation() {
    setActive(null);
  }

  async function handleSend() {
    const text = inputText.trim();
    if (!text || isSendingRef.current || isStreaming) return;

    // Handle /setup command — restart onboarding
    if (text === '/setup') {
      setInputText('');
      try {
        const newId = await useConversationStore.getState().createConversation('Welcome');
        await useConversationStore.getState().setActive(newId);
        // Fetch welcome template and persist as assistant message in DB
        const templateRes = await fetch('/api/docs/system/welcome-template');
        if (templateRes.ok) {
          const { content } = await templateRes.json() as { content: string };
          // Persist welcome message to DB
          const msgRes = await fetch(`/api/conversations/${newId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: content }] }),
          });
          if (msgRes.ok) {
            const savedMsg = await msgRes.json();
            useConversationStore.getState().addMessage(savedMsg);
          }
        }
      } catch (err) {
        setStreamingError(`Error: ${(err as Error).message}`);
      }
      return;
    }

    isSendingRef.current = true;
    setInputText('');
    try {
      let conversationId = activeConversationId;
      let tempConversationId: string | null = null;

      if (conversationId === null) {
        tempConversationId = `temp-${crypto.randomUUID()}`;
        conversationId = tempConversationId;
        const placeholder: Conversation = {
          id: tempConversationId,
          userId: user?.id ?? '',
          title: text.slice(0, 50),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        useConversationStore.setState((s) => ({
          conversations: [placeholder, ...s.conversations],
          activeConversationId: tempConversationId,
          activeMessages: [],
          streamingText: '',
          isStreaming: false,
          thinkingMessageId: null,
        }));
      }

      const userMessage: Message = {
        id: crypto.randomUUID(),
        conversationId,
        role: 'user',
        content: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
      };
      addMessage(userMessage);

      const thinkingId = crypto.randomUUID();
      const thinkingMessage: Message = {
        id: thinkingId,
        conversationId,
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        createdAt: new Date().toISOString(),
      };
      addMessage(thinkingMessage);
      setThinkingMessage(thinkingId);
      startStreaming();
      abortControllerRef.current = new AbortController();
      streamStartRef.current = Date.now();

      if (tempConversationId !== null) {
        try {
          const realId = await useConversationStore.getState().createConversation();
          const tempId = tempConversationId;
          useConversationStore.setState((s) => ({
            conversations: s.conversations.filter((c) => c.id !== tempId),
            activeConversationId: s.activeConversationId === tempId ? realId : s.activeConversationId,
            activeMessages: s.activeMessages.map((m) =>
              m.conversationId === tempId ? { ...m, conversationId: realId } : m
            ),
          }));
          conversationId = realId;
        } catch (err) {
          useConversationStore.setState((s) => ({
            conversations: s.conversations.filter((c) => c.id !== tempConversationId),
            activeConversationId: s.activeConversationId === tempConversationId ? null : s.activeConversationId,
            activeMessages: [],
            isStreaming: false,
            thinkingMessageId: null,
          }));
          onStreamError();
          setStreamingError(`Error: ${(err as Error).message}`);
          return;
        }
      }

      try {
        let indicatorFlipped = false;
        const convoState = useConversationStore.getState();
        const settingsState = useSettingsStore.getState();
        const effectiveProvider = convoState.activeConversation?.preferredProvider ?? settingsState.provider;
        const effectiveModel = convoState.activeConversation?.preferredModel ?? settingsState.model;
        const modelOverride =
          effectiveProvider && effectiveModel
            ? { provider: effectiveProvider, model: effectiveModel }
            : undefined;
        for await (const chunk of streamChat(conversationId, text, convoState.previousConversationId ?? undefined, abortControllerRef.current.signal, modelOverride)) {
          if (chunk.type === 'text' && chunk.delta) {
            useConversationStore.getState().updateThinkingMessage(chunk.delta);
          } else if (chunk.type === 'thinking' && chunk.delta) {
            appendThinkingDelta(chunk.delta);
          } else if (chunk.type === 'response_complete') {
            setLastTurnCost(chunk.costUsd ?? null);
            stopStreaming();
            finalizeStreaming();
            indicatorFlipped = true;
            const responseTimeMs = Date.now() - streamStartRef.current;
            useConversationStore.setState((s) => ({
              activeMessages: s.activeMessages.map((m, i, arr) =>
                i === arr.length - 1 && m.role === 'assistant' ? { ...m, responseTimeMs } : m
              ),
            }));
          } else if (chunk.type === 'whisper') {
            // Memory review completed and whisper was created — refetch to show it
            if (conversationId) {
              const msgRes = await fetch(`/api/conversations/${conversationId}`);
              if (msgRes.ok) {
                const data = await msgRes.json() as Conversation & { messages: Message[] };
                useConversationStore.setState((s) => {
                  const responseTimeById = new Map(s.activeMessages.filter(m => m.responseTimeMs != null).map(m => [m.id, m.responseTimeMs!]));
                  return {
                    activeMessages: data.messages.map(m => {
                      const preservedTime = responseTimeById.get(m.id);
                      return preservedTime != null ? { ...m, responseTimeMs: preservedTime } : m;
                    }),
                  };
                });
              }
            }
          } else if (chunk.type === 'title') {
            // First message of new conversation — update conversation title in sidebar
            if (conversationId && chunk.title) {
              useConversationStore.getState().updateConversationTitle(conversationId, chunk.title);
            }
          } else if (chunk.type === 'done' || chunk.type === 'error') {
            if (chunk.type === 'error' && chunk.error) {
              onStreamError();
              setStreamingError(`Error: ${chunk.error}`);
            } else {
              if (!indicatorFlipped) {
                setLastTurnCost(chunk.costUsd ?? null);
                stopStreaming();
                finalizeStreaming();
              }
              // Refetch messages to pick up any whispers/title created during post-processing
              if (conversationId) {
                const msgRes = await fetch(`/api/conversations/${conversationId}`);
                if (msgRes.ok) {
                  const data = await msgRes.json() as Conversation & { messages: Message[] };
                  useConversationStore.setState((s) => {
                    const responseTimeById = new Map(s.activeMessages.filter(m => m.responseTimeMs != null).map(m => [m.id, m.responseTimeMs!]));
                    return {
                      activeMessages: data.messages.map(m => {
                        const preservedTime = responseTimeById.get(m.id);
                        return preservedTime != null ? { ...m, responseTimeMs: preservedTime } : m;
                      }),
                    };
                  });
                  if (!indicatorFlipped) {
                    const responseTimeMs = Date.now() - streamStartRef.current;
                    useConversationStore.setState((s) => ({
                      activeMessages: s.activeMessages.map((m, i, arr) =>
                        i === arr.length - 1 && m.role === 'assistant' ? { ...m, responseTimeMs } : m
                      ),
                    }));
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          stopStreaming();
          finalizeStreaming();
        } else {
          onStreamError();
          setStreamingError(`Error: ${(err as Error).message}`);
        }
      }
    } finally {
      isSendingRef.current = false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Enter' && e.shiftKey && !hintDismissed) {
      setHintDismissed(true);
      localStorage.setItem('sage.composer-hint-dismissed', 'true');
    }
  }

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar pixel-border">
        <div className="chat-sidebar__sage-strip">
          <SageAvatar state={sageState} />
          <div className="chat-sidebar__sage-message">{sageMessage}</div>
        </div>
        <div className="chat-sidebar__header">
          <span className="chat-sidebar__title">Sage</span>
          <button
            className="btn btn--sm btn--primary"
            onClick={handleNewConversation}
          >
            + New
          </button>
        </div>
        <ul className="chat-sidebar__list">
          {conversations.map((convo) => (
            <li
              key={convo.id}
              className={`chat-sidebar__item${activeConversationId === convo.id ? ' chat-sidebar__item--active' : ''}${editingId === convo.id ? ' chat-sidebar__item--editing' : ''}`}
              onClick={() => setActive(convo.id)}
            >
              {editingId === convo.id ? (
                <input
                  className="chat-sidebar__item-title-input"
                  value={editingValue}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={() => { updateConversationTitle(convo.id, editingValue); setEditingId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { updateConversationTitle(convo.id, editingValue); setEditingId(null); }
                    else if (e.key === 'Escape') { setEditingId(null); }
                  }}
                />
              ) : (
                <span className="chat-sidebar__item-title">{convo.title}</span>
              )}
              <button
                className="chat-sidebar__item-edit"
                aria-label={`Rename ${convo.title}`}
                title={`Rename ${convo.title}`}
                onClick={(e) => { e.stopPropagation(); setEditingId(convo.id); setEditingValue(convo.title); }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z"/>
                </svg>
              </button>
              <button
                className="chat-sidebar__item-delete"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(convo); }}
                aria-label={`Delete ${convo.title}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <polyline points="2,4 12,4"/>
                  <path d="M5 4V2.5h4V4M5.5 6v5M8.5 6v5"/>
                  <path d="M3 4l.8 7.5h6.4L11 4"/>
                </svg>
              </button>
            </li>
          ))}
        </ul>
        <div className="chat-sidebar__footer">
          {user && <UserMenu user={user} onLogout={logout} />}
        </div>
      </aside>

      <main className="chat-main">
        <div className="chat-transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
          {activeMessages.length === 0 && !isStreaming ? (
            <div className="chat-empty-state">
              <SageAvatar state={sageState} />
              <p className="chat-empty-state__greeting">What can I help you with?</p>
              <div className="chat-empty-state__chips">
                {['Explain a tricky concept simply', 'Help me draft an email', 'Brainstorm with me'].map((p) => (
                  <button key={p} type="button" className="chat-empty-state__chip" onClick={() => setInputText(p)}>{p}</button>
                ))}
              </div>
            </div>
          ) : (
            (() => {
              let running = 0;
              const enriched = activeMessages.map((m) => {
                if (m.role === 'assistant' && typeof m.costUsd === 'number') running += m.costUsd;
                return { msg: m, sessionRunningUsd: running };
              });
              return enriched.map(({ msg, sessionRunningUsd }) => {
                const text = msg.content
                  .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                  .map((b) => b.text)
                  .join('');
                return (
                  <MessageBubble
                    key={msg.id}
                    role={msg.role as 'user' | 'assistant' | 'whisper'}
                    content={text}
                    isStreaming={msg.id === thinkingMessageId && isStreaming}
                    isError={msg.id === thinkingMessageId && !isStreaming && text.startsWith('Error:')}
                    thinking={msg.thinking}
                    costUsd={msg.role === 'assistant' ? msg.costUsd : undefined}
                    sessionRunningUsd={msg.role === 'assistant' && msg.costUsd != null ? sessionRunningUsd : undefined}
                    responseTimeMs={msg.role === 'assistant' ? msg.responseTimeMs : undefined}
                  />
                );
              });
            })()
          )}
        </div>
        {!isNearBottom && (
          <button className="scroll-to-bottom" type="button" aria-label="Scroll to bottom" onClick={() => {
            transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
            setIsNearBottom(true);
          }}>↓</button>
        )}
        <div className="chat-input-bar pixel-border">
          <div className="chat-input-row">
            {activeConversationId && (
              <ModelPicker conversationId={activeConversationId} />
            )}
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={inputText}
              onChange={(e) => { setInputText(e.target.value); resizeTextarea(e.target); }}
              onKeyDown={handleKeyDown}
              placeholder="Ask Sage something..."
              rows={1}
              disabled={isStreaming}
            />
            {isStreaming ? (
              <button className="btn btn--primary btn--stop" onClick={handleStop} aria-label="Stop generating" type="button">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10" /></svg>
              </button>
            ) : (
              <button
                className="btn btn--primary"
                onClick={handleSend}
                disabled={!inputText.trim()}
              >
                Send
              </button>
            )}
          </div>
          {!hintDismissed && (
            <div className="composer-hint">Shift+Enter for new line</div>
          )}
        </div>
      </main>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        title="Delete conversation"
        message={`Delete "${deleteTarget?.title ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteConversation(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
