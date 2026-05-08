import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getUserSettings, updateUserSettings } from '../services/settings.js';
import {
  storeCredential,
  deleteCredential,
  listCredentials,
  CredentialValidationError,
  CredentialNotFoundError,
} from '../services/credentials.js';
import { mutationLimiter } from '../middleware/rateLimit.js';

export const settingsRouter = Router();

// GET /settings — return user settings
settingsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const settings = await getUserSettings(req.session!.userId!);
    const creds = await listCredentials(req.session!.userId!);
    const { monthlyBudgetCents, budgetWarnedPeriod: _budgetWarnedPeriod, ...rest } = settings;
    res.json({
      ...rest,
      monthlyBudgetUsd: monthlyBudgetCents != null ? monthlyBudgetCents / 100 : null,
      credentials: creds,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /settings — update user settings (provider, model, theme)
settingsRouter.put('/', requireAuth, mutationLimiter, async (req, res, next) => {
  try {
    const { activeProvider, activeModel, theme } = req.body as {
      activeProvider?: string;
      activeModel?: string;
      theme?: string;
    };
    await updateUserSettings(req.session!.userId!, { activeProvider, activeModel, theme });
    const settings = await getUserSettings(req.session!.userId!);
    const { monthlyBudgetCents, budgetWarnedPeriod: _budgetWarnedPeriod, ...rest } = settings;
    res.json({
      ...rest,
      monthlyBudgetUsd: monthlyBudgetCents != null ? monthlyBudgetCents / 100 : null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /settings/budget — set monthly budget
settingsRouter.put('/budget', requireAuth, mutationLimiter, async (req, res, next) => {
  try {
    const { monthlyBudgetUsd } = req.body as { monthlyBudgetUsd?: number | null };
    if (monthlyBudgetUsd !== null && monthlyBudgetUsd !== undefined) {
      if (typeof monthlyBudgetUsd !== 'number' || !isFinite(monthlyBudgetUsd) || monthlyBudgetUsd <= 0) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'monthlyBudgetUsd must be null or a finite number > 0' } });
        return;
      }
    }
    const monthlyBudgetCents = monthlyBudgetUsd != null ? Math.round(monthlyBudgetUsd * 100) : null;
    await updateUserSettings(req.session!.userId!, { monthlyBudgetCents });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /settings/credentials/:provider — store or update encrypted API key
settingsRouter.put('/credentials/:provider', requireAuth, mutationLimiter, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { apiKey } = req.body as { apiKey?: string };

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'apiKey is required' } });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress;
    const ua = req.get('user-agent') ?? undefined;

    await storeCredential(req.session!.userId!, provider, apiKey, ip, ua);

    const creds = await listCredentials(req.session!.userId!);
    res.json({ ok: true, credentials: creds });
  } catch (err) {
    if (err instanceof CredentialValidationError) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: err.message } });
      return;
    }
    next(err);
  }
});

// GET /settings/credentials/:provider — check if a key is stored (no secret returned)
settingsRouter.get('/credentials/:provider', requireAuth, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const creds = await listCredentials(req.session!.userId!);
    const info = creds[provider];
    res.json({ hasKey: info?.hasKey ?? false, updatedAt: info?.updatedAt ?? null });
  } catch (err) {
    next(err);
  }
});

// DELETE /settings/credentials/:provider — remove stored credential
settingsRouter.delete('/credentials/:provider', requireAuth, mutationLimiter, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const ip = req.ip ?? req.socket.remoteAddress;
    const ua = req.get('user-agent') ?? undefined;

    await deleteCredential(req.session!.userId!, provider, ip, ua);

    const creds = await listCredentials(req.session!.userId!);
    res.json({ ok: true, credentials: creds });
  } catch (err) {
    next(err);
  }
});