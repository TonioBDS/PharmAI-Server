# Consignes pour ce dépôt (PharmAI-Server)

- Licence AGPL-3.0-only. Ce code ne doit jamais être copié dans PharmAI-App (propriétaire).
  Le code commun futur (format des modifications, chiffrement) ira dans un paquet séparé sous MIT.
- Principe central : le serveur ne lit jamais le contenu des armoires. Il stocke des blocs
  chiffrés (`nonce`, `ciphertext`) et les métadonnées minimales de routage. Ne jamais ajouter
  de champ en clair décrivant des médicaments, des personnes ou des symptômes.
- Jamais de jeton, de code d'invitation ni de contenu dans les journaux ; seuls leurs hachés
  SHA-256 sont stockés.
- Deux moteurs (SQLite par défaut, PostgreSQL) : SQL commun (`$1`, dates ISO passées par le code),
  toujours via l'interface `Db`. Migrations dans `src/db.ts`, une liste par moteur : ajouter une entrée
  aux deux, ne jamais modifier une entrée publiée.
- Validation des entrées par les schémas JSON de Fastify sur chaque route.
- Textes, commentaires et messages en français.

## Avant de livrer

```bash
npm run typecheck
npm test                                    # SQLite en mémoire
TEST_DATABASE_URL=postgres://… npm test     # + PostgreSQL : base jetable, vidée par les tests
docker build -t pharmai-server .
```
