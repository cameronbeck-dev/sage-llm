import { useCallback, useEffect, useRef, useState } from 'react';
import ReactCodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { createTheme } from '@uiw/codemirror-themes';
import { tags as t } from '@lezer/highlight';
import WikiRenderer from '../components/wiki/WikiRenderer.js';
import BackButton from '../components/ui/BackButton.js';

interface PageMeta {
  pageId: string;
  path: string;
  title: string | null;
  type: string | null;
  tags: string[];
  contentHash: string;
  renameInProgress: boolean;
  updatedAt: string;
}

interface VersionMeta {
  id: string;
  contentHash: string;
  author: string;
  reason: string | null;
  createdAt: string;
}

interface LogEntry {
  id: string;
  op: string;
  pageId: string | null;
  summary: string | null;
  actor: string;
  createdAt: string;
}

interface PageData {
  body: string;
  frontmatter: Record<string, unknown>;
  contentHash: string;
  pageId: string;
  versionId: string | null;
  updatedAt: string;
}

interface ConflictState {
  ours: string;
  ourHash: string;
  theirs: string;
}

const SECTIONS = ['entities', 'concepts', 'comparisons', 'queries', 'raw'] as const;

const forestTheme = createTheme({
  theme: 'dark',
  settings: {
    background: '#1f221d',
    foreground: '#d8d6c8',
    caret: '#6cf08a',
    selection: 'rgba(108, 240, 138, 0.2)',
    selectionMatch: 'rgba(108, 240, 138, 0.1)',
    lineHighlight: 'rgba(108, 240, 138, 0.05)',
    gutterBackground: '#272b24',
    gutterForeground: '#4a4f42',
  },
  styles: [
    { tag: t.comment, color: '#4a4f42', fontStyle: 'italic' },
    { tag: t.heading, color: '#6cf08a', fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.link, color: '#4ab868' },
    { tag: t.url, color: '#4ab868' },
    { tag: t.monospace, color: '#8a8a7a' },
    { tag: t.keyword, color: '#6cf08a' },
  ],
});

function groupBySection(pages: PageMeta[]): Record<string, PageMeta[]> {
  const groups: Record<string, PageMeta[]> = {};
  for (const section of SECTIONS) {
    groups[section] = [];
  }
  for (const page of pages) {
    const section = page.path.split('/')[0];
    if (section && groups[section]) {
      groups[section].push(page);
    }
  }
  return groups;
}

function pageLabel(page: PageMeta): string {
  const parts = page.path.split('/');
  const filename = parts[parts.length - 1].replace(/\.md$/, '');
  if (page.path.startsWith('queries/') && parts.length > 2) {
    return parts.slice(1).join('/').replace(/\.md$/, '');
  }
  return filename;
}

