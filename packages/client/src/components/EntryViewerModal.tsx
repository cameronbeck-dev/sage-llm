import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import type { MemoryEntry, KnowledgeChunk } from '@sage/shared';

export type Target =
  | { type: 'memory'; entryId: string }
  | { type: 'chunk'; packId: string; chunkId: string }
  | { type: 'fact'; factId: string };

interface FactRecord {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface EntryViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: Target;
}

export default function EntryViewerModal({ isOpen, onClose, target }: EntryViewerModalProps) {
  const [entry, setEntry] = useState<MemoryEntry | KnowledgeChunk | FactRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) { setEntry(null); return; }
    setLoading(true);
    let url: string;
    if (target.type === 'memory') {
      url = `/api/memory/entries/${target.entryId}`;
    } else if (target.type === 'chunk') {
      url = `/api/knowledge/chunks/${target.chunkId}`;
    } else {
      url = `/api/facts/${target.factId}`;
    }
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => setEntry(data))
      .finally(() => setLoading(false));
  }, [isOpen, target]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function getTitle() {
    if (target.type === 'memory') return 'Memory Entry';
    if (target.type === 'chunk') return 'Knowledge Entry';
    return 'Fact';
  }

  function getBody() {
    if (!entry) return null;
    if (target.type === 'fact') return (entry as FactRecord).text;
    return (entry as MemoryEntry | KnowledgeChunk).body;
  }

  function getMeta() {
    if (!entry) return null;
    if (target.type === 'memory') {
      return <><span className="memory-entry__type">{(entry as MemoryEntry).type}</span>{' · '}{new Date(entry.createdAt).toLocaleString()}</>;
    }
    if (target.type === 'chunk') {
      return <><span className="memory-entry__type">{(entry as KnowledgeChunk).sourceFilename}</span>{' · '}{new Date(entry.createdAt).toLocaleString()}</>;
    }
    return <>{new Date((entry as FactRecord).createdAt).toLocaleString()}</>;
  }

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <p className="modal-title">{getTitle()}</p>
        {loading && <p className="settings-info">Loading…</p>}
        {!loading && !entry && <p className="settings-info u-muted">Entry not found.</p>}
        {!loading && entry && (
          <div className="memory-entry" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <div className="memory-entry__body">{getBody()}</div>
            <div className="memory-entry__footer">
              <div className="memory-entry__meta">{getMeta()}</div>
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
