# PharmAI Server

Cette app fait tourner le serveur de partage de l'application **PharmAI** sur votre
Home Assistant. Les téléphones du foyer s'y synchronisent ; tout est **chiffré sur les
téléphones** : le serveur ne peut lire ni les médicaments, ni les personnes, ni les prises.

## Démarrer

1. Installez l'app, puis **Démarrer**. Le journal (onglet **Journal**) doit indiquer « Server listening ».
2. Notez l'adresse IP de Home Assistant : **Paramètres › Système › Réseau** (ex. `192.168.1.30`).
3. Dans l'app PharmAI : **Réglages › Partage › Créer un partage**, adresse du serveur
   `192.168.1.30:8080`.
4. Une fois le partage créé, revenez dans l'onglet **Configuration** de l'app et désactivez
   **Autoriser la création de partages** : personne d'autre ne pourra créer de partage sur
   votre serveur. Les téléphones que vous invitez depuis l'app peuvent toujours le rejoindre.

## Options

| Option | Rôle |
| --- | --- |
| Autoriser la création de partages | `true` le temps de créer votre partage, puis `false`. |
| Effacer les partages inactifs (jours) | Efface un partage dont aucun téléphone ne s'est connecté depuis ce nombre de jours (les téléphones gardent leurs données, l'app prévient un mois avant). `0` : jamais. |
| Niveau de journalisation | `info` par défaut. Le contenu des armoires n'apparaît jamais dans les journaux. |

Le port (8080 par défaut) se change dans la section **Réseau** de l'onglet Configuration ;
reportez-le alors dans l'adresse saisie dans l'app.

## Hors de la maison

Sans rien de plus, les téléphones se synchronisent sur le Wi-Fi de la maison et gardent leurs
modifications en attendant. Pour synchroniser de partout, installez l'app **Tailscale** de
Home Assistant et Tailscale sur les téléphones, puis utilisez l'adresse Tailscale de
Home Assistant dans l'app PharmAI (par exemple `http://homeassistant.tailXXXX.ts.net:8080`).
N'ouvrez pas le port sur votre box. Pas à pas et autres solutions :
[guide d'accès distant](https://github.com/TonioBDS/PharmAI-Server/blob/main/docs/ACCES-DISTANT.md).
Choisissez cette adresse avant de créer le partage : elle ne se change pas ensuite.

L'accès à distance de Home Assistant (Nabu Casa) ne transmet que l'interface de
Home Assistant : il ne donne pas accès à ce serveur.

## Sauvegarde et mises à jour

- Les **sauvegardes de Home Assistant** incluent la base du serveur (`pharmai.db`). L'app est
  arrêtée quelques secondes pendant la sauvegarde, pour copier la base au repos ; les téléphones
  renvoient leurs modifications à la synchronisation suivante.
- Les **mises à jour** apparaissent dans Home Assistant comme pour les autres apps.

## Kit de secours

À la création du partage, l'app PharmAI propose un **kit de secours** (code et QR code).
Gardez-le hors du téléphone : si le dernier téléphone administrateur est perdu, il permet de
retrouver le partage sur un nouveau téléphone.

## Ce que l'app ne fait pas

Le serveur ne sait pas lire les armoires : il n'y a donc ni capteur ni tableau de bord PharmAI
dans Home Assistant. C'est voulu.

## Aide

Code source, licence (AGPL-3.0) et suivi des problèmes :
https://github.com/TonioBDS/PharmAI-Server

---

## In English

1. Install and start the app. Note Home Assistant's IP address (Settings › System › Network).
2. In the PharmAI app: Settings › Sharing › Create a share, server address `<IP>:8080`.
3. Then turn off **Allow creating shares** in the app's Configuration tab: invited phones can
   still join. To sync away from home, use the Tailscale app rather than opening a port.
   Home Assistant backups include the server database; the server cannot read it.
