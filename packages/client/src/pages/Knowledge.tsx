import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKnowledgeStore } from '../state/knowledgeStore.js';
import { useConversationStore } from '../state/conversationStore.js';
import type { KnowledgeFile, KnowledgePack } from '@sage/shared';
import BackButton from '../components/ui/BackButton.js';
import ConfirmInline from '../components/ui/ConfirmInline.js';

type RightTab = 'files' | 'entries';

export default function Knowledge() {
  const { packs, filesByPack, chunksByPack, isLoading, loadPacks, createPack, updatePack, deletePack, loadFiles, loadChunks, uploadFile, pollPendingFiles } = useKnowledgeStore();
  const { setActive } = useConversationStore();
  const navigate = useNavigate();

  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('files');
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
      setRightTab('files');
    }
  }, [selectedPackId, loadFiles]);

  useEffect(() => {
    if (selectedPackId && rightTab === 'entries') {
      loadChunks(selectedPackId);
    }
  }, [selectedPackId, rightTab, loadChunks]);

  useEffect(() => {
    if (selectedPackId) {
      pollPendingFiles(selectedPackId);
    }
  }, [selectedPackId, filesByPack, pollPendingFiles]);

  const selectedPack = packs.find(p => p.id === selectedPackId) ?? null;
  const selectedFiles = selectedPackId ? (filesByPack[selectedPackId] ?? []) : [];
  const selectedChunks = selectedPackId ? (chunksByPack[selectedPackId] ?? []) : [];

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
    const id = await useConversationStore.getState().createConversation(selectedPack.name, selectedPack.id);
    await setActive(id);
    navigate('/');
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <BackButton to="/" />
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
            <p className="settings-info u-muted">No packs yet.</p>
          )}
          <ul className="pack-list">
            {packs.map(pack => (
              <li
                key={pack.id}
                className={`pack-card${selectedPackId === pack.id ? ' pack-card--active' : ''}`}
                onClick={() => setSelectedPackId(pack.id)}
              >
                <div className="pack-card__name">{pack.name}</div>
                {pack.description && <div className="pack-card__desc">{pack.description}</div>}
              </li>
            ))}
          </ul>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedPack ? (
            <p className="settings-info u-muted">Select a pack to view its files.</p>
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
                    <ConfirmInline
                      prompt="Delete pack?"
                      onConfirm={() => handleDelete(selectedPack.id)}
                      onCancel={() => setConfirmDeleteId(null)}
                    />
                  ) : (
                    <button className="btn btn--sm" onClick={() => setConfirmDeleteId(selectedPack.id)}>Delete</button>
                  )}
                  <button className="btn btn--primary btn--sm" onClick={handleTalkToSage}>
                    Talk to Sage
                  </button>
                </div>
              )}

              <div className="memory-tabs" style={{ marginBottom: 12 }}>
                <button onClick={() => setRightTab('files')} className={rightTab === 'files' ? 'active' : ''}>Files</button>
                <button onClick={() => setRightTab('entries')} className={rightTab === 'entries' ? 'active' : ''}>Entries</button>
              </div>

              {rightTab === 'files' && (
                <>
                  <div
                    ref={dropRef}
                    className="knowledge-drop-zone"
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <p className="settings-info">Drop files here or click to upload</p>
                    <p className="settings-info u-font-11 u-muted-5 u-mt-4">PDF, MD, TXT, DOCX, CSV, JSON, code files — max 100 MB</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="u-hidden"
                      accept=".pdf,.md,.txt,.docx,.csv,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cpp,.c,.rb,.swift"
                      onChange={e => handleFiles(e.target.files)}
                    />
                  </div>

                  {uploadError && <p className="settings-info settings-info--danger u-mb-8">{uploadError}</p>}

                  {selectedFiles.length === 0 ? (
                    <p className="settings-info u-muted">No files yet.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="data-table__th">Filename</th>
                          <th className="data-table__th">Source</th>
                          <th className="data-table__th">Status</th>
                          <th className="data-table__th">Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedFiles.map(file => (
                          <tr key={file.id}>
                            <td className="data-table__td">{file.filename}</td>
                            <td className="data-table__td">
                              <span className="u-font-11 u-muted">{file.sourceKind === 'chat_extracted' ? 'extracted' : 'upload'}</span>
                            </td>
                            <td className="data-table__td">
                              <StatusBadge status={file.status} />
                            </td>
                            <td className="data-table__td data-table__td--muted">
                              {file.sizeBytes != null ? formatSize(file.sizeBytes) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {rightTab === 'entries' && (
                <>
                  {selectedChunks.length === 0 ? (
                    <p className="settings-info u-muted">No entries yet.</p>
                  ) : (
                    selectedChunks.map(chunk => (
                      <div key={chunk.id} className="memory-entry">
                        <div className="memory-entry__body">{chunk.body}</div>
                        <div className="memory-entry__footer">
                          <div className="memory-entry__meta">
                            <span className="memory-entry__type">{chunk.sourceFilename}</span>
                            {' · '}
                            {new Date(chunk.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </>
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
    ready: 'var(--accent)',
    failed: 'var(--danger)',
  };
  return (
    <span className="status-badge" style={{ color: colors[status] }}>
      {status}
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
