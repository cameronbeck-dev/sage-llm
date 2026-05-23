import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  confirmationText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  danger,
  confirmationText,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [inputVal, setInputVal] = useState('');

  useEffect(() => { if (!isOpen) setInputVal(''); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') {
        if (confirmationText && inputVal !== confirmationText) return;
        onConfirm();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel, onConfirm, confirmationText, inputVal]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">{title}</p>
        <p className="modal-message">{message}</p>
        {confirmationText && (
          <input
            className="settings-input"
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            placeholder={`Type ${confirmationText} to confirm`}
            autoFocus
          />
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className={danger ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={onConfirm}
            disabled={confirmationText ? inputVal !== confirmationText : false}
          >
            {confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
