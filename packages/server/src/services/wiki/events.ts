export type WikiEvent =
  | { kind: 'page_created'; userId: string; pageId: string; path: string; summary?: string }
  | { kind: 'page_updated'; userId: string; pageId: string; path: string; summary?: string }
  | { kind: 'page_deleted'; userId: string; pageId: string; path: string; summary?: string }
  | { kind: 'link_added'; userId: string; pageId: string; path: string; targetPath: string }
  | { kind: 'link_removed'; userId: string; pageId: string; path: string; targetPath: string }
  | { kind: 'rename'; userId: string; pageId: string; path: string; oldPath: string };

type WikiSubscriber = (event: WikiEvent) => void;

const subscribers: WikiSubscriber[] = [];

export function subscribe(fn: WikiSubscriber): () => void {
  subscribers.push(fn);
  return () => {
    const idx = subscribers.indexOf(fn);
    if (idx !== -1) subscribers.splice(idx, 1);
  };
}

export function emit(event: WikiEvent): void {
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch (err) {
      console.error('[wiki-events] subscriber threw:', err);
    }
  }
}
