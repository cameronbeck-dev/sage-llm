import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'whisper';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
  thinking?: string;
  costUsd?: number;
  sessionRunningUsd?: number;
  responseTimeMs?: number;
}

function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  const codeEl = (Array.isArray(children) ? children.find((c: any) => c?.type === 'code') : children) as React.ReactElement | undefined;
  const lang = (codeEl?.props as any)?.className?.replace('language-', '') ?? '';
  const handleCopy = () => {
    const raw = (codeEl?.props as any)?.children ?? '';
    const text = Array.isArray(raw) ? raw.join('') : String(raw);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        {lang ? <span className="code-block-lang">{lang}</span> : <span />}
        <button className="code-block-copy" onClick={handleCopy} type="button">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

export default function MessageBubble({ role, content, isStreaming, isError, thinking, costUsd, sessionRunningUsd, responseTimeMs }: MessageBubbleProps) {
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
          <summary className="message-bubble__thinking-summary">
            {isStreaming
              ? 'Thinking…'
              : responseTimeMs != null
                ? `Thought for ${(responseTimeMs / 1000).toFixed(1)}s`
                : 'Thoughts'}
          </summary>
          <div className="message-bubble__thinking-body">{thinking}</div>
        </details>
      )}
      <div
        className="message-bubble__content"
        {...(isStreaming ? { 'aria-live': 'polite' as const, 'aria-atomic': 'false' } : {})}
      >
        {isError && (
          <svg className="message-bubble__error-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M6 3.5v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
        {isStreaming && !isError && (!content || content.length === 0) && (
          <span className="message-bubble__thinking-dots" aria-hidden="true">
            <span className="message-bubble__thinking-dot" />
            <span className="message-bubble__thinking-dot" />
            <span className="message-bubble__thinking-dot" />
          </span>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock as any }}>{content}</ReactMarkdown>
        {isStreaming && !isError && <span className="message-bubble__cursor" aria-hidden="true" />}
      </div>
      {role === 'assistant' && (costUsd != null || responseTimeMs != null) && (
        <div className="message-bubble__cost">
          {responseTimeMs != null && <span>Responded in {(responseTimeMs / 1000).toFixed(1)}s</span>}
          {costUsd != null && responseTimeMs != null && ' · '}
          {costUsd != null && (
            <span>
              ${costUsd.toFixed(4)}
              {sessionRunningUsd != null && ` · session $${sessionRunningUsd.toFixed(4)}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
