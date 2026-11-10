# PharmAI Server

Serveur de synchronisation **chiffrée de bout en bout** pour l'application PharmAI :
il relaie les modifications entre les appareils d'un foyer (famille, aidant) sans pouvoir
les lire. Le contenu des armoires est chiffré sur les téléphones ; le serveur ne voit que
des blocs opaques, des identifiants d'appareils et des jetons hachés.

Licence **AGPL-3.0** : vous pouvez l'héberger vous-même, le modifier et le redistribuer ;
si vous proposez une version modifiée à d'autres via un réseau, vous devez en publier le code.

## Démarrer chez soi (Docker)

Un seul conteneur, base **SQLite** dans un volume : convient à un Raspberry Pi, un NAS ou un mini-PC.

```bash
docker compose up -d --build
curl http://localhost:8080/health
```

Dans l'app : Réglages → Partage → « Créer un partage », avec l'adresse du serveur
(ex. `http://192.168.1.20:8080`). Une fois votre foyer créé, passez `ALLOW_REGISTRATION=false`
(fichier `.env`) : plus personne ne peut créer de foyer, seules les invitations validées fonctionnent.

- **Hors de chez vous** : utilisez un tunnel chiffré (Tailscale, WireGuard) ou un proxy HTTPS,
  plutôt que d'ouvrir un port sur votre box. En HTTP simple, les jetons d'appareil circulent en
  clair sur le réseau (le contenu des armoires, lui, reste chiffré de bout en bout).
- **Sauvegarde** : copiez le volume `data` (fichier `pharmai.db`).
- **PostgreSQL** (plusieurs foyers, service hébergé) : `docker compose -f docker-compose.postgres.yml up -d --build`.

> **Données de santé.** Héberger ce serveur pour votre propre foyer ne pose pas de difficulté.
> L'ouvrir à d'autres personnes revient, en France, à héberger des données de santé pour
> le compte de tiers, ce qui impose en principe un hébergeur certifié HDS.

## Ajouter un téléphone, rôles, révocation

1. Un **administrateur** crée une invitation (QR code ou lien, valable 24 h, à usage unique).
   Le lien ne contient pas la clé du foyer.
2. Le nouveau téléphone dépose une **demande** avec sa clé publique.
3. L'administrateur compare le **code de vérification** affiché sur les deux écrans, choisit un
   rôle et valide : son téléphone chiffre la clé du foyer pour le nouveau. Le serveur relaie ce
   bloc sans pouvoir l'ouvrir.

| Rôle | Lire | Modifier | Inviter, valider, révoquer, changer un rôle |
| --- | --- | --- | --- |
| `admin` | oui | oui | oui |
| `member` | oui | oui | non |
| `viewer` (lecture seule) | oui | non | non |

Un appareil révoqué ne reçoit plus rien, mais il garde ce qu'il avait déjà téléchargé et la clé
du foyer : la rotation de clé après révocation est prévue, pas encore faite. Il reste toujours au
moins un administrateur ; le dernier appareil qui quitte le partage efface le foyer du serveur.

## Développement

```bash
npm ci
npm run typecheck
npm test                                                                  # SQLite en mémoire
TEST_DATABASE_URL=postgres://user@localhost:5432/pharmai_test npm test   # + PostgreSQL (base jetable : elle est vidée)
npm run dev                                                               # SQLite dans ./data
```

Variables : `DATABASE_URL` (`postgres://…` ou `sqlite:/chemin/fichier.db` ; par défaut SQLite dans `DATA_DIR`),
`DATA_DIR` (`./data`, `/data` dans l'image), `PORT` (8080), `HOST` (0.0.0.0), `ALLOW_REGISTRATION` (true),
`MAX_CHANGE_BYTES` (262144), `INVITE_TTL_HOURS` (24), `PUBLIC_RATE_LIMIT` (20 par minute et par adresse), `LOG_LEVEL` (info).

## API v1

Authentification : `Authorization: Bearer <deviceToken>`. Un appareil n'accède qu'à son foyer.

| Méthode | Chemin | Qui | Rôle |
| --- | --- | --- | --- |
| GET | `/health` | tous | État du serveur et de la base |
| POST | `/v1/households` | sans jeton | Crée un foyer et son premier appareil (administrateur), si `ALLOW_REGISTRATION` |
| DELETE | `/v1/households/:id` | admin | Arrête le partage : efface le foyer du serveur |
| POST | `/v1/households/:id/invites` | admin | Crée un code d'invitation à usage unique |
| POST | `/v1/invites/join` | sans jeton | Dépose une demande d'ajout `{inviteCode, deviceName, publicKey}` → `requestId`, `deviceToken` (inactif jusqu'à validation) |
| GET | `/v1/join-requests/:requestId` | demandeur | État de sa demande ; une fois validée : `deviceId`, `role`, `sealedKey` |
| GET | `/v1/households/:id/join-requests` | admin | Demandes en attente (nom, clé publique) |
| POST | `/v1/households/:id/join-requests/:requestId/approve` | admin | Valide `{role, sealedKey}` |
| POST | `/v1/households/:id/join-requests/:requestId/reject` | admin | Refuse |
| GET | `/v1/households/:id/devices` | tous | Appareils du foyer et leurs rôles |
| PATCH | `/v1/households/:id/devices/:deviceId` | soi-même (nom), admin (nom, rôle) | Renomme, change le rôle |
| DELETE | `/v1/households/:id/devices/:deviceId` | soi-même, admin | Quitte le partage, ou révoque un appareil |
| POST | `/v1/households/:id/changes` | admin, member | Envoie jusqu'à 500 modifications chiffrées `{id, nonce, ciphertext}` ; un `id` déjà reçu est ignoré |
| GET | `/v1/households/:id/changes?since=<seq>&limit=<n>` | tous | Lit le journal après le curseur `since` → `changes`, `cursor`, `hasMore` |

## Licence

[GNU Affero General Public License v3.0](LICENSE) — Copyright (c) 2026 TonioBDS.
