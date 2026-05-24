export type FactEvent =
  | { kind: 'fact_added'; userId: string; factId: string; text: string }
  | { kind: 'fact_updated'; userId: string; factId: string }
  | { kind: 'fact_deleted'; userId: string; factId: string };

type FactSubscriber = (event: FactEvent) => void;

const subscribers: FactSubscriber[] = [];

export function subscribe(fn: FactSubscriber): () => void {
  subscribers.push(fn);
  return () => {
    const idx = subscribers.indexOf(fn);
    if (idx !== -1) subscribers.splice(idx, 1);
  };
}

export function emit(event: FactEvent): void {
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch (err) {
      console.error('[fact-events] subscriber threw:', err);
    }
  }
}
