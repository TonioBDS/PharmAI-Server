import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db.js';

/** Jeton d'appareil : 32 octets aléatoires ; seul son haché SHA-256 est stocké. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Code d'invitation lisible, saisissable à la main si le QR code ne passe pas. */
export function newInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export { randomUUID };

export interface DeviceContext {
  deviceId: string;
  householdId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceContext;
  }
}

/**
 * Vérifie le jeton « Authorization: Bearer … » et que l'appareil appartient
 * bien au foyer de l'URL. Répond 401/403 sinon.
 */
export function requireDevice(pool: Pool) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match) return reply.code(401).send({ error: 'unauthorized' });
    const { rows } = await pool.query<{ id: string; household_id: string }>(
      'UPDATE devices SET last_seen_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, household_id',
      [hash(match[1])],
    );
    const device = rows[0];
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const params = request.params as { householdId?: string };
    if (params.householdId && params.householdId !== device.household_id) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    request.device = { deviceId: device.id, householdId: device.household_id };
  };
}
