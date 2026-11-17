# Synchroniser hors de la maison, en sécurité

Par défaut, le serveur n'est joignable que depuis le Wi-Fi de la maison : les téléphones gardent
leurs modifications en route et les envoient au retour. C'est un mode normal. Ce guide explique
comment synchroniser **de partout** sans exposer la maison.

## Ce qu'il faut protéger

- **Le contenu des armoires** est chiffré par les téléphones avant l'envoi : le serveur, et
  quiconque l'écouterait, ne voit que des blocs illisibles. Rien à faire de ce côté.
- **Les jetons des téléphones** (ce qui prouve qu'un téléphone fait partie du foyer) passent à
  chaque requête. En HTTP simple sur Internet, ils circulent en clair : quelqu'un qui les
  intercepte pourrait se faire passer pour un téléphone (il ne lirait toujours rien, mais pourrait
  envoyer des données illisibles ou effacer des photos du foyer).
- **La machine de la maison** : ouvrir un port sur la box, c'est exposer un service à tout
  Internet, qui le testera en permanence.

D'où la règle : **le trafic passe dans un tunnel chiffré, ou en HTTPS ; jamais de HTTP ouvert
sur Internet.**

## Choisir

| Solution | Port à ouvrir sur la box | Difficulté | Pour qui |
| --- | --- | --- | --- |
| **Tailscale** (recommandé) | Aucun | Facile | Tout le monde, y compris derrière une box 4G/5G ou une IP partagée |
| **WireGuard** (à héberger soi-même) | Un port UDP | Moyenne | Ceux qui veulent tout maîtriser, sans compte chez un tiers |
| **Proxy HTTPS public** (Caddy, Traefik, Nginx Proxy Manager) | 443 (et 80) | Moyenne | Ceux qui ont déjà un nom de domaine et un proxy en place |

> **Une seule adresse pour tout le foyer.** L'adresse du serveur est saisie à la création du
> partage et transmise aux autres téléphones par les invitations et le kit de secours ; on ne
> peut pas encore la changer ensuite. Choisissez donc **avant de créer le partage** une adresse
> qui marche à la maison comme dehors (le nom Tailscale, ou votre nom de domaine). Pour passer
> d'une adresse locale à une adresse distante sur un partage existant : supprimer le partage
> (chaque téléphone garde ses données) et le recréer avec la nouvelle adresse.

## Tailscale (recommandé)

Tailscale relie vos appareils par des tunnels WireGuard chiffrés, sans rien ouvrir sur la box
(il traverse aussi les box 4G/5G et les IP partagées). Le plan gratuit suffit pour un foyer.
Tailscale ne voit pas votre trafic, seulement quels appareils se connectent.

1. **Sur la machine du serveur** (Linux, NAS, mini-PC) :
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up            # ouvre un lien pour vous connecter à votre compte
   tailscale ip -4              # adresse 100.x.y.z de la machine
   ```
   Dans la console Tailscale (DNS), laissez **MagicDNS** activé : la machine a alors un nom
   stable du type `serveur.tailXXXX.ts.net`.
2. **Sur chaque téléphone** : application Tailscale (Play Store, App Store), connexion au même
   réseau Tailscale. Un membre de la famille avec son propre compte : invitez-le dans votre
   réseau, ou partagez-lui seulement la machine du serveur (« Share » dans la console).
   Seul le trafic vers vos machines passe par Tailscale ; le reste va directement sur Internet.
   Sur Android, activez « VPN permanent » pour que le tunnel reste toujours actif.
3. **Adresse dans PharmAI** : `http://serveur.tailXXXX.ts.net:8080` (le tunnel chiffre déjà tout).
   Elle marche aussi à la maison, où Tailscale passe directement par le réseau local.

**En HTTPS en plus (facultatif)** : dans la console Tailscale, DNS › activer « HTTPS
Certificates », puis sur la machine :

```bash
sudo tailscale serve --bg 8080
```

L'adresse devient `https://serveur.tailXXXX.ts.net` (sans port), avec un certificat valide,
toujours joignable seulement depuis vos appareils Tailscale.

**Home Assistant OS** : installez l'app officielle **Tailscale** de Home Assistant (Paramètres ›
Apps › Boutique d'apps), connectez-la, puis utilisez `http://homeassistant.tailXXXX.ts.net:8080`
(ou le port choisi dans la configuration de PharmAI Server). L'accès à distance Nabu Casa, lui,
ne transmet que l'interface de Home Assistant, pas ce serveur.

**Vérifier** : téléphone en 4G (Wi-Fi coupé), Tailscale actif, ouvrez l'adresse suivie de
`/health` dans le navigateur : `{"ok":true}` doit s'afficher. Puis dans PharmAI, tirez la liste
vers le bas pour synchroniser.

## WireGuard, hébergé chez soi

Même chiffrement que Tailscale, mais vous gérez tout : pas de compte chez un tiers, en échange
d'un port à ouvrir et d'un peu de configuration.

1. **Serveur WireGuard** sur une machine de la maison : le plus simple est le conteneur
   [wg-easy](https://github.com/wg-easy/wg-easy) (interface web pour créer un accès par
   téléphone et afficher son QR code). Beaucoup de box et de routeurs (Freebox, OpenWrt,
   pfSense…) intègrent aussi un serveur WireGuard.
2. **Box** : redirigez le port UDP choisi (51820 par défaut) vers cette machine. WireGuard ne
   répond à aucun paquet qui n'est pas signé par une clé connue : le port reste muet pour le
   reste d'Internet.
3. **Adresse publique** : si l'IP de la box change, utilisez un nom dynamique (DynDNS de la box,
   DuckDNS…). Derrière une IP partagée (certaines box 4G/5G, « IP full-stack » non attribuée),
   un serveur WireGuard n'est pas joignable : préférez Tailscale.
