import cookieSession from 'cookie-session';
import { config } from '../config.js';

export interface SessionData {
  userId?: string;
  github?: {
    id: number;
    login: string;
    avatar_url: string;
  };
}

export const sessionMiddleware = cookieSession({
  name: 'sage',
  secret: config.SESSION_SECRET,
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
