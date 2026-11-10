# Déployer le serveur PharmAI sur une machine de la maison (pas à pas)

Pour une VM, un NAS ou un mini-PC qui fait déjà tourner d'autres conteneurs Docker.
Durée : 10 minutes environ. Rien ici n'a besoin d'être ouvert sur Internet.

## 1. Prérequis

Sur la machine (en SSH) :

```bash
docker --version          # Docker 20 ou plus
docker compose version    # le plugin « compose » (v2)
```

Notez l'adresse IP **complète** de la machine sur le réseau de la maison (quatre nombres,
par exemple `192.168.31.40`) :

```bash
hostname -I
```

## 2. Choisir un port libre

Le serveur écoute dans le conteneur sur le port 8080 ; vous choisissez le port de la machine.
Vérifiez qu'il n'est pas déjà pris par un autre conteneur ou service :

```bash
# Ports déjà publiés par vos conteneurs
docker ps --format 'table {{.Names}}\t{{.Ports}}'
# Tous les ports en écoute sur la machine (rien ne doit s'afficher pour le port choisi)
sudo ss -tlnp | grep ':8080 '
```

Si 8080 est pris, prenez-en un autre, par exemple 8095 (`sudo ss -tlnp | grep ':8095 '` ne
doit rien afficher). Dans la suite, ce port est noté **PORT**.

## 3. Récupérer le code

Le dépôt est privé : utilisez votre compte GitHub (`gh auth login`, ou un jeton d'accès
personnel en guise de mot de passe).

```bash
cd ~
git clone https://github.com/TonioBDS/PharmAI-Server.git pharmai-server
cd pharmai-server
```

## 4. Régler et démarrer

Créez un fichier `.env` à côté de `docker-compose.yml` :

```bash
cat > .env <<'CONF'
# Port de la machine (étape 2)
PORT=8095
# Laisser à true le temps de créer votre foyer, puis passer à false (étape 7)
ALLOW_REGISTRATION=true
LOG_LEVEL=info
CONF
```

Puis construisez et démarrez (la première construction prend quelques minutes) :

```bash
docker compose up -d --build
docker compose ps          # l'état doit passer à « healthy » au bout de ~30 s
```

Le projet s'appelle `pharmai` : le conteneur et son volume de données (`pharmai_data`) ne
se mélangent pas avec vos autres conteneurs.

## 5. Vérifier

Sur la machine :

```bash
curl http://localhost:PORT/health
```

Puis **depuis le téléphone**, connecté au Wi-Fi de la maison, ouvrez dans le navigateur
`http://192.168.31.40:PORT/health` (votre IP et votre port). Dans les deux cas, on doit lire
`{"status":"ok","version":"0.3.0",…}`.

Si le téléphone n'y arrive pas alors que `curl` fonctionne sur la machine :

- pare-feu de la VM : `sudo ufw status` ; si actif, `sudo ufw allow PORT/tcp` ;
- VM en réseau « NAT » : passez sa carte réseau en mode « pont » (bridge), pour qu'elle ait
  une adresse sur le réseau de la maison ;
- Wi-Fi « invités » du téléphone : il est souvent isolé du reste du réseau.

## 6. Créer le partage dans l'app

Sur votre téléphone : Réglages › Partage › Créer un partage, adresse
`192.168.31.40:PORT` (sans `http://`, l'app l'ajoute). Puis invitez les autres téléphones
(voir le plan de tests).

Astuce : réservez l'adresse IP de la VM dans votre box (bail DHCP fixe), sinon elle peut
changer et les téléphones ne trouveront plus le serveur.

## 7. Fermer les inscriptions

Une fois votre foyer créé, plus personne n'a besoin d'en créer un sur votre serveur :

```bash
sed -i 's/^ALLOW_REGISTRATION=.*/ALLOW_REGISTRATION=false/' .env
docker compose up -d
```

Les téléphones déjà dans le partage et les invitations continuent de fonctionner.

## 8. Au quotidien

| Pour… | Commande (dans `~/pharmai-server`) |
| --- | --- |
| Voir les journaux | `docker compose logs -f --tail=100` |
| Mettre à jour | `git pull && docker compose up -d --build` |
| Arrêter / relancer | `docker compose stop` / `docker compose start` |
| Sauvegarder | `docker run --rm -v pharmai_data:/data -v "$PWD":/backup alpine tar czf /backup/pharmai-$(date +%F).tgz -C /data .` |
| Restaurer | `docker compose stop && docker run --rm -v pharmai_data:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/pharmai-AAAA-MM-JJ.tgz -C /data" && docker compose start` |

La sauvegarde ne contient que des données chiffrées par les téléphones : sans un téléphone du
partage, personne ne peut la lire.

Le conteneur redémarre tout seul avec la machine (`restart: unless-stopped`).

## 9. Hors de la maison (facultatif)

Sans rien de plus, les téléphones se synchronisent quand ils sont sur le Wi-Fi de la maison,
et gardent leurs modifications en attendant. Pour synchroniser de partout, installez un
tunnel chiffré (Tailscale ou WireGuard) sur la VM et les téléphones, et utilisez l'adresse
du tunnel dans l'app. N'ouvrez pas le port sur la box.

## Si vous utilisez Portainer

Stacks › Add stack › « Repository », URL du dépôt (avec vos identifiants GitHub), fichier
`docker-compose.yml`, et dans « Environment variables » : `PORT`, `ALLOW_REGISTRATION`.
