import { useEffect, useRef, useState } from 'react';
import BackButton from '../components/ui/BackButton.js';
import ConfirmInline from '../components/ui/ConfirmInline.js';

interface Fact {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Facts() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/facts')
      .then(r => r.ok ? r.json() : [])
      .then((data: Fact[]) => setFacts(data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      fetch('/api/facts')
        .then(r => r.ok ? r.json() : [])
        .then((data: Fact[]) => setFacts(data));
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      fetch(`/api/facts/search?q=${encodeURIComponent(query)}`)
        .then(r => r.ok ? r.json() : [])
        .then((data: Fact[]) => setFacts(data))
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function startEdit(fact: Fact) {
    setEditingId(fact.id);
    setEditBody(fact.text);
  }

  async function saveEdit(factId: string) {
    const res = await fetch(`/api/facts/${factId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editBody }),
    });
    if (res.ok) {
      setFacts(prev => prev.map(f => f.id === factId ? { ...f, text: editBody } : f));
    }
    setEditingId(null);
  }

  async function deleteFact(factId: string) {
    const res = await fetch(`/api/facts/${factId}`, { method: 'DELETE' });
    if (res.ok) {
      setFacts(prev => prev.filter(f => f.id !== factId));
    }
    setConfirmDeleteId(null);
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <BackButton />
      </header>
      <h1 className="settings-title">Facts</h1>
      <p className="settings-info u-muted">Structured assertions extracted from your conversations.</p>

      <div style={{ margin: '12px 0' }}>
        <input
          className="settings-input"
          type="search"
          placeholder="Search facts…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {(loading || searching) && <p className="settings-info">Loading…</p>}

      {!loading && !searching && facts.length === 0 && (
        <p className="settings-info u-muted">
          No facts yet. Facts will appear here as you chat.
        </p>
      )}

      {!loading && facts.map(fact => (
        <div key={fact.id} className="memory-entry">
          {editingId === fact.id ? (
            <>
              <textarea
                className="settings-textarea"
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={3}
                autoFocus
              />
              <div className="memory-entry__actions">
                <button className="btn btn--primary btn--sm" onClick={() => saveEdit(fact.id)}>Save</button>
                <button className="btn btn--sm" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div className="memory-entry__body">{fact.text}</div>
              <div className="memory-entry__footer">
                <div className="memory-entry__meta">
                  {Array.isArray(fact.metadata['categories']) && (
                    <>
                      {(fact.metadata['categories'] as string[]).map(c => (
                        <span key={c} className="memory-entry__type">{c}</span>
                      ))}
                      {' · '}
                    </>
                  )}
                  {relativeTime(fact.createdAt)}
                </div>
                {confirmDeleteId === fact.id ? (
                  <div className="memory-entry__actions">
                    <ConfirmInline
                      prompt="Delete?"
                      onConfirm={() => deleteFact(fact.id)}
                      onCancel={() => setConfirmDeleteId(null)}
                    />
                  </div>
                ) : (
                  <div className="memory-entry__actions">
                    <button className="btn btn--sm" onClick={() => startEdit(fact)}>Edit</button>
                    <button className="btn btn--sm" onClick={() => setConfirmDeleteId(fact.id)}>Delete</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
