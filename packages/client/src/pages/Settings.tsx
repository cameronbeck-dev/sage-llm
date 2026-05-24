import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettingsStore } from '../state/settingsStore.js';
import type { RoleModel } from '../state/settingsStore.js';
import { triggerToast } from '../components/ui/ToastContainer.js';
import ProviderModelSelect from '../components/chat/ProviderModelSelect.js';
import ConfirmModal from '../components/ui/ConfirmModal.js';

function DangerZone() {
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch('/api/account/export', { method: 'POST' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sage-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      triggerToast((err as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch('/api/account', { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      window.location.href = '/login';
    } catch (err) {
      triggerToast((err as Error).message, 'error');
      setDeleting(false);
    }
  }

  return (
    <section className="settings-section pixel-border card--danger">
      <h2 className="settings-section__title settings-section__title--danger">Danger Zone</h2>
      <p className="settings-info u-muted u-mb-16">
        These actions are irreversible. Please proceed with caution.
      </p>

      <div className="u-flex u-gap-12 u-flex-wrap">
        <button
          className="btn btn--danger-outline"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? 'Exporting...' : 'Export my data'}
        </button>
        <button
          className="btn btn--danger-outline"
          onClick={() => setDeleteModalOpen(true)}
        >
          Delete my account
        </button>
      </div>

      <ConfirmModal
        isOpen={deleteModalOpen}
        title="Delete account"
        message="This will permanently delete your account, all conversations, messages, and stored data."
        confirmLabel={deleting ? 'Deleting...' : 'Confirm delete'}
        danger
        confirmationText="DELETE"
        onConfirm={handleDelete}
        onCancel={() => setDeleteModalOpen(false)}
      />
    </section>
  );
}

type ProviderId = 'openai' | 'minimax' | 'anthropic';

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="settings-section pixel-border">
      <button
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          width: '100%',
          textAlign: 'left',
        }}
      >
        <h2 className="settings-section__title" style={{ margin: 0, flex: 1 }}>{title}</h2>
        <span style={{ fontSize: 12, opacity: 0.6, userSelect: 'none' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </section>
  );
}

function AgentInstructionsContent() {
  const [agentsContent, setAgentsContent] = useState('');
  const [agentsSaving, setAgentsSaving] = useState(false);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetch('/api/docs/AGENTS.md')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setAgentsContent(d.content); })
      .finally(() => setAgentsLoading(false));
  }, []);

  async function handleAgentsSave() {
    setAgentsSaving(true);
    try {
      const res = await fetch('/api/docs/AGENTS.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: agentsContent }),
      });
      if (!res.ok) throw new Error('Failed to save');
      triggerToast('Agent instructions saved.', 'success');
    } catch (err) {
      triggerToast((err as Error).message, 'error');
    } finally {
      setAgentsSaving(false);
    }
  }

  return (
    <>
      <p className="settings-info">
        Edit the AGENTS.md file that controls how Sage behaves. This is raw Markdown — no preview.
      </p>
      {agentsLoading ? (
        <p className="settings-info">Loading...</p>
      ) : (
        <>
          <textarea
            className="settings-textarea"
            value={agentsContent}
            onChange={e => setAgentsContent(e.target.value)}
            rows={16}
          />
          <div style={{ marginTop: 8 }}>
            <button
              className="btn btn--primary"
              onClick={handleAgentsSave}
              disabled={agentsSaving}
            >
              {agentsSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      )}
    </>
  );
}


