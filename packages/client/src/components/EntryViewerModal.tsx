import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import type { MemoryEntry, KnowledgeChunk } from '@sage/shared';

type Target =
  | { type: 'memory'; entryId: string }
  | { type: 'chunk'; packId: string; chunkId: string };

interface EntryViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: Target;
}

export default function EntryViewerModal({ isOpen, onClose, target }: EntryViewerModalProps) {
  const [entry, setEntry] = useState<MemoryEntry | KnowledgeChunk | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) { setEntry(null); return; }
    setLoading(true);
    const url = target.type === 'memory'
      ? `/api/memory/entries/${target.entryId}`
      : `/api/knowledge/chunks/${target.chunkId}`;
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

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <p className="modal-title">{target.type === 'memory' ? 'Memory Entry' : 'Knowledge Entry'}</p>
        {loading && <p className="settings-info">Loading…</p>}
        {!loading && !entry && <p className="settings-info u-muted">Entry not found.</p>}
        {!loading && entry && (
          <div className="memory-entry" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <div className="memory-entry__body">{entry.body}</div>
            <div className="memory-entry__footer">
              <div className="memory-entry__meta">
                {target.type === 'memory'
                  ? <><span className="memory-entry__type">{(entry as MemoryEntry).type}</span>{' · '}{new Date(entry.createdAt).toLocaleString()}</>
                  : <><span className="memory-entry__type">{(entry as KnowledgeChunk).sourceFilename}</span>{' · '}{new Date(entry.createdAt).toLocaleString()}</>
                }
              </div>
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
