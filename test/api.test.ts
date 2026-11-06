import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, migrate, Pool } from '../src/db.js';

/**
 * Tests d'intégration : nécessitent une base PostgreSQL jetable.
 *   TEST_DATABASE_URL=postgres://... npm test
 * Sans cette variable, les tests sont ignorés.
 */
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('API PharmAI', () => {
  let app: FastifyInstance;
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(url!);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
    await migrate(pool); // idempotent
    app = buildApp(loadConfig({ DATABASE_URL: url, LOG_LEVEL: 'silent' }), pool);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  async function newHousehold(name = 'Téléphone de test') {
    const res = await app.inject({ method: 'POST', url: '/v1/households', payload: { deviceName: name } });
    expect(res.statusCode).toBe(201);
    return res.json() as { householdId: string; deviceId: string; deviceToken: string };
  }

  it('répond au contrôle de santé', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('refuse les requêtes sans jeton ou vers un autre foyer', async () => {
    const a = await newHousehold();
    const b = await newHousehold();
    expect((await app.inject({ method: 'GET', url: `/v1/households/${a.householdId}/changes` })).statusCode).toBe(401);
    const cross = await app.inject({ method: 'GET', url: `/v1/households/${a.householdId}/changes`, headers: bearer(b.deviceToken) });
    expect(cross.statusCode).toBe(403);
  });

  it('relaie les modifications chiffrées entre deux appareils, sans doublon', async () => {
    const owner = await newHousehold('Téléphone 1');

    const invite = await app.inject({ method: 'POST', url: `/v1/households/${owner.householdId}/invites`, headers: bearer(owner.deviceToken) });
    expect(invite.statusCode).toBe(201);
    const { inviteCode } = invite.json() as { inviteCode: string };

    const joined = await app.inject({ method: 'POST', url: '/v1/invites/accept', payload: { inviteCode: inviteCode.toLowerCase(), deviceName: 'Aidant' } });
    expect(joined.statusCode).toBe(201);
    const aidant = joined.json() as { householdId: string; deviceToken: string };
    expect(aidant.householdId).toBe(owner.householdId);

    // Une invitation ne sert qu'une fois
    const reuse = await app.inject({ method: 'POST', url: '/v1/invites/accept', payload: { inviteCode, deviceName: 'Intrus' } });
    expect(reuse.statusCode).toBe(404);

    const change = { id: randomUUID(), nonce: b64('nonce-de-test-24o'), ciphertext: b64('{"chiffré":true}') };
    const push = await app.inject({
      method: 'POST',
      url: `/v1/households/${owner.householdId}/changes`,
      headers: bearer(owner.deviceToken),
      payload: { changes: [change] },
    });
    expect(push.json()).toMatchObject({ accepted: 1, duplicates: 0 });

    const again = await app.inject({
      method: 'POST',
      url: `/v1/households/${owner.householdId}/changes`,
      headers: bearer(owner.deviceToken),
      payload: { changes: [change] },
    });
    expect(again.json()).toMatchObject({ accepted: 0, duplicates: 1 });

    const pull = await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/changes?since=0`, headers: bearer(aidant.deviceToken) });
    const body = pull.json() as { changes: { id: string; ciphertext: string }[]; cursor: number; hasMore: boolean };
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]).toMatchObject({ id: change.id, ciphertext: change.ciphertext });
    expect(body.hasMore).toBe(false);

    const next = await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/changes?since=${body.cursor}`, headers: bearer(aidant.deviceToken) });
    expect((next.json() as { changes: unknown[] }).changes).toHaveLength(0);
  });

  it('pagine le journal', async () => {
    const h = await newHousehold();
    const changes = Array.from({ length: 5 }, () => ({ id: randomUUID(), nonce: b64('n'.repeat(12)), ciphertext: b64('x') }));
    await app.inject({ method: 'POST', url: `/v1/households/${h.householdId}/changes`, headers: bearer(h.deviceToken), payload: { changes } });
    const page = await app.inject({ method: 'GET', url: `/v1/households/${h.householdId}/changes?since=0&limit=2`, headers: bearer(h.deviceToken) });
    const body = page.json() as { changes: { id: string }[]; hasMore: boolean };
    expect(body.changes.map((c) => c.id)).toEqual(changes.slice(0, 2).map((c) => c.id));
    expect(body.hasMore).toBe(true);
  });

  it('rejette un contenu mal formé', async () => {
    const h = await newHousehold();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${h.householdId}/changes`,
      headers: bearer(h.deviceToken),
      payload: { changes: [{ id: 'pas-un-uuid', nonce: '!!', ciphertext: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('révoque un appareil', async () => {
    const owner = await newHousehold();
    const inv = (await app.inject({ method: 'POST', url: `/v1/households/${owner.householdId}/invites`, headers: bearer(owner.deviceToken) })).json() as { inviteCode: string };
    const other = (await app.inject({ method: 'POST', url: '/v1/invites/accept', payload: { inviteCode: inv.inviteCode, deviceName: 'Ancien téléphone' } })).json() as { deviceId: string; deviceToken: string };

    const list = await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/devices`, headers: bearer(owner.deviceToken) });
    expect((list.json() as { devices: unknown[] }).devices).toHaveLength(2);

    const del = await app.inject({ method: 'DELETE', url: `/v1/households/${owner.householdId}/devices/${other.deviceId}`, headers: bearer(owner.deviceToken) });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/changes`, headers: bearer(other.deviceToken) });
    expect(after.statusCode).toBe(401);
  });

  it('peut fermer les inscriptions', async () => {
    const closed = buildApp(loadConfig({ DATABASE_URL: url, LOG_LEVEL: 'silent', ALLOW_REGISTRATION: 'false' }), pool);
    const res = await closed.inject({ method: 'POST', url: '/v1/households', payload: { deviceName: 'x' } });
    expect(res.statusCode).toBe(403);
    await closed.close();
  });
});
