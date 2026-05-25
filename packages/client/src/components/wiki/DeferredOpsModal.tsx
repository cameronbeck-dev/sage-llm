import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';

interface DeferredOp {
  id: string;
  turnId: string | null;
  op: Record<string, unknown>;
  status: string;
  createdAt: string;
}

interface DeferredOpsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DeferredOpsModal({ isOpen, onClose }: DeferredOpsModalProps) {
  const [ops, setOps] = useState<DeferredOp[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) { setOps([]); return; }
    setLoading(true);
    fetch('/api/wiki/deferred-ops', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { deferred: [] })
      .then((data: { deferred: DeferredOp[] }) => setOps(data.deferred))
      .finally(() => setLoading(false));
  }, [isOpen]);

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
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <p className="modal-title">Deferred Wiki Operations</p>
        {loading && <p className="settings-info">Loading…</p>}
        {!loading && ops.length === 0 && (
          <p className="settings-info u-muted">No pending deferred operations.</p>
        )}
        {!loading && ops.length > 0 && (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {ops.map(op => (
              <div
                key={op.id}
                className="memory-entry"
                style={{ marginBottom: 8 }}
              >
                <div className="memory-entry__body" style={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(op.op, null, 2)}
                </div>
                <div className="memory-entry__footer">
                  <div className="memory-entry__meta">
                    <span className="memory-entry__type">{op.status}</span>
                    {' · '}
                    {new Date(op.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
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
