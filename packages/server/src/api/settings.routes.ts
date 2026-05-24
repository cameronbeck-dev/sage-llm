import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getUserSettings, updateUserSettings } from '../services/settings.js';
import type { RoleModel } from '../services/settings.js';
import {
  storeCredential,
  deleteCredential,
  listCredentials,
  CredentialValidationError,
  CredentialNotFoundError,
} from '../services/credentials.js';
import { issueToken, listTokens, revokeToken } from '../services/auth/tokens.js';
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


// PUT /settings — update user settings (provider, model, theme, role models)
settingsRouter.put('/', requireAuth, mutationLimiter, async (req, res, next) => {
  try {
    const { activeProvider, activeModel, theme, chatModel, wikiMaintenanceModel, factExtractionModel } = req.body as {
      activeProvider?: string;
      activeModel?: string;
      theme?: string;
      chatModel?: RoleModel | null;
      wikiMaintenanceModel?: RoleModel | null;
      factExtractionModel?: RoleModel | null;
    };

    function validateRoleModel(rm: unknown, fieldName: string): RoleModel | null | undefined {
      if (rm === undefined) return undefined;
      if (rm === null) return null;
      if (typeof rm !== 'object' || typeof (rm as RoleModel).provider !== 'string' || !(rm as RoleModel).provider
        || typeof (rm as RoleModel).model !== 'string' || !(rm as RoleModel).model) {
        throw Object.assign(new Error(`${fieldName} must be null or {provider, model} with non-empty strings`), { status: 400 });
      }
      return rm as RoleModel;
    }

    const validatedChatModel = validateRoleModel(chatModel, 'chatModel');
    const validatedWikiModel = validateRoleModel(wikiMaintenanceModel, 'wikiMaintenanceModel');
    const validatedFactModel = validateRoleModel(factExtractionModel, 'factExtractionModel');

    await updateUserSettings(req.session!.userId!, {
      activeProvider,
      activeModel,
      theme,
      ...(validatedChatModel !== undefined ? { chatModel: validatedChatModel } : {}),
      ...(validatedWikiModel !== undefined ? { wikiMaintenanceModel: validatedWikiModel } : {}),
      ...(validatedFactModel !== undefined ? { factExtractionModel: validatedFactModel } : {}),
    });
    const settings = await getUserSettings(req.session!.userId!);
    const { monthlyBudgetCents, budgetWarnedPeriod: _budgetWarnedPeriod, ...rest } = settings;
    res.json({
      ...rest,
      monthlyBudgetUsd: monthlyBudgetCents != null ? monthlyBudgetCents / 100 : null,
    });
  } catch (err) {
    if (err instanceof Error && 'status' in err && (err as Error & { status: number }).status === 400) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: err.message } });
      return;
    }
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

// GET /settings/tokens — list active personal access tokens (no hashes)
settingsRouter.get('/tokens', requireAuth, async (req, res, next) => {
  try {
    const tokens = await listTokens(req.session!.userId!);
    res.json(tokens);
  } catch (err) {
    next(err);
  }
});

// POST /settings/tokens — create a new personal access token (raw shown once)
settingsRouter.post('/tokens', requireAuth, mutationLimiter, async (req, res, next) => {
  try {
    const { name } = req.body as { name?: unknown };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'name is required' } });
      return;
    }
    if (name.trim().length > 100) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'name must be 100 characters or fewer' } });
      return;
    }
    const { id, rawToken, createdAt } = await issueToken(req.session!.userId!, name.trim());
    res.json({ id, name: name.trim(), rawToken, createdAt });
  } catch (err) {
    next(err);
  }
});

// DELETE /settings/tokens/:id — revoke a personal access token
settingsRouter.delete('/tokens/:id', requireAuth, mutationLimiter, async (req, res, next) => {
  try {
    const { id } = req.params;
    const revoked = await revokeToken(req.session!.userId!, id);
    if (!revoked) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found or already revoked' } });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});