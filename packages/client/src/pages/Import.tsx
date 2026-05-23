import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/ui/BackButton.js';

interface ImportRow {
  id: string;
  source: 'chatgpt' | 'claude' | 'generic';
  filename: string;
  status: 'uploaded' | 'parsing' | 'ready' | 'committing' | 'done' | 'failed';
  stats: {
    conversationCount?: number;
    messageCount?: number;
    skipped?: number;
    errors?: string[];
  };
  error_msg: string | null;
  created_at: string;
}

const POLL_INTERVAL_MS = 2000;
const POLLING_STATUSES: ImportRow['status'][] = ['uploaded', 'parsing', 'committing'];

export default function Import() {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [activeImport, setActiveImport] = useState<ImportRow | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [committing, setCommitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/imports')
      .then((r) => r.ok ? r.json() : [])
      .then((data: ImportRow[]) => setImports(data))
      .finally(() => setLoadingList(false));
  }, []);

  const startPolling = useCallback((importId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/imports/${importId}`);
      if (!res.ok) return;
      const data: ImportRow = await res.json();
      setActiveImport(data);
      setImports((prev) => {
        const idx = prev.findIndex((i) => i.id === importId);
        if (idx === -1) return [data, ...prev];
        const next = [...prev];
        next[idx] = data;
        return next;
      });
      if (!POLLING_STATUSES.includes(data.status)) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, POLL_INTERVAL_MS);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/imports', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: 'Upload failed' } }));
        throw new Error(body?.error?.message ?? 'Upload failed');
      }
      const { importId } = await res.json() as { importId: string };
      setActiveImportId(importId);
      const statusRes = await fetch(`/api/imports/${importId}`);
      if (statusRes.ok) {
        const data: ImportRow = await statusRes.json();
        setActiveImport(data);
        setImports((prev) => {
          const idx = prev.findIndex((i) => i.id === importId);
          if (idx === -1) return [data, ...prev];
          const next = [...prev];
          next[idx] = data;
          return next;
        });
        if (POLLING_STATUSES.includes(data.status)) startPolling(importId);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  }

  async function handleCommit() {
    if (!activeImportId) return;
    setCommitting(true);
    try {
      const res = await fetch(`/api/imports/${activeImportId}/commit`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: 'Commit failed' } }));
        throw new Error(body?.error?.message ?? 'Commit failed');
      }
      const data: ImportRow = await res.json();
      setActiveImport(data);
      startPolling(activeImportId);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCommitting(false);
    }
  }

  const display = activeImportId ? activeImport : null;

  return (
    <div className="settings-page">
      <header className="settings-header">
        <BackButton to="/settings" />
      </header>
      <h1 className="settings-title">Import Conversations</h1>

      <section className="settings-section pixel-border">
        <p className="settings-info">
          Supported formats: <strong>ChatGPT export (.zip)</strong> and <strong>Claude.ai export (.jsonl)</strong>.
          Max 500 MB per file. 20 imports per day.
        </p>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent, #5caf6e)' : 'rgba(255,255,255,0.2)'}`,
            borderRadius: 4,
            padding: 32,
            textAlign: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.6 : 1,
            marginTop: 12,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.jsonl,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={uploading}
          />
          {uploading ? (
            <p className="settings-info">Uploading...</p>
          ) : (
            <p className="settings-info">Drop a file here or click to browse</p>
          )}
        </div>
      </section>

      {display && (
        <section className="settings-section pixel-border">
          <h2 className="settings-section__title">
            {display.filename}
            <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.6 }}>({display.status})</span>
          </h2>

          {display.status === 'failed' && (
            <p className="api-key-error">{display.error_msg ?? 'Import failed.'}</p>
          )}

          {(display.status === 'uploaded' || display.status === 'parsing') && (
            <p className="settings-info">Analysing file...</p>
          )}

          {display.status === 'committing' && (
            <p className="settings-info">Importing conversations into Sage...</p>
          )}

          {display.status === 'done' && (
            <p className="api-key-success">Import complete.</p>
          )}

          {(display.status === 'ready' || display.status === 'done') && display.stats && (
            <table className="data-table data-table--compact u-mt-12">
              <tbody>
                <tr>
                  <td className="data-table__td data-table__td--muted">Conversations</td>
                  <td className="data-table__td data-table__td--right">{display.stats.conversationCount ?? 0}</td>
                </tr>
                <tr>
                  <td className="data-table__td data-table__td--muted">Messages</td>
                  <td className="data-table__td data-table__td--right">{display.stats.messageCount ?? 0}</td>
                </tr>
                {(display.stats.skipped ?? 0) > 0 && (
                  <tr>
                    <td className="data-table__td data-table__td--muted">Skipped</td>
                    <td className="data-table__td data-table__td--right">{display.stats.skipped}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {display.status === 'ready' && display.stats.errors && display.stats.errors.length > 0 && (
            <details className="u-mt-8">
              <summary className="settings-info" style={{ cursor: 'pointer' }}>
                {display.stats.errors.length} parse warning{display.stats.errors.length > 1 ? 's' : ''}
              </summary>
              <ul className="import-errors-list">
                {display.stats.errors.map((e, i) => (
                  <li key={i} className="settings-info settings-info--warning">{e}</li>
                ))}
              </ul>
            </details>
          )}

          {display.status === 'ready' && (
            <div className="u-mt-16">
              <button
                className="btn btn--primary"
                onClick={handleCommit}
                disabled={committing}
              >
                {committing ? 'Starting...' : 'Import into Sage'}
              </button>
              <p className="settings-info u-mt-8 u-muted">
                Conversations will be archived and their content will be used to seed your memory.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="settings-section pixel-border">
        <h2 className="settings-section__title">Past Imports</h2>
        {loadingList && <p className="settings-info">Loading...</p>}
        {!loadingList && imports.length === 0 && (
          <p className="settings-info u-muted">No imports yet.</p>
        )}
        {!loadingList && imports.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th className="data-table__th">File</th>
                <th className="data-table__th">Source</th>
                <th className="data-table__th">Status</th>
                <th className="data-table__th data-table__th--right">Date</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr
                  key={imp.id}
                  className="u-cursor-pointer"
                  onClick={() => {
                    setActiveImportId(imp.id);
                    setActiveImport(imp);
                    if (POLLING_STATUSES.includes(imp.status)) startPolling(imp.id);
                  }}
                >
                  <td className="data-table__td">{imp.filename}</td>
                  <td className="data-table__td">{imp.source}</td>
                  <td className="data-table__td">{imp.status}</td>
                  <td className="data-table__td data-table__td--right">
                    {new Date(imp.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
