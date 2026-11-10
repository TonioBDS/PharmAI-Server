import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';

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

/** admin : invite, valide, révoque ; member : lit et modifie ; viewer : lit seulement. */
export const ROLES = ['admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export interface DeviceContext {
  deviceId: string;
  householdId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceContext;
  }
}

export function bearer(request: FastifyRequest): string | null {
  const match = (request.headers.authorization ?? '').match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/**
 * Vérifie le jeton « Authorization: Bearer … », que l'appareil appartient au
 * foyer de l'URL et, si demandé, qu'il a l'un des rôles requis. Répond 401/403 sinon.
 */
export function requireDevice(db: Db, ...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(request);
    if (!token) return reply.code(401).send({ error: 'unauthorized' });
    const { rows } = await db.query<{ id: string; household_id: string; role: Role }>(
      'UPDATE devices SET last_seen_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL RETURNING id, household_id, role',
      [new Date().toISOString(), hash(token)],
    );
    const device = rows[0];
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const params = request.params as { householdId?: string };
    if (params.householdId && params.householdId !== device.household_id) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (roles.length && !roles.includes(device.role)) return reply.code(403).send({ error: 'forbidden_role' });
    request.device = { deviceId: device.id, householdId: device.household_id, role: device.role };
  };
}

/** Limite simple en mémoire pour les routes sans jeton (devinette de codes d'invitation, création en masse). */
export function rateLimiter(perMinute: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const entry = hits.get(request.ip);
    if (!entry || entry.reset < now) {
      hits.set(request.ip, { count: 1, reset: now + 60_000 });
      return;
    }
    entry.count += 1;
    if (entry.count > perMinute) return reply.code(429).send({ error: 'too_many_requests' });
  };
}
