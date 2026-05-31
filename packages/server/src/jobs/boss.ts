import { PgBoss } from 'pg-boss';
import { config } from '../config.js';

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for pg-boss');
  }
  boss = new PgBoss({ connectionString: config.DATABASE_URL, max: 5 });
  await boss.start();
  return boss;
}

export async function closeBoss(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
