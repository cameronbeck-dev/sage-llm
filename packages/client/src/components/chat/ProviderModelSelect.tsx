interface ProviderInfo {
  id: string;
  displayName: string;
  models: { id: string; displayName: string }[];
}

interface Props {
  provider: string | null;
  model: string | null;
  availableProviders: ProviderInfo[];
  isLoading: boolean;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  layout?: 'stacked' | 'inline';
}

export default function ProviderModelSelect({
  provider,
  model,
  availableProviders,
  isLoading,
  onProviderChange,
  onModelChange,
  layout = 'stacked',
}: Props) {
  const disabled = isLoading || provider === null || availableProviders.length === 0;
  const currentProvider = availableProviders.find((p) => p.id === provider);
  const models = currentProvider?.models ?? [];

  if (layout === 'inline') {
    return (
      <div className="provider-model-select provider-model-select--inline">
        <select
          className="provider-model-select__select"
          value={provider ?? ''}
          disabled={disabled}
          onChange={(e) => onProviderChange(e.target.value)}
          aria-label="Provider"
        >
          {disabled ? (
            <option value="">Loading…</option>
          ) : (
            availableProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))
          )}
        </select>
        <select
          className="provider-model-select__select"
          value={model ?? ''}
          disabled={disabled}
          onChange={(e) => onModelChange(e.target.value)}
          aria-label="Model"
        >
          {disabled ? (
            <option value="">Loading…</option>
          ) : (
            models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))
          )}
        </select>
      </div>
    );
  }

  return (
    <>
      <div className="settings-field">
        <label className="settings-label" htmlFor="provider-select">
          Active Provider
        </label>
        <select
          id="provider-select"
          className="settings-select"
          value={provider ?? ''}
          disabled={disabled}
          onChange={(e) => onProviderChange(e.target.value)}
        >
          {disabled ? (
            <option value="">Loading…</option>
          ) : (
            availableProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))
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
          value={model ?? ''}
          disabled={disabled}
          onChange={(e) => onModelChange(e.target.value)}
        >
          {disabled ? (
            <option value="">Loading…</option>
          ) : (
            models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))
          )}
        </select>
      </div>
    </>
  );
}
