import { useCallback, useRef } from 'react';

export type ToastVariant = 'success' | 'error';

interface ToastEntry {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface UseToastReturn {
  toasts: ToastEntry[];
  trigger: (message: string, variant?: ToastVariant) => string;
  dismiss: (id: string) => void;
}

export function useToast(): UseToastReturn {
  const toastsRef = useRef<ToastEntry[]>([]);

  const trigger = useCallback((message: string, variant: ToastVariant = 'success'): string => {
    const id = crypto.randomUUID();
    toastsRef.current = [...toastsRef.current, { id, message, variant }];
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    toastsRef.current = toastsRef.current.filter((t) => t.id !== id);
  }, []);

  // We spread to a new array so consumers get fresh references
  const toasts = [...toastsRef.current];

  return { toasts, trigger, dismiss };
}
