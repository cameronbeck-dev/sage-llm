import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useKnowledgeStore } from '../state/knowledgeStore.js';
import { useConversationStore } from '../state/conversationStore.js';
import type { KnowledgePack, KnowledgeFile } from '@sage/shared';

export default function Knowledge() {
  const { packs, filesByPack, isLoading, loadPacks, createPack, updatePack, deletePack, loadFiles, uploadFile, pollPendingFiles } = useKnowledgeStore();
  const { createConversation, setActive } = useConversationStore();
  const navigate = useNavigate();

  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPackName, setNewPackName] = useState('');
  const [newPackDesc, setNewPackDesc] = useState('');
  const [editingPack, setEditingPack] = useState<KnowledgePack | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

  useEffect(() => {
    if (selectedPackId) {
      loadFiles(selectedPackId);
    }
  }, [selectedPackId, loadFiles]);

  useEffect(() => {
    if (selectedPackId) {
      pollPendingFiles(selectedPackId);
    }
  }, [selectedPackId, filesByPack, pollPendingFiles]);

  const selectedPack = packs.find(p => p.id === selectedPackId) ?? null;
  const selectedFiles = selectedPackId ? (filesByPack[selectedPackId] ?? []) : [];

  async function handleCreatePack(e: React.FormEvent) {
    e.preventDefault();
    if (!newPackName.trim()) return;
    await createPack(newPackName.trim(), newPackDesc.trim() || undefined);
    setNewPackName('');
    setNewPackDesc('');
    setCreating(false);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPack || !editName.trim()) return;
    await updatePack(editingPack.id, { name: editName.trim(), description: editDesc.trim() || null });
    setEditingPack(null);
  }

  async function handleDelete(packId: string) {
    await deletePack(packId);
    if (selectedPackId === packId) setSelectedPackId(null);
    setConfirmDeleteId(null);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !selectedPackId) return;
    setUploadError(null);
    for (const file of Array.from(files)) {
      try {
        await uploadFile(selectedPackId, file);
      } catch {
        setUploadError(`Failed to upload ${file.name}`);
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  async function handleTalkToSage() {
    if (!selectedPack) return;
    const id = await createConversation(`Pack: ${selectedPack.name}`, selectedPack.id);
    await setActive(id);
    navigate('/');
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/" className="btn btn--sm">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginRight: 4 }}>
            <path d="M8 5H2M2 5L5 2M2 5L5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </Link>
      </header>
      <h1 className="settings-title">Knowledge Packs</h1>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          <button className="btn btn--primary btn--sm" style={{ width: '100%', marginBottom: 12 }} onClick={() => setCreating(true)}>
            + New Pack
          </button>

          {creating && (
            <form onSubmit={handleCreatePack} style={{ marginBottom: 12 }}>
              <input
                className="settings-input"
                placeholder="Pack name"
                value={newPackName}
                onChange={e => setNewPackName(e.target.value)}
                autoFocus
                style={{ marginBottom: 6 }}
              />
              <input
                className="settings-input"
                placeholder="Description (optional)"
                value={newPackDesc}
                onChange={e => setNewPackDesc(e.target.value)}
                style={{ marginBottom: 6 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn--primary btn--sm" type="submit">Create</button>
                <button className="btn btn--sm" type="button" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </form>
          )}

          {isLoading && <p className="settings-info">Loading...</p>}
          {!isLoading && packs.length === 0 && !creating && (
            <p className="settings-info" style={{ opacity: 0.6 }}>No packs yet.</p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {packs.map(pack => (
              <li
                key={pack.id}
                className={`memory-entry${selectedPackId === pack.id ? ' memory-entry--active' : ''}`}
                style={{ cursor: 'pointer', padding: '8px 10px', marginBottom: 4, borderRadius: 4 }}
                onClick={() => setSelectedPackId(pack.id)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{pack.name}</div>
                {pack.description && <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{pack.description}</div>}
              </li>
            ))}
          </ul>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedPack ? (
            <p className="settings-info" style={{ opacity: 0.6 }}>Select a pack to view its files.</p>
          ) : (
            <>
              {editingPack?.id === selectedPack.id ? (
                <form onSubmit={handleSaveEdit} style={{ marginBottom: 16 }}>
                  <input
                    className="settings-input"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    autoFocus
                    style={{ marginBottom: 6 }}
                  />
                  <input
                    className="settings-input"
                    placeholder="Description (optional)"
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    style={{ marginBottom: 6 }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn--primary btn--sm" type="submit">Save</button>
                    <button className="btn btn--sm" type="button" onClick={() => setEditingPack(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <div style={{ flex: 1 }}>
                    <h2 className="settings-section__title">{selectedPack.name}</h2>
                    {selectedPack.description && <p className="settings-info" style={{ marginTop: 2 }}>{selectedPack.description}</p>}
                  </div>
                  <button className="btn btn--sm" onClick={() => {
                    setEditingPack(selectedPack);
                    setEditName(selectedPack.name);
                    setEditDesc(selectedPack.description ?? '');
                  }}>Edit</button>
                  {confirmDeleteId === selectedPack.id ? (
                    <>
                      <span className="settings-info">Delete pack?</span>
                      <button className="btn btn--sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(selectedPack.id)}>Yes</button>
                      <button className="btn btn--sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn--sm" onClick={() => setConfirmDeleteId(selectedPack.id)}>Delete</button>
                  )}
                  <button className="btn btn--primary btn--sm" onClick={handleTalkToSage}>
                    Talk to Sage
                  </button>
                </div>
              )}

              <div
                ref={dropRef}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                style={{
                  border: '2px dashed var(--border)',
                  borderRadius: 6,
                  padding: 20,
                  textAlign: 'center',
                  marginBottom: 16,
                  cursor: 'pointer',
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <p className="settings-info">Drop files here or click to upload</p>
                <p style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>PDF, MD, TXT, DOCX, CSV, JSON, code files — max 100 MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  accept=".pdf,.md,.txt,.docx,.csv,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cpp,.c,.rb,.swift"
                  onChange={e => handleFiles(e.target.files)}
                />
              </div>

              {uploadError && <p className="settings-info" style={{ color: 'var(--danger)', marginBottom: 8 }}>{uploadError}</p>}

              {selectedFiles.length === 0 ? (
                <p className="settings-info" style={{ opacity: 0.6 }}>No files yet.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Filename</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Source</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedFiles.map(file => (
                      <tr key={file.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px' }}>{file.filename}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{ fontSize: 11, opacity: 0.7 }}>{file.sourceKind === 'chat_extracted' ? 'extracted' : 'upload'}</span>
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <StatusBadge status={file.status} />
                        </td>
                        <td style={{ padding: '6px 8px', opacity: 0.6 }}>
                          {file.sizeBytes != null ? formatSize(file.sizeBytes) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: KnowledgeFile['status'] }) {
  const colors: Record<KnowledgeFile['status'], string> = {
    pending: 'var(--text-muted)',
    parsing: 'var(--accent)',
    ready: '#4caf50',
    failed: 'var(--danger)',
  };
  return (
    <span style={{ fontSize: 11, color: colors[status], fontWeight: 600 }}>
      {status}
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
