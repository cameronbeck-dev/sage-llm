export type WhisperAction =
  | { kind: 'add_to_pack'; packId: string; chunkId: string; label: string; consumedAt?: string }
  | { kind: 'create_pack'; suggestedName: string; suggestedDescription: string; orphanIds: string[]; label: string; consumedAt?: string }
  | { kind: 'always_extract_to_pack'; packId: string; label: string; consumedAt?: string }
  | { kind: 'undo_extraction'; chunkId: string; label: string; consumedAt?: string }
  | { kind: 'undo_memory'; entryId: string; label: string; consumedAt?: string }
  | { kind: 'undo_orphan'; orphanId: string; label: string; consumedAt?: string }
  | { kind: 'dismiss'; label: string; consumedAt?: string }
  | { kind: 'view_entry'; label: string; target: { type: 'memory'; entryId: string } | { type: 'chunk'; packId: string; chunkId: string }; consumedAt?: string }
  | { kind: 'view_wiki_page'; label: string; path: string; versionId?: string; consumedAt?: string }
  | { kind: 'undo_wiki_edit'; label: string; path: string; versionId: string; consumedAt?: string }
  | { kind: 'wiki_page_created'; label: string; path: string; title: string; consumedAt?: string }
  | { kind: 'wiki_page_updated'; label: string; path: string; summary?: string; consumedAt?: string }
  | { kind: 'wiki_page_deleted'; label: string; path: string; consumedAt?: string }
  | { kind: 'wiki_link_added'; label: string; source: string; target: string; consumedAt?: string }
  | { kind: 'view_fact'; label: string; factId: string; consumedAt?: string }
  | { kind: 'undo_fact'; label: string; factId: string; consumedAt?: string }
  | { kind: 'review_deferred_ops'; label: string; count: number; consumedAt?: string };
