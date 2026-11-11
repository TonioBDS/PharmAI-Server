# PharmAI Server

Serveur de synchronisation **chiffrée de bout en bout** pour l'application PharmAI :
il relaie les modifications entre les appareils d'un foyer (famille, aidant) sans pouvoir
les lire. Le contenu des armoires est chiffré sur les téléphones ; le serveur ne voit que
des blocs opaques, des identifiants d'appareils et des jetons hachés.

Licence **AGPL-3.0** : vous pouvez l'héberger vous-même, le modifier et le redistribuer ;
si vous proposez une version modifiée à d'autres via un réseau, vous devez en publier le code.

## Démarrer chez soi (Docker)

**Guide pas à pas (port, pare-feu, sauvegarde, mise à jour) : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).**

Un seul conteneur, base **SQLite** dans un volume : convient à un Raspberry Pi, un NAS ou un mini-PC.

```bash
docker compose up -d --build
curl http://localhost:8080/health
```

Dans l'app : Réglages → Partage → « Créer un partage », avec l'adresse du serveur
(ex. `http://192.168.1.20:8080`). Une fois votre foyer créé, passez `ALLOW_REGISTRATION=false`
(fichier `.env`) : plus personne ne peut créer de foyer, seules les invitations validées fonctionnent.

- **Réseau local seulement** : c'est un mode normal. Donnez à l'app l'adresse locale du serveur ;
  hors de chez vous elle garde les modifications et les envoie d'elle-même au retour sur le Wi-Fi.
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

Un administrateur peut changer le rôle d'un membre ou d'un lecteur, et les retirer. Il ne peut ni
rétrograder ni retirer un **autre administrateur** : chacun ne peut que se rétrograder ou partir
lui-même, tant qu'il en reste un autre. Le dernier appareil qui quitte le partage efface le foyer.

### Clé du foyer et révocation

Chaque téléphone a sa propre paire de clés ; le contenu, lui, est chiffré avec une clé commune au
foyer (sinon les téléphones ne pourraient pas se lire entre eux). Quand un appareil est retiré ou
quitte le partage, le serveur demande un **renouvellement** : le téléphone d'un administrateur crée
une nouvelle clé (nouvelle « époque ») et la dépose chiffrée séparément pour chaque appareil restant.
Les autres la récupèrent à leur synchronisation suivante, sans intervention. L'appareil parti garde
ce qu'il avait déjà reçu, mais ne peut rien lire de la suite, même en obtenant une copie de la base.

Les clés publiques utilisées pour ce renouvellement ne sont pas fournies par le serveur : elles
circulent entre téléphones dans le journal chiffré. Limite connue : à l'ajout d'un téléphone, c'est
l'administrateur qui vérifie le nouveau (code de vérification) ; le nouveau, lui, fait confiance au
serveur pour lui remettre le trousseau scellé par l'administrateur.

### Photos

Les photos (produits, ordonnances) sont envoyées chiffrées, sous un identifiant opaque
(`MAX_BLOB_BYTES`, 3 Mo par défaut). Elles ne sont pas encore effacées du serveur quand une photo est remplacée.

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
`MAX_CHANGE_BYTES` (262144), `MAX_BLOB_BYTES` (3145728), `INVITE_TTL_HOURS` (24), `PUBLIC_RATE_LIMIT` (20 par minute et par adresse), `LOG_LEVEL` (info).

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
| POST | `/v1/households/:id/join-requests/:requestId/approve` | admin | Valide `{role, sealedKey, scopes?}` (`scopes` : personnes partagées, `null` = tout le foyer) |
| POST | `/v1/households/:id/join-requests/:requestId/reject` | admin | Refuse |
| GET | `/v1/households/:id/devices` | tous | Appareils du foyer, leurs rôles et `scopes` ; `keyEpoch`, `rekeyNeeded` |
| PATCH | `/v1/households/:id/devices/:deviceId` | soi-même (nom), admin (nom, rôle, `scopes`) | Renomme, change le rôle ou les personnes partagées |
| DELETE | `/v1/households/:id/devices/:deviceId` | soi-même, admin | Quitte le partage, ou révoque un appareil (jamais un autre administrateur) |
| POST | `/v1/households/:id/keys` | admin | Dépose la clé renouvelée `{epoch, envelopes: [{deviceId, sealedKey}]}` pour tous les appareils restants |
| GET | `/v1/households/:id/keys` | tous | Enveloppes destinées à cet appareil, par époque |
| POST | `/v1/households/:id/changes` | admin, member | Envoie jusqu'à 500 modifications chiffrées `{epoch, changes: [{id, scope?, nonce, ciphertext}]}` ; un `id` déjà reçu est ignoré ; `403 forbidden_scope` hors des personnes partagées ; `409 stale_epoch` si la clé a été renouvelée |
| GET, PUT, DELETE | `/v1/households/:id/blobs/:blobId` | lecture : tous ; écriture : admin, member | Fichier chiffré `{epoch, scope?, nonce, ciphertext}` |
| GET | `/v1/households/:id/blobs` | tous | Identifiants des fichiers présents |
| GET | `/v1/households/:id/changes?since=<seq>&limit=<n>` | tous | Lit le journal après le curseur `since` (seulement le commun et les personnes partagées) → `changes`, `cursor`, `hasMore` ; `scopes=<a,b>` ou `*` et `until=<seq>` pour rattraper des personnes nouvellement partagées |

**Personnes partagées.** Une modification qui concerne une personne du foyer (prise, traitement, ordonnance) porte une `scope` : une empreinte opaque de 32 caractères calculée par les téléphones. Le serveur ne sait pas à qui elle correspond ; il se contente de ne transmettre à chaque appareil que le commun et les portées que l'administrateur lui a ouvertes. Au premier appareil restreint, le serveur note où commence le journal « avec portées » (`scopedSince`, renvoyé avec la liste des appareils ; `snapshotNeeded` à la validation) : un appareil restreint ne lit rien d'antérieur, et l'administrateur renvoie alors tout le foyer, cette fois avec portées.

## Licence

[GNU Affero General Public License v3.0](LICENSE) — Copyright (c) 2026 TonioBDS.
