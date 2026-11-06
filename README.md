# PharmAI Server

Serveur de synchronisation **chiffrée de bout en bout** pour l'application PharmAI :
il relaie les modifications entre les appareils d'un foyer (famille, aidant) sans pouvoir
les lire. Le contenu des armoires est chiffré sur les téléphones ; le serveur ne voit que
des blocs opaques, des identifiants d'appareils et des jetons hachés.

Licence **AGPL-3.0** : vous pouvez l'héberger vous-même, le modifier et le redistribuer ;
si vous proposez une version modifiée à d'autres via un réseau, vous devez en publier le code.

## Démarrer chez soi (Docker)

```bash
cp .env.example .env        # puis changez POSTGRES_PASSWORD
docker compose up -d --build
curl http://localhost:8080/health
```

Pour y accéder hors de chez vous, utilisez un tunnel chiffré (Tailscale, WireGuard)
plutôt que d'ouvrir un port sur votre box.

> **Données de santé.** Héberger ce serveur pour votre propre foyer ne pose pas de difficulté.
> L'ouvrir à d'autres personnes revient, en France, à héberger des données de santé pour
> le compte de tiers, ce qui impose en principe un hébergeur certifié HDS.

## Développement

```bash
npm ci
npm run typecheck
TEST_DATABASE_URL=postgres://user@localhost:5432/pharmai_test npm test   # base jetable : elle est vidée
DATABASE_URL=postgres://user@localhost:5432/pharmai npm run dev
```

Variables : `DATABASE_URL` (obligatoire), `PORT` (8080), `HOST` (0.0.0.0),
`ALLOW_REGISTRATION` (true), `MAX_CHANGE_BYTES` (262144), `INVITE_TTL_HOURS` (24), `LOG_LEVEL` (info).

## API v1

Authentification : `Authorization: Bearer <deviceToken>`. Un appareil n'accède qu'à son foyer.

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| GET | `/health` | État du serveur et de la base |
| POST | `/v1/households` | Crée un foyer et son premier appareil → `householdId`, `deviceId`, `deviceToken` (si `ALLOW_REGISTRATION`) |
| POST | `/v1/households/:id/invites` | Crée un code d'invitation à usage unique (24 h) |
| POST | `/v1/invites/accept` | Rejoint un foyer avec un code → nouvel appareil et son jeton |
| GET | `/v1/households/:id/devices` | Liste les appareils du foyer |
| DELETE | `/v1/households/:id/devices/:deviceId` | Révoque un appareil (téléphone perdu, aidant retiré) |
| POST | `/v1/households/:id/changes` | Envoie jusqu'à 500 modifications chiffrées `{id, nonce, ciphertext}` ; un `id` déjà reçu est ignoré |
| GET | `/v1/households/:id/changes?since=<seq>&limit=<n>` | Lit le journal après le curseur `since` → `changes`, `cursor`, `hasMore` |

La **clé du foyer** ne passe jamais par le serveur : elle est transmise d'appareil à appareil
(QR code), en même temps que le code d'invitation.

## Licence

[GNU Affero General Public License v3.0](LICENSE) — Copyright (c) 2026 TonioBDS.
