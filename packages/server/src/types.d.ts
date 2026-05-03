import type { SessionData } from './auth/session.js';

declare global {
  namespace CookieSessionInterfaces {
    interface CookieSessionObject extends SessionData {}
  }
}
