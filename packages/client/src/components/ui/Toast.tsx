import { useEffect, useState } from 'react';
import './Toast.css';

export type ToastVariant = 'success' | 'error';

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  onDismiss: () => void;
}

export function Toast({ message, variant = 'success', duration = 2500, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div className={`toast toast--${variant} ${visible ? 'toast--visible' : 'toast--hidden'}`}>
      {message}
    </div>
  );
}
