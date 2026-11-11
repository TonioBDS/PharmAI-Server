import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Db, openDb } from '../src/db.js';

/**
 * Tests d'intégration, sur les deux moteurs :
 *  - SQLite en mémoire : toujours ;
 *  - PostgreSQL : si TEST_DATABASE_URL=postgres://… désigne une base jetable (elle est vidée).
 */
const targets: [string, string][] = [['SQLite', 'sqlite::memory:']];
if (process.env.TEST_DATABASE_URL) targets.push(['PostgreSQL', process.env.TEST_DATABASE_URL]);

describe.each(targets)('API PharmAI (%s)', (_name, url) => {
  let app: FastifyInstance;
  let db: Db;
  const env = { DATABASE_URL: url, LOG_LEVEL: 'silent', PUBLIC_RATE_LIMIT: '100000' };

  beforeAll(async () => {
    if (url.startsWith('postgres')) {
      const reset = await openDb(url);
      await reset.query('DROP SCHEMA public CASCADE');
      await reset.query('CREATE SCHEMA public');
      await reset.close();
      await (await openDb(url)).close(); // migrations
    }
    db = await openDb(url); // idempotent
    app = buildApp(loadConfig(env), db);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const PUBLIC_KEY = b64('clé-publique-de-test-32-octets!!');
  const SEALED = b64('clé-du-foyer-chiffrée-pour-le-nouveau-téléphone');

  async function newHousehold(name = 'Téléphone de test') {
    const res = await app.inject({ method: 'POST', url: '/v1/households', payload: { deviceName: name } });
    expect(res.statusCode).toBe(201);
    return res.json() as { householdId: string; deviceId: string; deviceToken: string; role: string };
  }

  /** Invitation → demande → validation par l'administrateur : renvoie le nouvel appareil. */
  async function join(owner: { householdId: string; deviceToken: string }, role: 'admin' | 'member' | 'viewer' = 'member', deviceName = 'Aidant') {
    const invite = await app.inject({ method: 'POST', url: `/v1/households/${owner.householdId}/invites`, headers: bearer(owner.deviceToken) });
    expect(invite.statusCode).toBe(201);
    const { inviteCode } = invite.json() as { inviteCode: string };
    const req = await app.inject({ method: 'POST', url: '/v1/invites/join', payload: { inviteCode: inviteCode.toLowerCase(), deviceName, publicKey: PUBLIC_KEY } });
    expect(req.statusCode).toBe(201);
    const { requestId, deviceToken } = req.json() as { requestId: string; deviceToken: string };
    const approve = await app.inject({
      method: 'POST',
      url: `/v1/households/${owner.householdId}/join-requests/${requestId}/approve`,
      headers: bearer(owner.deviceToken),
      payload: { role, sealedKey: SEALED },
    });
    expect(approve.statusCode).toBe(201);
    return { inviteCode, requestId, deviceToken, deviceId: (approve.json() as { deviceId: string }).deviceId, householdId: owner.householdId };
  }

  const push = (h: { householdId: string; deviceToken: string }, changes: unknown[]) =>
    app.inject({ method: 'POST', url: `/v1/households/${h.householdId}/changes`, headers: bearer(h.deviceToken), payload: { changes } });
  const pull = (h: { householdId: string; deviceToken: string }, query = 'since=0') =>
    app.inject({ method: 'GET', url: `/v1/households/${h.householdId}/changes?${query}`, headers: bearer(h.deviceToken) });

  it('répond au contrôle de santé', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toMatchObject({ status: 'ok', registration: true });
  });

  it('refuse les requêtes sans jeton ou vers un autre foyer', async () => {
    const a = await newHousehold();
    const b = await newHousehold();
    expect((await app.inject({ method: 'GET', url: `/v1/households/${a.householdId}/changes` })).statusCode).toBe(401);
    expect((await pull({ householdId: a.householdId, deviceToken: b.deviceToken })).statusCode).toBe(403);
  });

  it("n'ajoute un téléphone qu'après validation par un administrateur", async () => {
    const owner = await newHousehold('Téléphone 1');
    expect(owner.role).toBe('admin');
    const { inviteCode } = (await app.inject({ method: 'POST', url: `/v1/households/${owner.householdId}/invites`, headers: bearer(owner.deviceToken) })).json() as { inviteCode: string };

    const req = await app.inject({ method: 'POST', url: '/v1/invites/join', payload: { inviteCode, deviceName: 'Nouveau', publicKey: PUBLIC_KEY } });
    const { requestId, deviceToken } = req.json() as { requestId: string; deviceToken: string };
    const candidate = { householdId: owner.householdId, deviceToken };

    // Une invitation ne sert qu'une fois
    expect((await app.inject({ method: 'POST', url: '/v1/invites/join', payload: { inviteCode, deviceName: 'Intrus', publicKey: PUBLIC_KEY } })).statusCode).toBe(404);

    // Tant que la demande est en attente : aucun accès, statut « pending »
    expect((await pull(candidate)).statusCode).toBe(401);
    const waiting = await app.inject({ method: 'GET', url: `/v1/join-requests/${requestId}`, headers: bearer(deviceToken) });
    expect(waiting.json()).toEqual({ status: 'pending' });
    expect((await app.inject({ method: 'GET', url: `/v1/join-requests/${requestId}`, headers: bearer('mauvais-jeton') })).statusCode).toBe(404);

    // L'administrateur voit la demande avec la clé publique (pour le code de vérification)
    const list = await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/join-requests`, headers: bearer(owner.deviceToken) });
    expect((list.json() as { requests: unknown[] }).requests).toEqual([expect.objectContaining({ id: requestId, deviceName: 'Nouveau', publicKey: PUBLIC_KEY })]);

    const approve = await app.inject({
      method: 'POST',
      url: `/v1/households/${owner.householdId}/join-requests/${requestId}/approve`,
      headers: bearer(owner.deviceToken),
      payload: { role: 'member', sealedKey: SEALED },
    });
    expect(approve.statusCode).toBe(201);

    // Le nouveau téléphone récupère la clé du foyer chiffrée pour lui, et son jeton devient valide
    const done = await app.inject({ method: 'GET', url: `/v1/join-requests/${requestId}`, headers: bearer(deviceToken) });
    expect(done.json()).toMatchObject({ status: 'approved', role: 'member', sealedKey: SEALED, householdId: owner.householdId });
    expect((await pull(candidate)).statusCode).toBe(200);

    // Une demande refusée ne donne aucun accès
    const inv2 = (await app.inject({ method: 'POST', url: `/v1/households/${owner.householdId}/invites`, headers: bearer(owner.deviceToken) })).json() as { inviteCode: string };
    const req2 = (await app.inject({ method: 'POST', url: '/v1/invites/join', payload: { inviteCode: inv2.inviteCode, deviceName: 'Inconnu', publicKey: PUBLIC_KEY } })).json() as { requestId: string; deviceToken: string };
    const reject = await app.inject({ method: 'POST', url: `/v1/households/${owner.householdId}/join-requests/${req2.requestId}/reject`, headers: bearer(owner.deviceToken) });
    expect(reject.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/v1/join-requests/${req2.requestId}`, headers: bearer(req2.deviceToken) })).json()).toEqual({ status: 'rejected' });
    expect((await pull({ householdId: owner.householdId, deviceToken: req2.deviceToken })).statusCode).toBe(401);
  });

  it('relaie les modifications chiffrées entre deux appareils, sans doublon', async () => {
    const owner = await newHousehold('Téléphone 1');
    const aidant = await join(owner);

    const change = { id: randomUUID(), nonce: b64('nonce-de-test-24o'), ciphertext: b64('{"chiffré":true}') };
    expect((await push(owner, [change])).json()).toMatchObject({ accepted: 1, duplicates: 0 });
    expect((await push(owner, [change])).json()).toMatchObject({ accepted: 0, duplicates: 1 });

    const body = (await pull(aidant)).json() as { changes: { id: string; ciphertext: string; deviceId: string; seq: number }[]; cursor: number; hasMore: boolean };
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]).toMatchObject({ id: change.id, ciphertext: change.ciphertext, deviceId: owner.deviceId });
    expect(body.hasMore).toBe(false);
    expect(((await pull(aidant, `since=${body.cursor}`)).json() as { changes: unknown[] }).changes).toHaveLength(0);
  });

  it('pagine le journal', async () => {
    const h = await newHousehold();
    const changes = Array.from({ length: 5 }, () => ({ id: randomUUID(), nonce: b64('n'.repeat(12)), ciphertext: b64('x') }));
    await push(h, changes);
    const body = (await pull(h, 'since=0&limit=2')).json() as { changes: { id: string }[]; hasMore: boolean };
    expect(body.changes.map((c) => c.id)).toEqual(changes.slice(0, 2).map((c) => c.id));
    expect(body.hasMore).toBe(true);
  });

  it('rejette un contenu mal formé', async () => {
    const h = await newHousehold();
    expect((await push(h, [{ id: 'pas-un-uuid', nonce: '!!', ciphertext: 'x' }])).statusCode).toBe(400);
  });

  it('applique les rôles : lecture seule, membre, administrateur', async () => {
    const owner = await newHousehold();
    const viewer = await join(owner, 'viewer', 'Aidant occasionnel');
    const member = await join(owner, 'member', 'Conjoint');
    const change = () => ({ id: randomUUID(), nonce: b64('n'.repeat(12)), ciphertext: b64('x') });

    // Lecture seule : lit, n'écrit pas
    expect((await pull(viewer)).statusCode).toBe(200);
    expect((await push(viewer, [change()])).statusCode).toBe(403);
    expect((await push(member, [change()])).statusCode).toBe(200);

    // Seul un administrateur invite, valide, révoque ou change un rôle
    expect((await app.inject({ method: 'POST', url: `/v1/households/${owner.householdId}/invites`, headers: bearer(member.deviceToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/join-requests`, headers: bearer(member.deviceToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/v1/households/${owner.householdId}/devices/${viewer.deviceId}`, headers: bearer(member.deviceToken) })).statusCode).toBe(403);
    const patch = (token: string, deviceId: string, payload: object) =>
      app.inject({ method: 'PATCH', url: `/v1/households/${owner.householdId}/devices/${deviceId}`, headers: bearer(token), payload });
    expect((await patch(member.deviceToken, member.deviceId, { role: 'admin' })).statusCode).toBe(403);

    // Chacun peut renommer son propre appareil ; l'administrateur change les rôles
    expect((await patch(member.deviceToken, member.deviceId, { name: 'Pixel de Sam' })).statusCode).toBe(204);
    expect((await patch(owner.deviceToken, viewer.deviceId, { role: 'member' })).statusCode).toBe(204);
    expect((await push(viewer, [change()])).statusCode).toBe(200);

    const devices = ((await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/devices`, headers: bearer(member.deviceToken) })).json() as { devices: { name: string; role: string; current: boolean }[] }).devices;
    expect(devices.map((d) => [d.name, d.role, d.current])).toEqual([
      ['Téléphone de test', 'admin', false],
      ['Aidant occasionnel', 'member', false],
      ['Pixel de Sam', 'member', true],
    ]);

    // Il reste toujours un administrateur
    expect((await patch(owner.deviceToken, owner.deviceId, { role: 'member' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/v1/households/${owner.householdId}/devices/${owner.deviceId}`, headers: bearer(owner.deviceToken) })).statusCode).toBe(409);
  });

  it('révoque un appareil, laisse quitter le partage, efface le foyer avec le dernier', async () => {
    const owner = await newHousehold();
    const other = await join(owner, 'member', 'Ancien téléphone');
    const leaver = await join(owner, 'member', 'Invité');

    const del = await app.inject({ method: 'DELETE', url: `/v1/households/${owner.householdId}/devices/${other.deviceId}`, headers: bearer(owner.deviceToken) });
    expect(del.statusCode).toBe(204);
    expect((await pull(other)).statusCode).toBe(401);

    // Un membre peut se retirer lui-même
    expect((await app.inject({ method: 'DELETE', url: `/v1/households/${owner.householdId}/devices/${leaver.deviceId}`, headers: bearer(leaver.deviceToken) })).statusCode).toBe(204);
    expect((await pull(leaver)).statusCode).toBe(401);

    // Dernier appareil : le foyer et son journal disparaissent du serveur
    await push(owner, [{ id: randomUUID(), nonce: b64('n'.repeat(12)), ciphertext: b64('x') }]);
    expect((await app.inject({ method: 'DELETE', url: `/v1/households/${owner.householdId}/devices/${owner.deviceId}`, headers: bearer(owner.deviceToken) })).statusCode).toBe(204);
    expect((await pull(owner)).statusCode).toBe(401);
    const left = await db.query<{ n: number | string }>('SELECT COUNT(*) AS n FROM changes WHERE household_id = $1', [owner.householdId]);
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it('protège les administrateurs entre eux : seul soi-même peut se rétrograder ou partir', async () => {
    const a = await newHousehold();
    const b = await join(a, 'admin', 'Second admin');
    const dev = (h: { householdId: string }, id: string) => `/v1/households/${h.householdId}/devices/${id}`;
    // Un administrateur ne peut ni révoquer ni rétrograder un autre administrateur
    expect((await app.inject({ method: 'DELETE', url: dev(a, b.deviceId), headers: bearer(a.deviceToken) })).statusCode).toBe(403);
    const demote = await app.inject({ method: 'PATCH', url: dev(a, b.deviceId), headers: bearer(a.deviceToken), payload: { role: 'member' } });
    expect(demote.statusCode).toBe(403);
    expect(demote.json()).toEqual({ error: 'admin_protected' });
    // Il peut se rétrograder lui-même tant qu'il en reste un autre…
    expect((await app.inject({ method: 'PATCH', url: dev(a, a.deviceId), headers: bearer(a.deviceToken), payload: { role: 'member' } })).statusCode).toBe(204);
    // …mais le dernier ne peut ni se rétrograder ni partir en laissant des appareils sans administrateur
    expect((await app.inject({ method: 'PATCH', url: dev(b, b.deviceId), headers: bearer(b.deviceToken), payload: { role: 'viewer' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: dev(b, b.deviceId), headers: bearer(b.deviceToken) })).statusCode).toBe(409);
    // Promotion d'un membre en administrateur, puis départ volontaire du premier
    expect((await app.inject({ method: 'PATCH', url: dev(b, a.deviceId), headers: bearer(b.deviceToken), payload: { role: 'admin' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: dev(b, b.deviceId), headers: bearer(b.deviceToken) })).statusCode).toBe(204);
  });

  it('renouvelle la clé du foyer après un départ : époques et enveloppes par appareil', async () => {
    const a = await newHousehold();
    const b = await join(a, 'member');
    const c = await join(a, 'viewer');
    const devices = () => app.inject({ method: 'GET', url: `/v1/households/${a.householdId}/devices`, headers: bearer(a.deviceToken) });
    expect((await devices()).json()).toMatchObject({ keyEpoch: 1, rekeyNeeded: false });
    await app.inject({ method: 'DELETE', url: `/v1/households/${a.householdId}/devices/${c.deviceId}`, headers: bearer(a.deviceToken) });
    expect((await devices()).json()).toMatchObject({ keyEpoch: 1, rekeyNeeded: true });

    const keys = (token: string, payload: unknown) => app.inject({ method: 'POST', url: `/v1/households/${a.householdId}/keys`, headers: bearer(token), payload: payload as object });
    const env = (id: string) => ({ deviceId: id, sealedKey: SEALED });
    // Réservé aux administrateurs ; tous les appareils restants, et eux seuls ; époque suivante uniquement
    expect((await keys(b.deviceToken, { epoch: 2, envelopes: [env(a.deviceId), env(b.deviceId)] })).statusCode).toBe(403);
    expect((await keys(a.deviceToken, { epoch: 2, envelopes: [env(a.deviceId)] })).json()).toEqual({ error: 'devices_changed' });
    expect((await keys(a.deviceToken, { epoch: 2, envelopes: [env(a.deviceId), env(b.deviceId), env(c.deviceId)] })).json()).toEqual({ error: 'devices_changed' });
    expect((await keys(a.deviceToken, { epoch: 3, envelopes: [env(a.deviceId), env(b.deviceId)] })).json()).toEqual({ error: 'epoch_conflict' });
    expect((await keys(a.deviceToken, { epoch: 2, envelopes: [env(a.deviceId), env(b.deviceId)] })).statusCode).toBe(201);
    expect((await devices()).json()).toMatchObject({ keyEpoch: 2, rekeyNeeded: false });

    const mine = await app.inject({ method: 'GET', url: `/v1/households/${a.householdId}/keys`, headers: bearer(b.deviceToken) });
    expect(mine.json()).toEqual({ keyEpoch: 2, envelopes: [{ epoch: 2, sealedKey: SEALED }] });

    // Un envoi chiffré avec l'ancienne clé est refusé ; avec la nouvelle, il porte son époque
    const change = { id: randomUUID(), nonce: b64('nonce-de-24-octets-xxxxx'), ciphertext: b64('contenu') };
    const stale = await app.inject({ method: 'POST', url: `/v1/households/${a.householdId}/changes`, headers: bearer(b.deviceToken), payload: { epoch: 1, changes: [change] } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'stale_epoch' });
    expect((await app.inject({ method: 'POST', url: `/v1/households/${a.householdId}/changes`, headers: bearer(b.deviceToken), payload: { epoch: 2, changes: [change] } })).statusCode).toBe(200);
    expect(((await pull(a)).json() as { changes: { epoch: number }[] }).changes.map((x) => x.epoch)).toEqual([2]);
  });

  it('stocke les fichiers chiffrés (photos) du foyer', async () => {
    const a = await newHousehold();
    const b = await join(a, 'viewer');
    const other = await newHousehold();
    const id = 'a'.repeat(40);
    const url = (h: { householdId: string }, blob = id) => `/v1/households/${h.householdId}/blobs/${blob}`;
    const body = { epoch: 1, nonce: b64('nonce-de-24-octets-xxxxx'), ciphertext: b64('photo chiffrée') };
    expect((await app.inject({ method: 'PUT', url: url(a), headers: bearer(b.deviceToken), payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: url(a, 'pas un identifiant'), headers: bearer(a.deviceToken), payload: body })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: url(a), headers: bearer(a.deviceToken), payload: body })).statusCode).toBe(204);
    // Renvoi ignoré, lecture par un appareil en lecture seule, cloisonnement entre foyers
    expect((await app.inject({ method: 'PUT', url: url(a), headers: bearer(a.deviceToken), payload: { ...body, ciphertext: b64('autre') } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: url(a), headers: bearer(b.deviceToken) })).json()).toEqual(body);
    expect((await app.inject({ method: 'GET', url: `/v1/households/${a.householdId}/blobs`, headers: bearer(b.deviceToken) })).json()).toEqual({ ids: [id] });
    expect((await app.inject({ method: 'GET', url: url(other), headers: bearer(other.deviceToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: url(a), headers: bearer(other.deviceToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: url(a), headers: bearer(a.deviceToken) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: url(a), headers: bearer(a.deviceToken) })).statusCode).toBe(404);
  });

  it('ne transmet à un appareil que les personnes du foyer partagées avec lui', async () => {
    const owner = await newHousehold();
    const A = 'a'.repeat(32);
    const B = 'b'.repeat(32);
    const invite = (await app.inject({ method: 'POST', url: `/v1/households/${owner.householdId}/invites`, headers: bearer(owner.deviceToken) })).json() as { inviteCode: string };
    const req = (await app.inject({ method: 'POST', url: '/v1/invites/join', payload: { inviteCode: invite.inviteCode, deviceName: 'Ado', publicKey: PUBLIC_KEY } })).json() as {
      requestId: string;
      deviceToken: string;
    };
    const approve = await app.inject({
      method: 'POST',
      url: `/v1/households/${owner.householdId}/join-requests/${req.requestId}/approve`,
      headers: bearer(owner.deviceToken),
      payload: { role: 'member', sealedKey: SEALED, scopes: [A] },
    });
    expect(approve.statusCode).toBe(201);
    const ado = { householdId: owner.householdId, deviceToken: req.deviceToken, deviceId: (approve.json() as { deviceId: string }).deviceId };

    const c = (scope?: string) => ({ id: randomUUID(), nonce: b64('nonce-de-test-24o'), ciphertext: b64('x'), ...(scope ? { scope } : {}) });
    const common = c();
    const forA = c(A);
    const forB = c(B);
    expect((await push(owner, [common, forA, forB])).statusCode).toBe(200);
    const seen = ((await pull(ado)).json() as { changes: { id: string }[] }).changes.map((x) => x.id);
    expect(seen).toEqual([common.id, forA.id]);
    // Il ne peut rien écrire pour une personne non partagée
    expect((await push(ado, [c(B)])).statusCode).toBe(403);
    expect((await push(ado, [c(A)])).statusCode).toBe(200);

    // La liste des appareils indique les personnes partagées (opaque pour le serveur)
    const devices = (await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/devices`, headers: bearer(owner.deviceToken) })).json() as {
      devices: { id: string; scopes: string[] | null }[];
    };
    expect(devices.devices.find((d) => d.id === ado.deviceId)!.scopes).toEqual([A]);
    expect(devices.devices.find((d) => d.id === owner.deviceId)!.scopes).toBeNull();

    // Seul un administrateur change le partage ; B ajouté : rattrapage de B seulement
    expect((await app.inject({ method: 'PATCH', url: `/v1/households/${owner.householdId}/devices/${ado.deviceId}`, headers: bearer(ado.deviceToken), payload: { scopes: null } })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'PATCH', url: `/v1/households/${owner.householdId}/devices/${ado.deviceId}`, headers: bearer(owner.deviceToken), payload: { scopes: [A, B] } })).statusCode,
    ).toBe(204);
    const backfill = ((await pull(ado, `since=0&scopes=${B}`)).json() as { changes: { id: string }[] }).changes.map((x) => x.id);
    expect(backfill).toEqual([forB.id]);
    expect(((await pull(ado, 'since=0&scopes=*')).json() as { changes: unknown[] }).changes).toHaveLength(3);

    // Photos d'ordonnance : invisibles hors portée
    const blob = { nonce: b64('nonce-de-test-24o'), ciphertext: b64('photo') };
    const id = 'c'.repeat(32);
    await app.inject({ method: 'PUT', url: `/v1/households/${owner.householdId}/blobs/${id}`, headers: bearer(owner.deviceToken), payload: { ...blob, scope: 'd'.repeat(32) } });
    expect((await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/blobs/${id}`, headers: bearer(ado.deviceToken) })).statusCode).toBe(404);
    expect(((await app.inject({ method: 'GET', url: `/v1/households/${owner.householdId}/blobs`, headers: bearer(ado.deviceToken) })).json() as { ids: string[] }).ids).not.toContain(id);

    // Promu administrateur : tout le foyer
    await app.inject({ method: 'PATCH', url: `/v1/households/${owner.householdId}/devices/${ado.deviceId}`, headers: bearer(owner.deviceToken), payload: { role: 'admin' } });
    expect(((await pull(ado)).json() as { changes: unknown[] }).changes.length).toBeGreaterThanOrEqual(4);
  });

  it('peut fermer les inscriptions et limite les tentatives sans jeton', async () => {
    const closed = buildApp(loadConfig({ ...env, ALLOW_REGISTRATION: 'false' }), db);
    expect((await closed.inject({ method: 'POST', url: '/v1/households', payload: { deviceName: 'x' } })).statusCode).toBe(403);
    await closed.close();

    const limited = buildApp(loadConfig({ ...env, PUBLIC_RATE_LIMIT: '3' }), db);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await limited.inject({ method: 'POST', url: '/v1/invites/join', payload: { inviteCode: 'AAAAA-BBBBB', deviceName: 'x', publicKey: PUBLIC_KEY } })).statusCode);
    expect(codes).toEqual([404, 404, 404, 429, 429]);
    await limited.close();
  });
});
