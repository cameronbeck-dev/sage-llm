export interface AgentFile {
  id: string;
  userId: string;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryFile {
  id: string;
  userId: string;
  name: string;
  content: string;
  enabled: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}
