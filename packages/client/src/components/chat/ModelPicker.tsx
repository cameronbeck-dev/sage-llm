import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../../state/settingsStore.js';
import { useConversationStore } from '../../state/conversationStore.js';
import ProviderModelSelect from './ProviderModelSelect.js';

interface Props {
  conversationId: string;
}

export default function ModelPicker({ conversationId: _conversationId }: Props) {
  const { provider: defaultProvider, model: defaultModel, availableProviders, isLoading } = useSettingsStore();
  const { activeConversation, setPreferredModel } = useConversationStore();

  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const effectiveProvider = activeConversation?.preferredProvider ?? defaultProvider;
  const effectiveModel = activeConversation?.preferredModel ?? defaultModel;

  const currentProvider = availableProviders.find((p) => p.id === effectiveProvider);
  const currentModelInfo = currentProvider?.models.find((m) => m.id === effectiveModel);
  const displayName = currentModelInfo?.displayName ?? effectiveModel ?? '';

  const pickerLoading = isLoading || activeConversation === null || defaultProvider === null;

  function handleProviderChange(provider: string) {
    const providerInfo = availableProviders.find((p) => p.id === provider);
    const firstModel = providerInfo?.models[0]?.id ?? effectiveModel ?? '';
    if (firstModel) {
      setPreferredModel(provider, firstModel);
    }
  }

  function handleModelChange(model: string) {
    if (effectiveProvider) {
      setPreferredModel(effectiveProvider, model);
    }
  }

  useEffect(() => {
    if (!isOpen) return;

    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="model-picker" ref={wrapperRef}>
      <button
        className="model-pill"
        type="button"
        disabled={pickerLoading}
        onClick={() => setIsOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={displayName}
      >
        <span className="model-pill__label">
          {pickerLoading ? 'Loading…' : displayName}
        </span>
        <span className="model-pill__caret" aria-hidden="true">▾</span>
      </button>
      {isOpen && (
        <div className="model-picker-popover" role="dialog" aria-label="Select model">
          <ProviderModelSelect
            provider={effectiveProvider}
            model={effectiveModel}
            availableProviders={availableProviders}
            isLoading={pickerLoading}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
            layout="inline"
          />
        </div>
      )}
    </div>
  );
}
