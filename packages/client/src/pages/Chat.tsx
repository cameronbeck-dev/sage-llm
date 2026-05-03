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
  } = useConversationStore();

  const { sageState, sageMessage, startStreaming, stopStreaming, onStreamError } = useSageState();

  const [inputText, setInputText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
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
    try {
      let conversationId = activeConversationId;

      if (conversationId === null) {
        try {
          const newId = await useConversationStore.getState().createConversation();
          await setActive(newId);
          conversationId = newId;
        } catch (err) {
          setStreamingError(`Error: ${(err as Error).message}`);
          return;
        }
      }

      setInputText('');

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

      try {
        for await (const chunk of streamChat(conversationId, text)) {
          if (chunk.type === 'text' && chunk.delta) {
            useConversationStore.getState().updateThinkingMessage(chunk.delta);
          } else if (chunk.type === 'thinking' && chunk.delta) {
            appendThinkingDelta(chunk.delta);
          } else if (chunk.type === 'done' || chunk.type === 'error') {
            if (thinkingTimerRef.current) {
              clearInterval(thinkingTimerRef.current);
              thinkingTimerRef.current = null;
            }
            if (chunk.type === 'error' && chunk.error) {
              onStreamError();
              setStreamingError(`Error: ${chunk.error}`);
            } else {
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
              <span className="chat-sidebar__item-title">{convo.title}</span>
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
          {activeMessages.map((msg) => {
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
              />
            );
          })}
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
