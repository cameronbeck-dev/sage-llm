import { create } from 'zustand';

export interface AuthUser {
  id: string;
  login: string;
  avatarUrl?: string;
  email?: string;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  fetchMe: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,

  async fetchMe() {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/me');
      if (res.status === 401) {
        set({ user: null, isLoading: false });
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch user');
      const data = (await res.json()) as { user: AuthUser };
      set({ user: data.user, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    set({ user: null });
    window.location.href = '/login';
  },
}));
