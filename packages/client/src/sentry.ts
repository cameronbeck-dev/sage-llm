/// <reference types="vite/client" />

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  import('@sentry/react').then(({ init }) => {
    init({ dsn });
  });
}