interface CredentialSectionProps {
  providerId: ProviderId;
  displayName: string;
  hasKey: boolean;
  onSave: (apiKey: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

function CredentialSection({ providerId, displayName, hasKey, onSave, onDelete }: CredentialSectionProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [keyValue, setKeyValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setMode('view');
    setKeyValue('');
    setError(null);
    setSuccess(false);
  }, [providerId]);

  async function handleSave() {
    if (!keyValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(keyValue.trim());
      setSuccess(true);
      setMode('view');
      setKeyValue('');
      setTimeout(() => setSuccess(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="api-key-section">
      <div className="api-key-header">
        <span className="api-key-provider">{displayName}</span>
        {hasKey && (
          <span className="api-key-badge api-key-badge--saved">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Key saved
          </span>
        )}
        {!hasKey && (
          <span className="api-key-badge api-key-badge--missing">No key</span>
        )}
      </div>

      {mode === 'view' ? (
        <div className="api-key-actions">
          <button
            className="api-key-btn api-key-btn--edit"
            onClick={() => setMode('edit')}
          >
            {hasKey ? 'Replace key' : 'Add key'}
          </button>
          {hasKey && (
            <button
              className="api-key-btn api-key-btn--delete"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Removing...' : 'Remove'}
            </button>
          )}
        </div>
      ) : (
        <div className="api-key-edit">
          <input
            type="password"
            className="api-key-input"
            placeholder={`${displayName} API key`}
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            autoFocus
          />
          <div className="api-key-edit-actions">
            <button
              className="api-key-btn api-key-btn--save"
              onClick={handleSave}
              disabled={saving || !keyValue.trim()}
            >
              {saving ? 'Validating...' : 'Save & validate'}
            </button>
            <button
              className="api-key-btn api-key-btn--cancel"
              onClick={() => { setMode('view'); setKeyValue(''); setError(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="api-key-error">{error}</p>}
      {success && <p className="api-key-success">Key saved and validated successfully.</p>}
    </div>
  );
}

function BudgetSection({ monthlyBudgetUsd, onSave }: { monthlyBudgetUsd: number | null; onSave: (v: number | null) => Promise<void> }) {
  const [inputValue, setInputValue] = useState(monthlyBudgetUsd != null ? String(monthlyBudgetUsd) : '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      const parsed = inputValue.trim() === '' ? null : parseFloat(inputValue.trim());
      if (parsed !== null && (isNaN(parsed) || parsed <= 0)) {
        setStatus({ type: 'error', message: 'Enter a positive number or leave blank to remove the budget.' });
        return;
      }
      await onSave(parsed);
      setStatus({ type: 'success', message: 'Budget saved.' });
      setTimeout(() => setStatus(null), 2500);
    } catch (err) {
      setStatus({ type: 'error', message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section pixel-border">
      <h2 className="settings-section__title">Monthly Budget</h2>
      <p className="settings-info">
        Set a soft monthly spending cap in USD. You&apos;ll receive a one-time in-chat warning when you cross it.
      </p>
      <div className="settings-field">
        <label className="settings-label" htmlFor="budget-input">Budget (USD, blank to disable)</label>
        <input
          id="budget-input"
          type="number"
          min="0.01"
          step="0.01"
          className="api-key-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="e.g. 10.00"
          style={{ width: 140 }}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {status && (
        <p className={status.type === 'success' ? 'api-key-success' : 'api-key-error'} style={{ marginTop: 8 }}>
          {status.message}
        </p>
      )}
    </section>
  );
}

interface ModelAssignmentsSectionProps {
  availableProviders: { id: string; displayName: string; models: { id: string; displayName: string }[] }[];
  isLoading: boolean;
  primaryProvider: string | null;
  primaryModel: string | null;
  chatModel: RoleModel | null;
  wikiMaintenanceModel: RoleModel | null;
  factExtractionModel: RoleModel | null;
  setChatModel: (v: RoleModel | null) => void;
  setWikiMaintenanceModel: (v: RoleModel | null) => void;
  setFactExtractionModel: (v: RoleModel | null) => void;
}

function RoleModelRow({
  label,
  value,
  primaryProvider,
  primaryModel,
  availableProviders,
  isLoading,
  onChange,
}: {
  label: string;
  value: RoleModel | null;
  primaryProvider: string | null;
  primaryModel: string | null;
  availableProviders: { id: string; displayName: string; models: { id: string; displayName: string }[] }[];
  isLoading: boolean;
  onChange: (v: RoleModel | null) => void;
}) {
  const usePrimary = value === null;

  function handleCheckboxChange(checked: boolean) {
    if (checked) {
      onChange(null);
    } else {
      onChange({ provider: primaryProvider ?? 'openai', model: primaryModel ?? '' });
    }
  }

  function handleProviderChange(p: string) {
    const info = availableProviders.find(ap => ap.id === p);
    const firstModel = info?.models[0]?.id ?? '';
    onChange({ provider: p, model: firstModel });
  }

  function handleModelChange(m: string) {
    onChange({ provider: value?.provider ?? primaryProvider ?? 'openai', model: m });
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={usePrimary}
          onChange={e => handleCheckboxChange(e.target.checked)}
        />
        <span className="settings-label" style={{ margin: 0 }}>Use primary model for {label}</span>
      </label>
      {!usePrimary && (
        <div style={{ marginLeft: 24 }}>
          <ProviderModelSelect
            provider={value?.provider ?? null}
            model={value?.model ?? null}
            availableProviders={availableProviders}
            isLoading={isLoading}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
            layout="stacked"
          />
        </div>
      )}
    </div>
  );
}

function ModelAssignmentsSection({
  availableProviders,
  isLoading,
  primaryProvider,
  primaryModel,
  chatModel,
  wikiMaintenanceModel,
  factExtractionModel,
  setChatModel,
  setWikiMaintenanceModel,
  setFactExtractionModel,
}: ModelAssignmentsSectionProps) {
  function handleChange(setter: (v: RoleModel | null) => void) {
    return (v: RoleModel | null) => {
      setter(v);
      triggerToast('Settings saved.', 'success');
    };
  }

  return (
    <section className="settings-section pixel-border">
      <h2 className="settings-section__title">Model assignments</h2>
      <p className="settings-info">
        Use your primary model for everything, or assign a different model to specific roles.
      </p>
      <RoleModelRow
        label="chat"
        value={chatModel}
        primaryProvider={primaryProvider}
        primaryModel={primaryModel}
        availableProviders={availableProviders}
        isLoading={isLoading}
        onChange={handleChange(setChatModel)}
      />
      <RoleModelRow
        label="wiki maintenance"
        value={wikiMaintenanceModel}
        primaryProvider={primaryProvider}
        primaryModel={primaryModel}
        availableProviders={availableProviders}
        isLoading={isLoading}
        onChange={handleChange(setWikiMaintenanceModel)}
      />
      <RoleModelRow
        label="fact extraction"
        value={factExtractionModel}
        primaryProvider={primaryProvider}
        primaryModel={primaryModel}
        availableProviders={availableProviders}
        isLoading={isLoading}
        onChange={handleChange(setFactExtractionModel)}
      />
    </section>
  );
}

interface TokenRecord {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}yr ago`;
}

function PersonalAccessTokensSection() {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<{ id: string; rawToken: string } | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);

  async function loadTokens() {
    try {
      const res = await fetch('/api/settings/tokens');
      if (!res.ok) return;
      setTokens((await res.json()) as TokenRecord[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTokens(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/settings/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        triggerToast(err.error?.message ?? 'Failed to create token', 'error');
        return;
      }
      const data = (await res.json()) as TokenRecord & { rawToken: string };
      setNewToken({ id: data.id, rawToken: data.rawToken });
      setNewName('');
      await loadTokens();
      triggerToast('Token created.', 'success');
    } catch (err) {
      triggerToast((err as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      const res = await fetch(`/api/settings/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        triggerToast('Failed to revoke token', 'error');
        return;
      }
      setTokens(prev => prev.filter(t => t.id !== id));
      if (newToken?.id === id) setNewToken(null);
      triggerToast('Token revoked.', 'success');
    } catch (err) {
      triggerToast((err as Error).message, 'error');
    } finally {
      setRevokeConfirmId(null);
    }
  }

  function handleCopy(text: string) {
    void navigator.clipboard.writeText(text).then(() => triggerToast('Copied.', 'success'));
  }

  return (
    <section className="settings-section pixel-border">
      <h2 className="settings-section__title">Personal access tokens</h2>
      <p className="settings-info">
        Long-lived tokens for using Sage from a CLI, mobile app, or always-on agent. Tokens are shown once at creation.
      </p>

      {loading ? (
        <p className="settings-info">Loading...</p>
      ) : (
        <div style={{ marginBottom: 16 }}>
          {tokens.length === 0 && <p className="settings-info u-muted">No active tokens.</p>}
          {tokens.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>
                  created {formatRelative(t.createdAt)} · last used {formatRelative(t.lastUsedAt)}
                </span>
              </div>
              <button
                className="api-key-btn api-key-btn--delete"
                onClick={() => setRevokeConfirmId(t.id)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {newToken && (
        <div style={{ marginBottom: 16, padding: 12, background: 'rgba(255,200,0,0.07)', borderRadius: 4, border: '1px solid rgba(255,200,0,0.2)' }}>
          <p style={{ fontSize: 12, marginBottom: 8, color: 'var(--color-warn, #f0b429)' }}>
            This is the only time you will see this token. Store it securely.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              readOnly
              value={newToken.rawToken}
              className="api-key-input"
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
            />
            <button className="btn btn--sm" onClick={() => handleCopy(newToken.rawToken)}>Copy</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label className="settings-label" htmlFor="pat-name">Token name</label>
          <input
            id="pat-name"
            className="api-key-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="e.g. My CLI"
            maxLength={100}
            onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
          />
        </div>
        <button
          className="btn btn--primary"
          onClick={() => void handleCreate()}
          disabled={creating || !newName.trim()}
        >
          {creating ? 'Creating...' : 'Create token'}
        </button>
      </div>

      <ConfirmModal
        isOpen={revokeConfirmId !== null}
        title="Revoke token"
        message="This token will stop working immediately. This cannot be undone."
        confirmLabel="Revoke"
        danger
        onConfirm={() => { if (revokeConfirmId) void handleRevoke(revokeConfirmId); }}
        onCancel={() => setRevokeConfirmId(null)}
      />
    </section>
  );
}

export default function Settings() {
  const {
    provider,
    model,
    availableProviders,
    credentials,
    isLoading,
    loadSettings,
    loadProviders,
    updateProvider,
    updateModel,
    saveCredential,
    deleteCredential,
    monthlyBudgetUsd,
    saveBudget,
    chatModel,
    wikiMaintenanceModel,
    factExtractionModel,
    setChatModel,
    setWikiMaintenanceModel,
    setFactExtractionModel,
  } = useSettingsStore();

  useEffect(() => {
    loadSettings();
    loadProviders();
  }, [loadSettings, loadProviders]);

  function handleProviderChange(value: string) {
    updateProvider(value);
    triggerToast('Settings saved.', 'success');
  }

  function handleModelChange(value: string) {
    updateModel(value);
    triggerToast('Settings saved.', 'success');
  }

  async function handleCredentialSave(key: string, onSave: (key: string) => Promise<void>) {
    try {
      await onSave(key);
      triggerToast('API key saved and validated.', 'success');
    } catch (err) {
      triggerToast((err as Error).message, 'error');
      throw err;
    }
  }

  async function handleCredentialDelete(onDelete: () => Promise<void>) {
    try {
      await onDelete();
      triggerToast('API key removed.', 'success');
    } catch (err) {
      triggerToast((err as Error).message, 'error');
      throw err;
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/chat" className="btn btn--sm">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginRight: 4 }}>
            <path d="M8 5H2M2 5L5 2M2 5L5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </Link>
      </header>
      <h1 className="settings-title">Settings</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { to: '/import', title: 'Import Conversations', desc: 'Bring in chats from ChatGPT or Claude.ai' },
          { to: '/memory', title: 'Memory', desc: 'View and edit what Sage remembers about you' },
          { to: '/usage', title: 'Usage', desc: 'Daily spend, provider breakdown, CSV export' },
        ].map(({ to, title, desc }) => (
          <Link
            key={to}
            to={to}
            style={{
              flex: '1 1 180px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '12px 16px',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 4,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{desc}</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 2l5 5-5 5"/>
            </svg>
          </Link>
        ))}
      </div>

      <section className="settings-section pixel-border">
        <h2 className="settings-section__title">Provider</h2>
        <ProviderModelSelect
          provider={provider}
          model={model}
          availableProviders={availableProviders}
          isLoading={isLoading}
          onProviderChange={handleProviderChange}
          onModelChange={handleModelChange}
          layout="stacked"
        />
      </section>

      <ModelAssignmentsSection
        availableProviders={availableProviders}
        isLoading={isLoading}
        primaryProvider={provider}
        primaryModel={model}
        chatModel={chatModel}
        wikiMaintenanceModel={wikiMaintenanceModel}
        factExtractionModel={factExtractionModel}
        setChatModel={setChatModel}
        setWikiMaintenanceModel={setWikiMaintenanceModel}
        setFactExtractionModel={setFactExtractionModel}
      />

      <section className="settings-section pixel-border">
        <h2 className="settings-section__title">API Keys</h2>
        <p className="settings-info">
          Keys are encrypted with AES-256-GCM before storage. They never leave your server unencrypted.
        </p>

        <div className="api-keys-list">
          {(['openai', 'minimax', 'anthropic'] as ProviderId[]).map((pid) => {
            const providerInfo = availableProviders.find((p) => p.id === pid);
            const credInfo = credentials[pid];
            return (
              <CredentialSection
                key={pid}
                providerId={pid}
                displayName={providerInfo?.displayName ?? pid}
                hasKey={credInfo?.hasKey ?? false}
                onSave={(key) => handleCredentialSave(key, () => saveCredential(pid, key))}
                onDelete={() => handleCredentialDelete(() => deleteCredential(pid))}
              />
            );
          })}
        </div>
      </section>

      <PersonalAccessTokensSection />

      <CollapsibleSection title="Agent Instructions (AGENTS.md)">
        <AgentInstructionsContent />
      </CollapsibleSection>

      <BudgetSection monthlyBudgetUsd={monthlyBudgetUsd} onSave={saveBudget} />

      <DangerZone />
    </div>
  );
}
