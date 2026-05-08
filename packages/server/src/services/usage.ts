import { getPool } from '../db/pool.js';
import type { UsageReport } from '@sage/shared';

export async function getUsageReport(userId: string, from?: string, to?: string): Promise<UsageReport> {
  const pool = getPool();
  const now = new Date();
  const periodStart = from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const periodEnd = to ?? now.toISOString();

  const byDayResult = await pool.query<{ d: string; c: string }>(
    `SELECT DATE(m.created_at) AS d, SUM(COALESCE(m.cost_usd, m.cost_cents::numeric / 100)) AS c
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1
       AND m.created_at >= $2
       AND m.created_at <= $3
       AND (m.cost_usd IS NOT NULL OR m.cost_cents IS NOT NULL)
     GROUP BY d
     ORDER BY d`,
    [userId, periodStart, periodEnd]
  );

  const byDay = byDayResult.rows.map((row) => ({
    date: row.d,
    costUsd: Number(row.c),
  }));

  const byProviderModelResult = await pool.query<{ provider: string; model: string; c: string; msgs: string }>(
    `SELECT m.provider, m.model, SUM(COALESCE(m.cost_usd, m.cost_cents::numeric / 100)) AS c, COUNT(*) AS msgs
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1
       AND m.created_at >= $2
       AND m.created_at <= $3
       AND (m.cost_usd IS NOT NULL OR m.cost_cents IS NOT NULL)
       AND m.provider IS NOT NULL
       AND m.model IS NOT NULL
     GROUP BY m.provider, m.model`,
    [userId, periodStart, periodEnd]
  );

  const byProviderModel = byProviderModelResult.rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    costUsd: Number(row.c),
    messageCount: Number(row.msgs),
  }));

  const topConvosResult = await pool.query<{ cid: string; title: string; c: string; msgs: string }>(
    `SELECT c.id AS cid, c.title, SUM(COALESCE(m.cost_usd, m.cost_cents::numeric / 100)) AS c, COUNT(*) AS msgs
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1
       AND m.created_at >= $2
       AND m.created_at <= $3
       AND (m.cost_usd IS NOT NULL OR m.cost_cents IS NOT NULL)
     GROUP BY c.id, c.title
     ORDER BY SUM(COALESCE(m.cost_usd, m.cost_cents::numeric / 100)) DESC NULLS LAST
     LIMIT 10`,
    [userId, periodStart, periodEnd]
  );

  const topConversations = topConvosResult.rows.map((row) => ({
    conversationId: row.cid,
    title: row.title,
    costUsd: Number(row.c),
    messageCount: Number(row.msgs),
  }));

  const totalUsd = byDay.reduce((s, d) => s + d.costUsd, 0);

  return { byDay, byProviderModel, topConversations, totalUsd, periodStart, periodEnd };
}

export async function getCurrentPeriodSpendCents(userId: string): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query<{ u: string }>(
    `SELECT COALESCE(SUM(COALESCE(m.cost_usd, m.cost_cents::numeric / 100)), 0) AS u
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1
       AND to_char(m.created_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM')`,
    [userId]
  );
  return Math.round(Number(rows[0].u) * 100);
}
