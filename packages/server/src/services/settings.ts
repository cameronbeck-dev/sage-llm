import { getPool } from '../db/pool.js';

export interface RoleModel {
  provider: string;
  model: string;
}

export interface UserSettings {
  userId: string;
  activeProvider: string;
  activeModel: string;
  theme: string;
  monthlyBudgetCents: number | null;
  budgetWarnedPeriod: string | null;
  chatModel: RoleModel | null;
  wikiMaintenanceModel: RoleModel | null;
  factExtractionModel: RoleModel | null;
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM user_settings WHERE user_id = $1',
    [userId]
  );
  if (rows.length === 0) {
    await pool.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    return { userId, activeProvider: 'openai', activeModel: 'gpt-4o-mini', theme: 'forest', monthlyBudgetCents: null, budgetWarnedPeriod: null, chatModel: null, wikiMaintenanceModel: null, factExtractionModel: null };
  }
  const row = rows[0];
  return {
    userId: row.user_id as string,
    activeProvider: row.active_provider as string,
    activeModel: row.active_model as string,
    theme: row.theme as string,
    monthlyBudgetCents: row.monthly_budget_cents != null ? Number(row.monthly_budget_cents) : null,
    budgetWarnedPeriod: row.budget_warned_period != null ? (row.budget_warned_period as string) : null,
    chatModel: row.chat_model != null ? (row.chat_model as RoleModel) : null,
    wikiMaintenanceModel: row.wiki_maintenance_model != null ? (row.wiki_maintenance_model as RoleModel) : null,
    factExtractionModel: row.fact_extraction_model != null ? (row.fact_extraction_model as RoleModel) : null,
  };
}

export async function updateUserSettings(
  userId: string,
  updates: {
    activeProvider?: string;
    activeModel?: string;
    theme?: string;
    monthlyBudgetCents?: number | null;
    budgetWarnedPeriod?: string | null;
    chatModel?: RoleModel | null;
    wikiMaintenanceModel?: RoleModel | null;
    factExtractionModel?: RoleModel | null;
  }
): Promise<void> {
  const pool = getPool();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.activeProvider !== undefined) {
    fields.push(`active_provider = $${idx++}`);
    values.push(updates.activeProvider);
  }
  if (updates.activeModel !== undefined) {
    fields.push(`active_model = $${idx++}`);
    values.push(updates.activeModel);
  }
  if (updates.theme !== undefined) {
    fields.push(`theme = $${idx++}`);
    values.push(updates.theme);
  }
  if (updates.monthlyBudgetCents !== undefined) {
    fields.push(`monthly_budget_cents = $${idx++}`);
    values.push(updates.monthlyBudgetCents);
  }
  if (updates.budgetWarnedPeriod !== undefined) {
    fields.push(`budget_warned_period = $${idx++}`);
    values.push(updates.budgetWarnedPeriod);
  }
  if (updates.chatModel !== undefined) {
    fields.push(`chat_model = $${idx}::jsonb`);
    values.push(updates.chatModel === null ? null : JSON.stringify(updates.chatModel));
    idx++;
  }
  if (updates.wikiMaintenanceModel !== undefined) {
    fields.push(`wiki_maintenance_model = $${idx}::jsonb`);
    values.push(updates.wikiMaintenanceModel === null ? null : JSON.stringify(updates.wikiMaintenanceModel));
    idx++;
  }
  if (updates.factExtractionModel !== undefined) {
    fields.push(`fact_extraction_model = $${idx}::jsonb`);
    values.push(updates.factExtractionModel === null ? null : JSON.stringify(updates.factExtractionModel));
    idx++;
  }
  if (fields.length === 0) return;

  fields.push(`updated_at = now()`);
  values.push(userId);

  await pool.query(
    `UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = $${idx}`,
    values
  );
}
