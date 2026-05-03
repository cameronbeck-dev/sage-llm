import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { listProviders, getProvider } from '../providers/registry.js';
import { getUserSettings } from '../services/settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from '../services/credentials.js';

export const providersRouter = Router();

providersRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const settings = await getUserSettings(req.session!.userId!);
    const userId = req.session!.userId!;

    const providers = await Promise.all(
      listProviders().map(async (p) => {
        let models: { id: string; displayName: string }[] = [];
        let hasKey = false;
        let keyError: string | null = null;

        try {
          const apiKey = await getDecryptedCredential(userId, p.id);
          hasKey = true;
          const creds = { apiKey };
          models = await p.listModels(creds);
        } catch (err) {
          if (err instanceof CredentialNotFoundError) {
            hasKey = false;
            keyError = null;
          } else {
            hasKey = false;
            keyError = (err as Error).message;
          }
        }

        return {
          id: p.id,
          displayName: p.displayName,
          models,
          isActive: p.id === settings.activeProvider,
          hasKey,
          keyError,
        };
      })
    );

    res.json(providers);
  } catch (err) {
    next(err);
  }
});

providersRouter.post('/:provider/models', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.userId!;
    const providerId = req.params.provider;

    let apiKey: string;
    try {
      apiKey = await getDecryptedCredential(userId, providerId);
    } catch (err) {
      if (err instanceof CredentialNotFoundError) {
        res.status(401).json({ error: { code: 'NO_CREDENTIAL', message: `No API key for ${providerId}` } });
        return;
      }
      next(err);
      return;
    }

    const provider = getProvider(providerId);
    const models = await provider.listModels({ apiKey });
    res.json(models);
  } catch (err) {
    next(err);
  }
});