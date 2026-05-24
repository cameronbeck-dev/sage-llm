export class MissingCredentialsForRoleError extends Error {
  constructor(public role: string, public provider: string) {
    super(`No credentials for provider '${provider}' (required for role '${role}')`);
    this.name = 'MissingCredentialsForRoleError';
  }
}
