import type { Db } from './db.js';

const DAY = 24 * 3600 * 1000;

/** Dernière activité d'un foyer : la connexion la plus récente de ses téléphones (ou sa création). */
export const lastActivitySql = `COALESCE((SELECT MAX(COALESCE(d.last_seen_at, d.created_at)) FROM devices d WHERE d.household_id = households.id AND d.revoked_at IS NULL), households.created_at)`;

/**
 * Efface les foyers dont aucun téléphone ne s'est connecté depuis `days` jours.
 * Les téléphones gardent toute leur armoire : seul le partage disparaît du serveur.
 * Renvoie le nombre de foyers effacés.
 */
export async function purgeInactive(db: Db, days: number, now = new Date()): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * DAY).toISOString();
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM households WHERE ${lastActivitySql} < $1`, [cutoff]);
  for (const r of rows) await db.query('DELETE FROM households WHERE id = $1', [r.id]);
  return rows.length;
}

/** Date à partir de laquelle un foyer sans nouvelle connexion sera effacé (null : jamais). */
export function deleteAfter(lastActivity: unknown, days: number): string | null {
  if (days <= 0 || !lastActivity) return null;
  const t = new Date(lastActivity as string).getTime();
  return Number.isFinite(t) ? new Date(t + days * DAY).toISOString() : null;
}
