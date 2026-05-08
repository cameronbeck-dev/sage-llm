export * from './message.js';
export * from './conversation.js';
export * from './provider.js';
export * from './agent.js';
export * from './user.js';
export * from './usage.js';

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
