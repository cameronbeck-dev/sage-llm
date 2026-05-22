export type WhisperAction =
  | { kind: 'add_to_pack'; packId: string; chunkId: string; label: string; consumedAt?: string }
  | { kind: 'create_pack'; suggestedName: string; suggestedDescription: string; orphanIds: string[]; label: string; consumedAt?: string }
  | { kind: 'always_extract_to_pack'; packId: string; label: string; consumedAt?: string }
  | { kind: 'undo_extraction'; chunkId: string; label: string; consumedAt?: string }
  | { kind: 'undo_memory'; entryId: string; label: string; consumedAt?: string }
  | { kind: 'undo_orphan'; orphanId: string; label: string; consumedAt?: string }
  | { kind: 'dismiss'; label: string; consumedAt?: string };