export default function Wiki() {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit' | 'schema'>('view');
  const [editorBody, setEditorBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [newPageSection, setNewPageSection] = useState<string>('entities');
  const [newPageSlug, setNewPageSlug] = useState('');
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [schemaBody, setSchemaBody] = useState('');
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [versionData, setVersionData] = useState<{ body: string; frontmatter: Record<string, unknown> } | null>(null);

  const originalHashRef = useRef<string>('');

  const loadPages = useCallback(async () => {
    setPagesLoading(true);
    try {
      const r = await fetch('/api/wiki/pages?limit=500', { credentials: 'include' });
      if (r.ok) setPages(await r.json());
    } finally {
      setPagesLoading(false);
    }
  }, []);

  useEffect(() => { loadPages(); }, [loadPages]);

  const loadPage = useCallback(async (path: string) => {
    setSelectedPath(path);
    setMode('view');
    setPageData(null);
    setVersions([]);
    setLog([]);
    setViewingVersionId(null);
    setVersionData(null);
    setPageLoading(true);
    try {
      const r = await fetch(`/api/wiki/pages/${path}`, { credentials: 'include' });
      if (r.ok) {
        const data: PageData = await r.json();
        setPageData(data);
        originalHashRef.current = data.contentHash;
        loadVersions(path);
        loadLog(data.pageId);
      }
    } finally {
      setPageLoading(false);
    }
  }, []);

  const loadVersions = async (path: string) => {
    setVersionsLoading(true);
    try {
      const r = await fetch(`/api/wiki/pages/${path}/versions`, { credentials: 'include' });
      if (r.ok) setVersions(await r.json());
    } finally {
      setVersionsLoading(false);
    }
  };

  const loadLog = async (pageId: string) => {
    setLogLoading(true);
    try {
      const r = await fetch(`/api/wiki/log?pageId=${pageId}&limit=20`, { credentials: 'include' });
      if (r.ok) setLog(await r.json());
    } finally {
      setLogLoading(false);
    }
  };

  const loadSchema = useCallback(async () => {
    setSchemaLoading(true);
    try {
      const r = await fetch('/api/wiki/schema', { credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        setSchemaBody(data.body ?? '');
      }
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  const handleEdit = () => {
    if (!pageData) return;
    setEditorBody(pageData.body);
    originalHashRef.current = pageData.contentHash;
    setMode('edit');
    setSaveError(null);
    setConflict(null);
  };

  const handleEditSchema = async () => {
    await loadSchema();
    setMode('schema');
    setSaveError(null);
  };

  const handleCancel = () => {
    setMode('view');
    setSaveError(null);
    setConflict(null);
  };

  const handleSave = useCallback(async () => {
    if (!selectedPath || !pageData) return;
    setSaving(true);
    setSaveError(null);
    setConflict(null);
    try {
      const r = await fetch(`/api/wiki/pages/${selectedPath}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${originalHashRef.current}"`,
        },
        body: JSON.stringify({ body: editorBody }),
      });
      if (r.ok) {
        await loadPage(selectedPath);
        await loadPages();
      } else if (r.status === 409) {
        const data = await r.json();
        setConflict({ ours: data.ours, ourHash: data.ourHash, theirs: editorBody });
      } else {
        const data = await r.json();
        setSaveError(data.error?.message ?? 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }, [selectedPath, pageData, editorBody, loadPage, loadPages]);

  const handleSaveSchema = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch('/api/wiki/schema', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: schemaBody }),
      });
      if (r.ok) {
        setMode('view');
      } else {
        const data = await r.json();
        setSaveError(data.error?.message ?? 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPath) return;
    const r = await fetch(`/api/wiki/pages/${selectedPath}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (r.status === 204) {
      setSelectedPath(null);
      setPageData(null);
      setDeleteConfirm(false);
      await loadPages();
    }
  };

  const handleRename = async () => {
    if (!selectedPath || !renameValue.trim()) return;
    setRenameError(null);
    const r = await fetch(`/api/wiki/pages/${selectedPath}/rename`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: renameValue.trim() }),
    });
    if (r.ok) {
      const newPath = renameValue.trim();
      setRenaming(false);
      setRenameValue('');
      await loadPages();
      await loadPage(newPath);
    } else {
      const data = await r.json();
      setRenameError(data.error?.message ?? 'Rename failed');
    }
  };

  const handleRestore = async (versionId: string) => {
    if (!selectedPath) return;
    const r = await fetch(`/api/wiki/pages/${selectedPath}/restore/${versionId}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (r.ok) {
      await loadPage(selectedPath);
    }
  };

  const handleViewVersion = async (v: VersionMeta) => {
    if (!selectedPath) return;
    setViewingVersionId(v.id);
    const r = await fetch(`/api/wiki/pages/${selectedPath}/versions/${v.id}`, { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setVersionData({ body: data.body ?? '', frontmatter: data.frontmatter ?? {} });
    }
  };

  const handleConflictForceOverwrite = async () => {
    if (!selectedPath || !conflict) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/wiki/pages/${selectedPath}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: conflict.theirs }),
      });
      if (r.ok) {
        setConflict(null);
        await loadPage(selectedPath);
        await loadPages();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConflictReloadTheirs = () => {
    if (!conflict) return;
    setEditorBody(conflict.ours);
    originalHashRef.current = conflict.ourHash;
    setConflict(null);
  };

  const handleCreatePage = async () => {
    if (!newPageSlug.trim()) return;
    const path = `${newPageSection}/${newPageSlug.trim()}.md`;
    const body = `---\ntitle: ${newPageSlug.trim()}\ntype: ${newPageSection.replace(/s$/, '')}\ntags: []\n---\n\n`;
    const r = await fetch(`/api/wiki/pages/${path}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (r.ok) {
      setNewPageOpen(false);
      setNewPageSlug('');
      await loadPages();
      await loadPage(path);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (mode === 'edit') handleSave();
        else if (mode === 'schema') handleSaveSchema();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mode, handleSave]);

  const wikilinkCompletion = useCallback(async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\[\[([^\]]*)/);
    if (!match) return null;
    const query = match.text.slice(2);
    const r = await fetch(`/api/wiki/autocomplete?q=${encodeURIComponent(query)}&limit=10`, { credentials: 'include' });
    if (!r.ok) return null;
    const results: PageMeta[] = await r.json();
    return {
      from: match.from + 2,
      options: results.map(p => ({
        label: p.path,
        displayLabel: p.title ?? p.path,
        apply: p.path,
      })),
    };
  }, []);

  const extensions = [
    markdown(),
    autocompletion({ override: [wikilinkCompletion] }),
  ];

  const groups = groupBySection(pages);

  return (
    <div className="wiki-page">
      <aside className="wiki-tree">
        <div className="wiki-tree__header">
          <BackButton />
          <span className="wiki-tree__title">Wiki</span>
        </div>
        <div className="wiki-tree__body">
          {pagesLoading ? (
            <p className="settings-info" style={{ padding: '12px 16px' }}>Loading…</p>
          ) : (
            SECTIONS.map(section => (
              <div key={section} className="wiki-tree__section">
                <div className="wiki-tree__section-header">{section}</div>
                {groups[section].map(page => (
                  <button
                    key={page.pageId}
                    className={`wiki-tree__item${selectedPath === page.path ? ' wiki-tree__item--active' : ''}`}
                    onClick={() => loadPage(page.path)}
                    title={page.path}
                  >
                    {page.renameInProgress && (
                      <span className="wiki-tree__rename-dot" title="Rename in progress" />
                    )}
                    {pageLabel(page)}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="wiki-tree__footer">
          {newPageOpen ? (
            <div className="wiki-tree__new-form">
              <select
                className="settings-input"
                value={newPageSection}
                onChange={e => setNewPageSection(e.target.value)}
                style={{ marginBottom: 6 }}
              >
                {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input
                className="settings-input"
                placeholder="slug (e.g. teelo)"
                value={newPageSlug}
                onChange={e => setNewPageSlug(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreatePage(); if (e.key === 'Escape') setNewPageOpen(false); }}
                style={{ marginBottom: 6 }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn--primary" onClick={handleCreatePage} style={{ flex: 1 }}>Create</button>
                <button className="btn" onClick={() => setNewPageOpen(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn u-w-full" onClick={() => setNewPageOpen(true)}>+ New page</button>
          )}
        </div>
      </aside>

      <main className="wiki-main">
        <div className="wiki-main__topbar">
          {selectedPath ? (
            <>
              <span className="wiki-main__path" title={selectedPath}>{selectedPath}</span>
              {pages.find(p => p.path === selectedPath)?.renameInProgress && (
                <span className="wiki-rename-dot" title="Rename in progress" />
              )}
              {mode === 'view' && (
                <>
                  <button className="btn" onClick={handleEdit} disabled={!pageData}>Edit</button>
                  <button className="btn" onClick={handleEditSchema}>Edit SCHEMA</button>
                  {deleteConfirm ? (
                    <>
                      <span className="settings-info" style={{ color: 'var(--danger)' }}>Delete?</span>
                      <button className="btn btn--danger" onClick={handleDelete}>Yes, delete</button>
                      <button className="btn" onClick={() => setDeleteConfirm(false)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn" onClick={() => setDeleteConfirm(true)}>Delete</button>
                  )}
                  {renaming ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        className="settings-input"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
                        placeholder="new/path.md"
                        style={{ width: 200 }}
                        autoFocus
                      />
                      <button className="btn btn--primary" onClick={handleRename}>Rename</button>
                      <button className="btn" onClick={() => { setRenaming(false); setRenameError(null); }}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn" onClick={() => { setRenaming(true); setRenameValue(selectedPath ?? ''); }}>Rename</button>
                  )}
                  {renameError && <span className="settings-info" style={{ color: 'var(--danger)' }}>{renameError}</span>}
                </>
              )}
              {(mode === 'edit' || mode === 'schema') && (
                <>
                  <button className="btn btn--primary" onClick={mode === 'edit' ? handleSave : handleSaveSchema} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn" onClick={handleCancel} disabled={saving}>Cancel</button>
                </>
              )}
            </>
          ) : (
            <span className="settings-info">Select a page from the tree, or create a new one.</span>
          )}
        </div>

        <div className="wiki-main__content">
          {conflict && (
            <div className="wiki-conflict">
              <p className="settings-info" style={{ color: 'var(--danger)', marginBottom: 8 }}>
                Conflict: the page was modified since you started editing.
              </p>
              <div className="wiki-conflict__panels">
                <div className="wiki-conflict__panel">
                  <div className="wiki-conflict__panel-title">Their version (server)</div>
                  <pre className="wiki-conflict__body">{conflict.ours}</pre>
                </div>
                <div className="wiki-conflict__panel">
                  <div className="wiki-conflict__panel-title">Your version</div>
                  <pre className="wiki-conflict__body">{conflict.theirs}</pre>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn--danger" onClick={handleConflictForceOverwrite} disabled={saving}>
                  Force overwrite (use mine)
                </button>
                <button className="btn" onClick={handleConflictReloadTheirs}>
                  Reload theirs (discard my changes)
                </button>
              </div>
            </div>
          )}

          {saveError && !conflict && (
            <p className="settings-info" style={{ color: 'var(--danger)', padding: '8px 16px' }}>{saveError}</p>
          )}

          {mode === 'view' && !selectedPath && (
            <div className="wiki-empty">
              <p className="settings-info">Select a page from the tree, or create a new one.</p>
            </div>
          )}

          {mode === 'view' && selectedPath && (
            <>
              {pageLoading && <p className="settings-info" style={{ padding: '16px' }}>Loading…</p>}
              {!pageLoading && viewingVersionId && versionData && (
                <div className="wiki-main__viewer">
                  <div className="wiki-version-banner">
                    <span className="settings-info u-muted">Viewing historical version {viewingVersionId.slice(0, 8)}</span>
                    <button className="btn" onClick={() => { setViewingVersionId(null); setVersionData(null); }} style={{ fontSize: '0.8rem' }}>
                      Back to current
                    </button>
                  </div>
                  <WikiRenderer body={versionData.body} frontmatter={versionData.frontmatter} />
                </div>
              )}
              {!pageLoading && !viewingVersionId && pageData && (
                <div className="wiki-main__viewer">
                  <WikiRenderer
                    body={pageData.body}
                    frontmatter={pageData.frontmatter}
                    onWikilinkClick={loadPage}
                  />
                </div>
              )}
              {!pageLoading && !pageData && selectedPath && (
                <p className="settings-info u-muted" style={{ padding: '16px' }}>Page not found.</p>
              )}
            </>
          )}

          {mode === 'edit' && !conflict && (
            <ReactCodeMirror
              value={editorBody}
              onChange={setEditorBody}
              extensions={extensions}
              theme={forestTheme}
              height="100%"
              style={{ height: '100%', fontSize: 13 }}
            />
          )}

          {mode === 'schema' && (
            schemaLoading ? (
              <p className="settings-info" style={{ padding: '16px' }}>Loading SCHEMA…</p>
            ) : (
              <ReactCodeMirror
                value={schemaBody}
                onChange={setSchemaBody}
                extensions={extensions}
                theme={forestTheme}
                height="100%"
                style={{ height: '100%', fontSize: 13 }}
              />
            )
          )}
        </div>
      </main>

      <aside className="wiki-sidebar">
        {selectedPath && pageData && (
          <>
            <div className="wiki-sidebar__section">
              <div className="wiki-sidebar__section-title">Versions</div>
              {versionsLoading && <p className="settings-info">Loading…</p>}
              {!versionsLoading && versions.length === 0 && (
                <p className="settings-info u-muted" style={{ fontSize: 12 }}>No versions recorded.</p>
              )}
              {!versionsLoading && versions.map(v => (
                <div key={v.id} className="wiki-version-row">
                  <div className="wiki-version-row__meta">
                    <span>{new Date(v.createdAt).toLocaleString()}</span>
                    <span className="u-muted"> — {v.author}{v.reason ? ` (${v.reason})` : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn"
                      style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                      onClick={() => handleViewVersion(v)}
                    >
                      View
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                      onClick={() => handleRestore(v.id)}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="wiki-sidebar__section">
              <div className="wiki-sidebar__section-title">Recent activity</div>
              {logLoading && <p className="settings-info">Loading…</p>}
              {!logLoading && log.length === 0 && (
                <p className="settings-info u-muted" style={{ fontSize: 12 }}>No activity yet.</p>
              )}
              {!logLoading && log.map(entry => (
                <div key={entry.id} className="wiki-log-row">
                  <span className="wiki-log-row__op">{entry.op}</span>
                  <span className="u-muted"> {entry.actor}</span>
                  {entry.summary && <span className="u-muted"> — {entry.summary}</span>}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {(!selectedPath || !pageData) && (
          <p className="settings-info u-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
            Select a page to see versions and activity.
          </p>
        )}
      </aside>
    </div>
  );
}
