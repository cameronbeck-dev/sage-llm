import { useEffect, useState } from 'react';
import { Toast } from './Toast.js';

interface ToastEntry {
  id: string;
  message: string;
  variant: 'success' | 'error';
}

const toasts: ToastEntry[] = [];
let listeners: ((toasts: ToastEntry[]) => void)[] = [];

function notify() {
  listeners.forEach((l) => l([...toasts]));
}

export function triggerToast(message: string, variant: 'success' | 'error' = 'success'): string {
  const id = crypto.randomUUID();
  toasts.push({ id, message, variant });
  notify();
  return id;
}

export function dismissToast(id: string) {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx !== -1) {
    toasts.splice(idx, 1);
    notify();
  }
}

export function ToastContainer() {
  const [snapshot, setSnapshot] = useState<ToastEntry[]>([]);

  useEffect(() => {
    listeners.push(setSnapshot);
    setSnapshot([...toasts]);
    return () => {
      listeners = listeners.filter((l) => l !== setSnapshot);
    };
  }, []);

  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      {snapshot.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          variant={t.variant}
          onDismiss={() => dismissToast(t.id)}
        />
      ))}
    </div>
  );
}
