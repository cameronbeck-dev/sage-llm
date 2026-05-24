import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MemoryEntry, MemoryEntryVersion, SummaryEntryRow } from '@sage/shared';
import BackButton from '../components/ui/BackButton.js';
import ConfirmInline from '../components/ui/ConfirmInline.js';

type Tab = 'entries' | 'summaries' | 'history';

export default function Memory() {
  const [tab, setTab] = useState<Tab>('entries');

  return (
    <div className="settings-page">
      <header className="settings-header">
        <BackButton />
      </header>
      <h1 className="settings-title">Memory</h1>
      <div
        className="legacy-banner"
        style={{
          background: 'var(--surface-raised, #2a2a2a)',
          border: '1px solid var(--border, #444)',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 16,
          fontSize: 13,
          color: 'var(--text-muted)',
        }}
      >
        Legacy memory view — retiring at the wiki cutover. New facts are extracted to the{' '}
        <Link to="/facts">Facts</Link> page going forward.
      </div>
      <div className="memory-tabs">
        <button onClick={() => setTab('entries')} className={tab === 'entries' ? 'active' : ''}>Entries</button>
        <button onClick={() => setTab('summaries')} className={tab === 'summaries' ? 'active' : ''}>Summaries</button>
        <button onClick={() => setTab('history')} className={tab === 'history' ? 'active' : ''}>History</button>
      </div>
      {tab === 'entries' && <EntriesTab />}
      {tab === 'summaries' && <SummariesTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}

function EntriesTab() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [confirmForgetId, setConfirmForgetId] = useState<string | null>(null);
  const [whyEntryId, setWhyEntryId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/memory/entries')
      .then(r => r.ok ? r.json() : [])
      .then((data: MemoryEntry[]) => setEntries(data))
      .finally(() => setLoading(false));
  }, []);

  function startEdit(entry: MemoryEntry) {
    setEditingId(entry.id);
    setEditBody(entry.body);
  }

  async function saveEdit(entryId: string) {
    const res = await fetch(`/api/memory/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: editBody }),
    });
    if (res.ok) {
      const updated: MemoryEntry = await res.json();
      setEntries(prev => prev.map(e => e.id === entryId ? updated : e));
    }
    setEditingId(null);
  }

  async function forgetEntry(entryId: string) {
    const res = await fetch(`/api/memory/entries/${entryId}`, { method: 'DELETE' });
    if (res.ok) {
      setEntries(prev => prev.filter(e => e.id !== entryId));
    }
    setConfirmForgetId(null);
  }

  const whyEntry = whyEntryId ? entries.find(e => e.id === whyEntryId) : null;

  if (loading) return <p className="settings-info">Loading...</p>;
  if (entries.length === 0) return <p className="settings-info u-muted">No memories yet.</p>;

  return (
    <>
      {entries.map(entry => (
        <div key={entry.id} className="memory-entry">
          {editingId === entry.id ? (
            <>
              <textarea
                className="settings-textarea"
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={4}
                autoFocus
              />
              <div className="memory-entry__actions">
                <button className="btn btn--primary btn--sm" onClick={() => saveEdit(entry.id)}>Save</button>
                <button className="btn btn--sm" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div className="memory-entry__body">{entry.body}</div>
              <div className="memory-entry__footer">
                <div className="memory-entry__meta">
                  <span className="memory-entry__type">{entry.type}</span>
                  {' · '}
                  {new Date(entry.updatedAt).toLocaleString()}
                </div>
                {confirmForgetId === entry.id ? (
                  <div className="memory-entry__actions">
                    <ConfirmInline
                      prompt="Forget?"
                      onConfirm={() => forgetEntry(entry.id)}
                      onCancel={() => setConfirmForgetId(null)}
                    />
                  </div>
                ) : (
                  <div className="memory-entry__actions">
                    <button className="btn btn--sm" onClick={() => startEdit(entry)}>Edit</button>
                    <button className="btn btn--sm" onClick={() => setConfirmForgetId(entry.id)}>Forget</button>
                    <button className="btn btn--sm" onClick={() => setWhyEntryId(entry.id)}>Why?</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      {whyEntry && (
        <div className="memory-why-drawer">
          <button className="btn btn--sm memory-why-drawer__close" onClick={() => setWhyEntryId(null)}>Close</button>
          <h2 className="settings-section__title u-mb-12">Source</h2>
          {whyEntry.sourceConversationId ? (
            <>
              <p className="settings-info u-mb-8">
                Conversation: <Link to={`/chat/${whyEntry.sourceConversationId}`}>{whyEntry.sourceConversationId}</Link>
              </p>
              {whyEntry.sourceMessageId && (
                <p className="settings-info">Message ID: {whyEntry.sourceMessageId}</p>
              )}
            </>
          ) : (
            <p className="settings-info">Source not available.</p>
          )}
        </div>
      )}
    </>
  );
}

function SummariesTab() {
  const [summaries, setSummaries] = useState<SummaryEntryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/memory/summaries')
      .then(r => r.ok ? r.json() : [])
      .then((data: SummaryEntryRow[]) => setSummaries(data))
      .finally(() => setLoading(false));
  }, []);

  async function deleteSummary(summaryId: string) {
    const res = await fetch(`/api/memory/summaries/${summaryId}`, { method: 'DELETE' });
    if (res.ok) {
      setSummaries(prev => prev.filter(s => s.id !== summaryId));
    }
  }

  if (loading) return <p className="settings-info">Loading...</p>;
  if (summaries.length === 0) return <p className="settings-info u-muted">No conversation summaries yet.</p>;

  return (
    <>
      {summaries.map(summary => (
        <div key={summary.id} className="memory-summary">
          <div className="memory-summary__title">{summary.conversationTitle}</div>
          <div className="memory-summary__body">{summary.summary}</div>
          <div className="memory-summary__footer">
            <span className="settings-info">
              {summary.lastMessageAt
                ? new Date(summary.lastMessageAt).toLocaleString()
                : new Date(summary.createdAt).toLocaleString()}
            </span>
            <button className="btn btn--sm" onClick={() => deleteSummary(summary.id)}>Delete</button>
          </div>
        </div>
      ))}
    </>
  );
}

function HistoryTab() {
  const [versions, setVersions] = useState<MemoryEntryVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastId, setToastId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/memory/history')
      .then(r => r.ok ? r.json() : [])
      .then((data: MemoryEntryVersion[]) => setVersions(data))
      .finally(() => setLoading(false));
  }, []);

  async function restore(version: MemoryEntryVersion) {
    const res = await fetch(`/api/memory/entries/${version.entryId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: version.id }),
    });
    if (res.ok) {
      setToastId(version.id);
      setTimeout(() => setToastId(null), 2500);
      const fresh = await fetch('/api/memory/history');
      if (fresh.ok) setVersions(await fresh.json());
    }
  }

  if (loading) return <p className="settings-info">Loading...</p>;
  if (versions.length === 0) return <p className="settings-info u-muted">No version history yet.</p>;

  return (
    <>
      {versions.map(v => (
        <div key={v.id} className="memory-version">
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{v.entryKey ?? '(deleted entry)'}</strong>
            {v.changeSummary && <em style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12 }}>{v.changeSummary}</em>}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {new Date(v.createdAt).toLocaleString()}
            </div>
          </div>
          <span className="memory-version__triggered-by">{v.triggeredBy}</span>
          {toastId === v.id && <span className="settings-info" style={{ color: 'var(--accent)' }}>Restored.</span>}
          <button
            className="btn btn--sm"
            disabled={v.body === null}
            onClick={() => restore(v)}
          >
            Restore
          </button>
        </div>
      ))}
    </>
  );
}
