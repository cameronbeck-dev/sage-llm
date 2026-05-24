export * from './message.js';
export * from './conversation.js';
export * from './provider.js';
export * from './agent.js';
export * from './user.js';
export * from './usage.js';
export * from './knowledge.js';
export * from './whisper.js';
export * from './sse.js';

// Memory system types
export interface MemoryDoc {
  id: string;
  userId: string;
  filename: string; // 'AGENTS.md' | 'MEMORY.md' | 'SUMMARIES.json'
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SummaryEntry {
  id: string;
  conversationId: string;
  conversationTitle: string;
  timestamp: string;
  summary: string;
  lastMessageAt?: string;
}

export interface MemoryDelta {
  action: 'update' | 'append' | 'none';
  filename: string;
  content?: string;
  summary?: string;
}

export interface MemoryEntry {
  id: string;
  userId: string;
  key: string;
  body: string;
  type: 'user' | 'feedback' | 'project' | 'reference' | 'other';
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MemoryEntryVersion {
  id: string;
  entryId: string;
  entryKey?: string;
  body: string | null;
  changeSummary: string | null;
  triggeredBy: 'user' | 'llm' | 'migration';
  createdAt: string;
}

export interface SummaryEntryRow {
  id: string;
  userId: string;
  conversationId: string | null;
  conversationTitle: string;
  summary: string;
  lastMessageAt: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export type MemoryOp =
  | { op: 'add'; key: string; body: string; type?: MemoryEntry['type']; summary: string }
  | { op: 'update'; entryId: string; body: string; summary: string }
  | { op: 'forget'; entryId: string; summary: string };

export interface ExtractionIndicator {
  id: string;
  label: string;
}

export interface ExtractionProgressChunk {
  type: 'extraction_progress';
  stage: 'started' | 'destinations_known' | 'destination_complete' | 'finished';
  label?: string;
  indicators?: ExtractionIndicator[];
  completedId?: string;
}
