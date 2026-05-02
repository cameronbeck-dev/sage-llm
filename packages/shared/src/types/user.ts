export interface User {
  id: string;
  githubId: string;
  login: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface UserSettings {
  userId: string;
  provider: string;
  model: string;
  updatedAt: string;
}