4. **Téléphones** : application WireGuard, scannez le QR code de chaque accès. Pour ne faire
   passer que le trafic de la maison, mettez dans « Allowed IPs » le réseau local seulement
   (par exemple `192.168.1.0/24`) plutôt que `0.0.0.0/0`.
5. **Adresse dans PharmAI** : l'adresse locale du serveur (`http://192.168.1.20:8080`) ; elle
   marche à la maison, et dehors à travers le tunnel. À la maison, laissez le tunnel
   désactivé ou vérifiez que votre box accepte le « retour » vers sa propre adresse (NAT
   loopback).

## Proxy HTTPS public

Le serveur est alors joignable par tout Internet, en HTTPS. C'est acceptable (le contenu est
chiffré, les jetons et invitations ne sont stockés que hachés, la création de foyers se ferme),
mais c'est la solution la plus exposée : réservez-la à ceux qui maintiennent déjà ce genre
d'installation.

Exemple avec [Caddy](https://caddyserver.com), qui obtient et renouvelle seul le certificat
Let's Encrypt (nom de domaine pointant vers la box, ports 80 et 443 redirigés vers Caddy) :

```
pharmai.example.fr {
    reverse_proxy 127.0.0.1:8080
}
```

Dans le `docker-compose.yml`, publiez alors le port du serveur seulement en local
(`"127.0.0.1:${PORT:-8080}:8080"` au lieu de `"${PORT:-8080}:8080"`) pour qu'il ne soit
joignable qu'à travers le proxy. Le serveur lit
déjà l'adresse d'origine transmise par le proxy (`X-Forwarded-For`) pour limiter les
tentatives par adresse.

Variante sans port ouvert : **Cloudflare Tunnel** (`cloudflared`). Cloudflare termine alors le
HTTPS et voit passer les jetons (jamais le contenu, chiffré par les téléphones).

**Dans tous les cas** :

- `ALLOW_REGISTRATION=false` dès votre foyer créé (sinon n'importe qui peut créer un partage
  sur votre serveur) ;
- mises à jour régulières (Watchtower, What's Up Docker, ou `docker compose pull`) ;
- adresse en `https://` dans PharmAI : l'app prévient si vous saisissez une adresse `http://`.

## Récapitulatif

- Le plus simple et le plus sûr : **Tailscale**, adresse `http://<machine>.<réseau>.ts.net:8080`,
  aucun port ouvert.
- Ne jamais rediriger directement le port 8080 de la box vers le serveur.
- Choisir l'adresse définitive avant de créer le partage.
