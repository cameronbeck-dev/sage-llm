import { useState } from 'react';
import type { Message, WhisperAction } from '@sage/shared';

interface WhisperActionsProps {
  message: Message;
  onUpdate: (updated: Message) => void;
}

export default function WhisperActions({ message, onUpdate }: WhisperActionsProps) {
  const actions = message.whisperActions;
  const [loading, setLoading] = useState<number | null>(null);

  if (!actions || actions.length === 0) return null;

  async function handleAction(index: number) {
    setLoading(index);
    try {
      const res = await fetch(`/api/whispers/${message.id}/actions/${index}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return;
      const updated = (await res.json()) as Message;
      onUpdate(updated);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="whisper-actions">
      <div className="whisper-actions__buttons">
        {actions.map((action: WhisperAction, i: number) => (
          <button
            key={i}
            className="whisper-actions__button"
            type="button"
            disabled={loading !== null || action.consumedAt != null}
            style={action.consumedAt != null ? { opacity: 0.4, cursor: 'default' } : undefined}
            onClick={() => handleAction(i)}
          >
            {loading === i ? '…' : action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
