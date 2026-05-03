import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'whisper';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
  thinking?: string;
}

export default function MessageBubble({ role, content, isStreaming, isError, thinking }: MessageBubbleProps) {
  if (role === 'whisper') {
    return (
      <div className="message-bubble message-bubble--whisper">
        <div className="message-bubble__content message-bubble__content--whisper">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className={`message-bubble message-bubble--${role}${isError ? ' message-bubble--error' : ''}${isStreaming && !isError ? ' message-bubble--thinking' : ''}`}>
      {thinking !== undefined && (thinking !== '' || isStreaming) && (
        <details className="message-bubble__thinking">
          <summary className="message-bubble__thinking-summary">Thinking…</summary>
          <div className="message-bubble__thinking-body">{thinking}</div>
        </details>
      )}
      <div className="message-bubble__content">
        {isError && (
          <svg className="message-bubble__error-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M6 3.5v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
        {isStreaming && !isError && (
          <span className="message-bubble__thinking-dots" aria-hidden="true">
            <span className="message-bubble__thinking-dot" />
            <span className="message-bubble__thinking-dot" />
            <span className="message-bubble__thinking-dot" />
          </span>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        {isStreaming && !isError && <span className="message-bubble__cursor" aria-hidden="true" />}
      </div>
    </div>
  );
}
