import { useEffect, useMemo, useRef, useState } from 'react';
import { useConversationStore } from '../state/conversationStore.js';
import { useAuthStore } from '../state/authStore.js';
import { useSettingsStore } from '../state/settingsStore.js';
import { useKnowledgeStore } from '../state/knowledgeStore.js';
import { useSageState } from '../hooks/useSageState.js';
import { streamChat } from '../api/chat.js';
import MessageBubble from '../components/chat/MessageBubble.js';
import ModelPicker from '../components/chat/ModelPicker.js';
import UserMenu from '../components/chat/UserMenu.js';
import SageAvatar from '../components/sage/SageAvatar.js';
import ConfirmModal from '../components/ui/ConfirmModal.js';
import type { Conversation, Message } from '@sage/shared';

type Bucket = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Previous 30 days' | 'Older';
const BUCKET_ORDER: Bucket[] = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];

function bucketFor(date: Date, now: Date): Bucket {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const target = startOfDay(date);
  const dayDiff = Math.round((today - target) / 86400000);
  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff <= 7) return 'Previous 7 days';
  if (dayDiff <= 30) return 'Previous 30 days';
  return 'Older';
}

function resizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

export default function Chat() {
  const { user, logout } = useAuthStore();
  const {
    conversations,
    activeConversationId,
    activeConversation,
    activeMessages,
    streamingText,
    isStreaming,
    thinkingMessageId,
    showArchived,
    isLoadingConversations,
    setShowArchived,
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
  const { packs, filesByPack, loadPacks, attachPack, detachPack } = useKnowledgeStore();

  const [inputText, setInputText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [packPickerOpen, setPackPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem('sage.composer-hint-dismissed') === 'true');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamStartRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sidebarButtonRef = useRef<HTMLButtonElement>(null);

  const groupedConversations = useMemo(() => {
    const now = new Date();
    const buckets = new Map<Bucket, typeof conversations>(
      BUCKET_ORDER.map((b) => [b, []])
    );
    for (const convo of conversations) {
      const bucket = bucketFor(new Date(convo.updatedAt), now);
      buckets.get(bucket)!.push(convo);
    }
    return buckets;
  }, [conversations]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations, showArchived]);

  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

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

  useEffect(() => {
    if (!menuOpenId) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target || !target.closest('.chat-sidebar__item-menu, .chat-sidebar__item-menu-trigger')) {
        setMenuOpenId(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpenId(null);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpenId]);

  useEffect(() => {
    if (sidebarOpen) {
      const frameId = requestAnimationFrame(() => {
        const sidebar = document.getElementById('chat-sidebar');
        if (!sidebar) return;
        const focusable = sidebar.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) return;
        first.focus();
        function handleKeyDown(e: KeyboardEvent) {
          if (e.key === 'Escape') {
            setSidebarOpen(false);
          } else if (e.key === 'Tab') {
            if (focusable.length === 0) return;
            if (e.shiftKey) {
              if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
              }
            } else {
              if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }
        }
        document.addEventListener('keydown', handleKeyDown);
        (sidebar as HTMLElement & { _cleanupKeydown?: () => void })._cleanupKeydown = () =>
          document.removeEventListener('keydown', handleKeyDown);
      });
      return () => cancelAnimationFrame(frameId);
    } else {
      const sidebar = document.getElementById('chat-sidebar') as (HTMLElement & { _cleanupKeydown?: () => void }) | null;
      sidebar?._cleanupKeydown?.();
      sidebarButtonRef.current?.focus();
    }
  }, [sidebarOpen]);

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
    setSidebarOpen(false);
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
      <div className={`mobile-overlay ${sidebarOpen ? 'mobile-overlay--visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside id="chat-sidebar" role="dialog" aria-modal="true" aria-label="Navigation" className={`chat-sidebar pixel-border${sidebarOpen ? ' chat-sidebar--open' : ''}`}>
        <div className="chat-sidebar__sage-strip">
          <SageAvatar state={sageState} />
          <div className="chat-sidebar__sage-message">{sageMessage}</div>
        </div>
        <div className="chat-sidebar__header">
          <button className="hamburger-btn hamburger-btn--close" type="button" aria-label="Close menu" onClick={() => setSidebarOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="2" y1="2" x2="12" y2="12"/>
              <line x1="12" y1="2" x2="2" y2="12"/>
            </svg>
          </button>
          <span className="chat-sidebar__title">Sage</span>
          <button
            className="btn btn--sm btn--primary"
            onClick={handleNewConversation}
          >
            + New
          </button>
        </div>
        <label className={`chat-sidebar__archive-toggle${isLoadingConversations ? ' chat-sidebar__archive-toggle--loading' : ''}`}>
          <input
            type="checkbox"
            className="chat-sidebar__archive-checkbox"
            checked={showArchived}
            disabled={isLoadingConversations}
            onChange={(e) => { setShowArchived(e.target.checked); }}
          />
          Show archived
        </label>
        <ul className="chat-sidebar__list">
          {BUCKET_ORDER.flatMap((bucket) => {
            const items = groupedConversations.get(bucket) ?? [];
            if (items.length === 0) return [];
            return [
              <li className="chat-sidebar__group-header" key={`hdr-${bucket}`}>{bucket}</li>,
              ...items.map((convo) => (
                <li
                  key={convo.id}
                  className={`chat-sidebar__item${activeConversationId === convo.id ? ' chat-sidebar__item--active' : ''}${editingId === convo.id ? ' chat-sidebar__item--editing' : ''}${menuOpenId === convo.id ? ' chat-sidebar__item--menu-open' : ''}`}
                  onClick={() => { setActive(convo.id); setSidebarOpen(false); }}
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
                  {convo.importId && <span className="chat-sidebar__item-imported-pill">imported</span>}
                  <button
                    className="chat-sidebar__item-menu-trigger"
                    aria-label={`Actions for ${convo.title}`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpenId === convo.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === convo.id ? null : convo.id);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                      <circle cx="3" cy="7" r="1.25"/>
                      <circle cx="7" cy="7" r="1.25"/>
                      <circle cx="11" cy="7" r="1.25"/>
                    </svg>
                  </button>
                  {menuOpenId === convo.id && (
                    <div className="chat-sidebar__item-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-sidebar__item-menu-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(convo.id);
                          setEditingValue(convo.title);
                          setMenuOpenId(null);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-sidebar__item-menu-action chat-sidebar__item-menu-action--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(convo);
                          setMenuOpenId(null);
                        }}
                      >
                        Delete
                      </button>
                      <div className="chat-sidebar__item-menu-meta" role="presentation">
                        Last updated: {new Date(convo.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  )}
                </li>
              )),
            ];
          })}
        </ul>
        <div className="chat-sidebar__footer">
          {user && <UserMenu user={user} onLogout={logout} />}
        </div>
      </aside>

      <main className="chat-main">
        <div className="chat-main__header">
          <button ref={sidebarButtonRef} className="hamburger-btn" type="button" aria-label="Open menu" aria-expanded={sidebarOpen} aria-controls="chat-sidebar" onClick={() => setSidebarOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="3" y1="4" x2="15" y2="4"/>
              <line x1="3" y1="9" x2="15" y2="9"/>
              <line x1="3" y1="14" x2="15" y2="14"/>
            </svg>
          </button>
          {activeConversation?.knowledgePackId && (
            <span className="chat-sidebar__item-imported-pill" style={{ marginLeft: 8 }}>Pack Builder</span>
          )}
          {activeConversationId && !activeConversation?.knowledgePackId && (
            <div style={{ position: 'relative', marginLeft: 'auto' }}>
              <button className="btn btn--sm" onClick={() => setPackPickerOpen(o => !o)}>
                Packs{activeConversation?.attachedPackIds?.length ? ` (${activeConversation.attachedPackIds.length})` : ''}
              </button>
              {packPickerOpen && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 8,
                  zIndex: 100,
                  minWidth: 200,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                }}>
                  {packs.length === 0 ? (
                    <p style={{ fontSize: 12, opacity: 0.6, padding: 4 }}>No packs yet.</p>
                  ) : packs.map(pack => {
                    const attached = activeConversation?.attachedPackIds?.includes(pack.id) ?? false;
                    return (
                      <label key={pack.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={attached}
                          onChange={async () => {
                            if (attached) {
                              await detachPack(activeConversationId, pack.id);
                            } else {
                              await attachPack(activeConversationId, pack.id);
                            }
                            await useConversationStore.getState().setActive(activeConversationId);
                          }}
                        />
                        {pack.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
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
              const enriched = activeMessages
                .filter((m) => m.role !== 'system_internal')
                .map((m) => {
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
            <div className="chat-input-actions">
              <ModelPicker conversationId={activeConversationId ?? ''} />
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
