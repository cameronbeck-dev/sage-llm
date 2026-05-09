export interface Conversation {
  id: string;
  userId: string;
  title: string;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  preferredProvider?: string | null;
  preferredModel?: string | null;
}
