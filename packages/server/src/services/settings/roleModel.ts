import { getUserSettings } from '../settings.js';
import { getDecryptedCredential } from '../credentials.js';
import { MissingCredentialsForRoleError } from './errors.js';

export type Role = 'chat' | 'wiki_maintenance' | 'fact_extraction';

export interface ResolvedRoleModel {
  provider: string;
  model: string;
  apiKey: string;
}

export async function resolveRoleModel(userId: string, role: Role): Promise<ResolvedRoleModel> {
  const settings = await getUserSettings(userId);

  let provider: string;
  let model: string;

  const roleModel =
    role === 'chat'
      ? settings.chatModel
      : role === 'wiki_maintenance'
      ? settings.wikiMaintenanceModel
      : settings.factExtractionModel;

  if (roleModel != null) {
    provider = roleModel.provider;
    model = roleModel.model;
  } else {
    provider = settings.activeProvider;
    model = settings.activeModel;
  }

  let apiKey: string;
  try {
    apiKey = await getDecryptedCredential(userId, provider);
  } catch {
    throw new MissingCredentialsForRoleError(role, provider);
  }

  return { provider, model, apiKey };
}
