import { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import WikiRenderer from './WikiRenderer.js';

interface WikiPageModalProps {
  isOpen: boolean;
  onClose: () => void;
  path: string;
  versionId?: string;
}

interface VersionMeta {
  id: string;
  contentHash: string;
  author: string;
  reason: string | null;
  createdAt: string;
}

export default function WikiPageModal({ isOpen, onClose, path: initialPath, versionId: initialVersionId }: WikiPageModalProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [currentVersionId, setCurrentVersionId] = useState<string | undefined>(initialVersionId);
  const [body, setBody] = useState<string | null>(null);
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setBody(null);
      setNotFound(false);
      setVersionsOpen(false);
      setVersions([]);
      return;
    }
    setCurrentPath(initialPath);
    setCurrentVersionId(initialVersionId);
  }, [isOpen, initialPath, initialVersionId]);

  useEffect(() => {
    if (!isOpen || !currentPath) return;
    setLoading(true);
    setNotFound(false);
    setBody(null);

    const url = currentVersionId
      ? `/api/wiki/pages/${currentPath}/versions/${encodeURIComponent(currentVersionId)}`
      : `/api/wiki/pages/${currentPath}`;

    fetch(url, { credentials: 'include' })
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then(data => {
        if (!data) return;
        setBody(data.body ?? null);
        setFrontmatter(data.frontmatter ?? {});
      })
      .finally(() => setLoading(false));
  }, [isOpen, currentPath, currentVersionId]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleVersionsToggle = useCallback(() => {
    if (versionsOpen) {
      setVersionsOpen(false);
      return;
    }
    setVersionsOpen(true);
    if (versions.length > 0) return;
    setVersionsLoading(true);
    fetch(`/api/wiki/pages/${currentPath}/versions`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: VersionMeta[]) => setVersions(data))
      .finally(() => setVersionsLoading(false));
  }, [versionsOpen, versions.length, currentPath]);

  const loadPage = useCallback((target: string) => {
    setCurrentPath(target);
    setCurrentVersionId(undefined);
    setVersionsOpen(false);
    setVersions([]);
  }, []);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 720, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <p className="modal-title" style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{currentPath}</p>
        {currentVersionId && (
          <p className="settings-info u-muted" style={{ marginTop: -8, marginBottom: 8, fontSize: '0.75rem' }}>
            Viewing version {currentVersionId.slice(0, 8)}
          </p>
        )}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <p className="settings-info">Loading…</p>}
          {!loading && notFound && <p className="settings-info u-muted">Page not found.</p>}
          {!loading && !notFound && body !== null && (
            <WikiRenderer body={body} frontmatter={frontmatter} onWikilinkClick={loadPage} />
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            className="btn"
            type="button"
            onClick={handleVersionsToggle}
            style={{ marginBottom: 8, fontSize: '0.8rem' }}
          >
            {versionsOpen ? 'Hide version history' : 'Version history'}
          </button>
          {versionsOpen && (
            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 8 }}>
              {versionsLoading && <p className="settings-info">Loading versions…</p>}
              {!versionsLoading && versions.length === 0 && (
                <p className="settings-info u-muted">No versions recorded.</p>
              )}
              {!versionsLoading && versions.map(v => (
                <div
                  key={v.id}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--color-border, #eee)' }}
                >
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>
                    {new Date(v.createdAt).toLocaleString()} — {v.author}{v.reason ? ` (${v.reason})` : ''}
                  </span>
                  <button
                    className="btn"
                    type="button"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => { setCurrentVersionId(v.id); setVersionsOpen(false); }}
                  >
                    View
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
