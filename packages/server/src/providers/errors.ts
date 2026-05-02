// Phase 1: Normalized provider errors
export class AuthError extends Error {
  constructor(provider: string) {
    super(`Authentication failed for provider: ${provider}`);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends Error {
  retryAfter?: number;
  constructor(provider: string, retryAfter?: number) {
    super(`Rate limit exceeded for provider: ${provider}`);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class ProviderError extends Error {
  retryable: boolean;
  constructor(provider: string, message: string, retryable = false) {
    super(`Provider error (${provider}): ${message}`);
    this.name = 'ProviderError';
    this.retryable = retryable;
  }
}
