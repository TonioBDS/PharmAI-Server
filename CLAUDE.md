# Consignes pour ce dépôt (PharmAI-Server)

- Licence AGPL-3.0-only. Ce code ne doit jamais être copié dans PharmAI-App (propriétaire).
  Le code commun futur (format des modifications, chiffrement) ira dans un paquet séparé sous MIT.
- Principe central : le serveur ne lit jamais le contenu des armoires. Il stocke des blocs
  chiffrés (`nonce`, `ciphertext`) et les métadonnées minimales de routage. Ne jamais ajouter
  de champ en clair décrivant des médicaments, des personnes ou des symptômes.
- Jamais de jeton, de code d'invitation ni de contenu dans les journaux ; seuls leurs hachés
  SHA-256 sont stockés.
- Migrations dans `src/db.ts` : ajouter une entrée, ne jamais modifier une entrée publiée.
- Validation des entrées par les schémas JSON de Fastify sur chaque route.
- Textes, commentaires et messages en français.

## Avant de livrer

```bash
npm run typecheck
TEST_DATABASE_URL=postgres://… npm test     # base jetable, vidée par les tests
docker build -t pharmai-server .
```
