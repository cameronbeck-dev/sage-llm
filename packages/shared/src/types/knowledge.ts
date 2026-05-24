export interface KnowledgePack {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeFile {
  id: string;
  packId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceKind: 'upload' | 'chat_extracted';
  status: 'pending' | 'parsing' | 'ready' | 'failed';
  errorMsg: string | null;
  r2Key: string | null;
  fileHash: string | null;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: string;
  packId: string;
  fileId: string;
  sourceFilename: string;
  body: string;
  createdAt: string;
}
