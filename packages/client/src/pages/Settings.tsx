import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettingsStore } from '../state/settingsStore.js';
import { triggerToast } from '../components/ui/ToastContainer.js';

type ProviderId = 'openai' | 'minimax';

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

export default function Settings() {
  const {
    provider,
    model,
    availableProviders,
    credentials,
    loadSettings,
    loadProviders,
    updateProvider,
    updateModel,
    saveCredential,
    deleteCredential,
  } = useSettingsStore();

  useEffect(() => {
    loadSettings();
    loadProviders();
  }, [loadSettings, loadProviders]);

  const activeProvider = availableProviders.find((p) => p.id === provider);
  const models = activeProvider?.models ?? [];

  function handleProviderChange(e: React.ChangeEvent<HTMLSelectElement>) {
    updateProvider(e.target.value);
    triggerToast('Settings saved.', 'success');
  }

  function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    updateModel(e.target.value);
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

      <section className="settings-section pixel-border">
        <h2 className="settings-section__title">Provider</h2>
        <div className="settings-field">
          <label className="settings-label" htmlFor="provider-select">
            Active Provider
          </label>
          <select
            id="provider-select"
            className="settings-select"
            value={provider}
            onChange={handleProviderChange}
          >
            {availableProviders.length > 0 ? (
              availableProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))
            ) : (
              <option value="openai">OpenAI</option>
            )}
          </select>
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="model-select">
            Model
          </label>
          <select
            id="model-select"
            className="settings-select"
            value={model}
            onChange={handleModelChange}
          >
            {models.length > 0 ? (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))
            ) : (
              <option value={model}>{model}</option>
            )}
          </select>
        </div>
      </section>

      <section className="settings-section pixel-border">
        <h2 className="settings-section__title">API Keys</h2>
        <p className="settings-info">
          Keys are encrypted with AES-256-GCM before storage. They never leave your server unencrypted.
        </p>

        <div className="api-keys-list">
          {(['openai', 'minimax'] as ProviderId[]).map((pid) => {
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
    </div>
  );
}