interface ConfirmInlineProps {
  prompt: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export default function ConfirmInline({ prompt, onConfirm, onCancel, confirmLabel = 'Yes', cancelLabel = 'Cancel' }: ConfirmInlineProps) {
  return (
    <div className="confirm-inline">
      <span className="settings-info">{prompt}</span>
      <button className="btn btn--sm btn--danger-outline" onClick={onConfirm}>{confirmLabel}</button>
      <button className="btn btn--sm" onClick={onCancel}>{cancelLabel}</button>
    </div>
  );
}
