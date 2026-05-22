export interface AttachedPack {
  packId: string;
  autoExtract: boolean;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  importId?: string | null;
  attachedPackIds?: string[];
  attachedPacks?: AttachedPack[];
  seedFromPackId?: string;
}
