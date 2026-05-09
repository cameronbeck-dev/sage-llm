import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConversationStore } from '../state/conversationStore.js';
import { useAuthStore } from '../state/authStore.js';
import { useSageState } from '../hooks/useSageState.js';
import { streamChat } from '../api/chat.js';
import MessageBubble from '../components/chat/MessageBubble.js';
import SageAvatar from '../components/sage/SageAvatar.js';
import ConfirmModal from '../components/ui/ConfirmModal.js';
import type { Conversation, Message } from '@sage/shared';

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
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef<boolean>(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [activeMessages, streamingText]);

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
      setThinkingSeconds(0);
      thinkingTimerRef.current = setInterval(() => {
        setThinkingSeconds((s) => s + 1);
      }, 1000);

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
          const tempId = tempConversationId;
          if (thinkingTimerRef.current) {
            clearInterval(thinkingTimerRef.current);
            thinkingTimerRef.current = null;
          }
          useConversationStore.setState((s) => ({
            conversations: s.conversations.filter((c) => c.id !== tempId),
            activeConversationId: s.activeConversationId === tempId ? null : s.activeConversationId,
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
        for await (const chunk of streamChat(conversationId, text, useConversationStore.getState().previousConversationId ?? undefined)) {
          if (chunk.type === 'text' && chunk.delta) {
            useConversationStore.getState().updateThinkingMessage(chunk.delta);
          } else if (chunk.type === 'thinking' && chunk.delta) {
            appendThinkingDelta(chunk.delta);
          } else if (chunk.type === 'whisper') {
            // Memory review completed and whisper was created — refetch to show it
            if (conversationId) {
              const msgRes = await fetch(`/api/conversations/${conversationId}`);
              if (msgRes.ok) {
                const data = await msgRes.json() as Conversation & { messages: Message[] };
                useConversationStore.setState({ activeMessages: data.messages });
              }
            }
          } else if (chunk.type === 'title') {
            // First message of new conversation — update conversation title in sidebar
            if (conversationId && chunk.title) {
              useConversationStore.getState().updateConversationTitle(conversationId, chunk.title);
            }
          } else if (chunk.type === 'done' || chunk.type === 'error') {
            if (thinkingTimerRef.current) {
              clearInterval(thinkingTimerRef.current);
              thinkingTimerRef.current = null;
            }
            if (chunk.type === 'error' && chunk.error) {
              onStreamError();
              setStreamingError(`Error: ${chunk.error}`);
            } else {
              setLastTurnCost(chunk.costUsd ?? null);
              stopStreaming();
              finalizeStreaming();
              // Refetch messages to pick up any whispers created by memory review
              if (conversationId) {
                const msgRes = await fetch(`/api/conversations/${conversationId}`);
                if (msgRes.ok) {
                  const data = await msgRes.json() as Conversation & { messages: Message[] };
                  useConversationStore.setState({ activeMessages: data.messages });
                }
              }
            }
          }
        }
      } catch (err) {
        onStreamError();
        setStreamingError(`Error: ${(err as Error).message}`);
      }
    } finally {
      isSendingRef.current = false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
              className={`chat-sidebar__item${activeConversationId === convo.id ? ' chat-sidebar__item--active' : ''}`}
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
                title={`Rename ${convo.title}`}
                onClick={(e) => { e.stopPropagation(); setEditingId(convo.id); setEditingValue(convo.title); }}
              >✎</button>
              <button
                className="chat-sidebar__item-delete"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(convo); }}
                aria-label={`Delete ${convo.title}`}
              >✕</button>
            </li>
          ))}
        </ul>
        <div className="chat-sidebar__footer">
          {user && (
            <div className="chat-sidebar__user">
              {user.avatarUrl && (
                <img
                  src={user.avatarUrl}
                  alt={user.login}
                  className="chat-sidebar__avatar pixel-sprite"
                  width={24}
                  height={24}
                />
              )}
              <span>{user.login}</span>
              <Link to="/usage" className="btn btn--sm">Usage</Link>
              <Link to="/settings" className="btn btn--sm">Settings</Link>
              <button className="btn btn--sm" onClick={() => logout()}>
                Logout
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="chat-main">
        <div className="chat-transcript" ref={transcriptRef}>
          {(() => {
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
                />
              );
            });
          })()}
        </div>
        <div className="chat-input-bar pixel-border">
          <textarea
            className="chat-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Sage something..."
            rows={1}
            disabled={isStreaming}
          />
          <button
            className="btn btn--primary"
            onClick={handleSend}
            disabled={isStreaming || !inputText.trim()}
          >
            {isStreaming ? `Thought for ${thinkingSeconds}s` : 'Send'}
          </button>
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
