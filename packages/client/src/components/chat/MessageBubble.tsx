import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ToolCallUI } from '../../state/conversationStore.js';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'whisper';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
  thinking?: string;
  costUsd?: number;
  sessionRunningUsd?: number;
  responseTimeMs?: number;
  toolCalls?: ToolCallUI[];
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

function ToolCallRow({ tc }: { tc: ToolCallUI }) {
  const input = tc.input as Record<string, unknown> | null;
  if (tc.name === 'web_search') {
    const query = typeof input?.query === 'string' ? input.query : '';
    if (tc.status === 'running') return <div className="tool-call-row">🔍 Searching the web for &quot;{query}&quot;…</div>;
    if (tc.status === 'done') {
      const results = (tc.result as { results?: unknown[] })?.results ?? [];
      return <div className="tool-call-row tool-call-row--done">✓ Found {results.length} result{results.length !== 1 ? 's' : ''}</div>;
    }
    return <div className="tool-call-row tool-call-row--error">⚠ Search failed: {tc.error}</div>;
  }
  if (tc.name === 'web_fetch') {
    const rawUrl = typeof input?.url === 'string' ? input.url : '';
    let hostname = rawUrl;
    try { hostname = new URL(rawUrl).hostname; } catch { /* keep raw */ }
    if (tc.status === 'running') return <div className="tool-call-row">🔗 Fetching {hostname}…</div>;
    if (tc.status === 'done') {
      const title = (tc.result as { title?: string })?.title ?? hostname;
      return <div className="tool-call-row tool-call-row--done">✓ Fetched {title}</div>;
    }
    return <div className="tool-call-row tool-call-row--error">⚠ Fetch failed: {tc.error}</div>;
  }
  // Generic fallback
  if (tc.status === 'running') return <div className="tool-call-row">⏳ Running {tc.name}…</div>;
  if (tc.status === 'done') return <div className="tool-call-row tool-call-row--done">✓ {tc.name} complete</div>;
  return <div className="tool-call-row tool-call-row--error">⚠ {tc.name} failed: {tc.error}</div>;
}

interface SourceEntry {
  title: string;
  url: string;
}

function extractSources(toolCalls: ToolCallUI[]): SourceEntry[] {
  const seen = new Set<string>();
  const sources: SourceEntry[] = [];
  for (const tc of toolCalls) {
    if (tc.status !== 'done') continue;
    if (tc.name === 'web_search') {
      const results = (tc.result as { results?: Array<{ title?: string; url?: string }> })?.results ?? [];
      for (const r of results) {
        if (r.url && !seen.has(r.url)) {
          seen.add(r.url);
          sources.push({ title: r.title ?? r.url, url: r.url });
        }
      }
    } else if (tc.name === 'web_fetch') {
      const data = tc.result as { url?: string; title?: string } | null;
      const url = data?.url;
      if (url && !seen.has(url)) {
        seen.add(url);
        sources.push({ title: data?.title ?? url, url });
      }
    }
  }
  return sources;
}

export default function MessageBubble({ role, content, isStreaming, isError, thinking, costUsd, sessionRunningUsd, responseTimeMs, toolCalls }: MessageBubbleProps) {
  if (role === 'whisper') {
    return (
      <div className="message-bubble message-bubble--whisper">
        <div className="message-bubble__content message-bubble__content--whisper">
          {content}
        </div>
      </div>
    );
  }

  const sources = role === 'assistant' && toolCalls ? extractSources(toolCalls) : [];
  const toolCallCount = role === 'assistant' && toolCalls ? toolCalls.length : 0;
  const hasThinkingText = thinking !== undefined && thinking !== '';
  const showThinkingBox = hasThinkingText || toolCallCount > 0 || (isStreaming && thinking !== undefined);

  const summaryText = (() => {
    const base = isStreaming
      ? 'Thinking…'
      : responseTimeMs != null
        ? `Thought for ${(responseTimeMs / 1000).toFixed(1)}s`
        : 'Thoughts';
    if (!isStreaming && toolCallCount > 0) {
      return `${base} · used ${toolCallCount} tool call${toolCallCount !== 1 ? 's' : ''}`;
    }
    return base;
  })();

  return (
    <div className={`message-bubble message-bubble--${role}${isError ? ' message-bubble--error' : ''}${isStreaming && !isError ? ' message-bubble--thinking' : ''}`}>
      {showThinkingBox && (
        <details className="message-bubble__thinking" open={isStreaming}>
          <summary className="message-bubble__thinking-summary">{summaryText}</summary>
          <div className="message-bubble__thinking-body">
            {toolCallCount > 0 && (
              <div className="tool-call-list">
                {toolCalls!.map((tc) => <ToolCallRow key={tc.id} tc={tc} />)}
              </div>
            )}
            {hasThinkingText && <div className="message-bubble__thinking-text">{thinking}</div>}
          </div>
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
      {sources.length > 0 && (
        <details className="message-bubble__sources">
          <summary className="message-bubble__sources-summary">Sources</summary>
          <ul className="message-bubble__sources-list">
            {sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
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
