---
title: Politique de confidentialité
lang: fr
permalink: /confidentialite/
---

# Politique de confidentialité de PharmAI

*Dernière mise à jour : 12 novembre 2026* · [English version](../privacy/)

PharmAI est une application d’armoire à pharmacie pour Android et iPhone. Elle est conçue
pour que vos données de santé restent chez vous.

## En bref

- **Vos données restent sur votre téléphone.** Armoire, foyer, prises, ordonnances, photos et
  rappels sont enregistrés uniquement sur l’appareil. Nous n’y avons pas accès.
- **Pas de compte, pas de publicité, pas de traceur, pas de mesure d’audience.**
- **Partage facultatif et chiffré de bout en bout**, via un serveur que vous choisissez
  (le vôtre). Ce serveur ne peut pas lire vos données.
- **Quelques services extérieurs** sont contactés seulement quand vous utilisez la fonction
  correspondante (pharmacies proches, photo d’un produit) ; ils sont listés plus bas.
- **Tout effacer** à tout moment : Réglages › Sauvegarde, export et réinitialisation.

## Qui sommes-nous

PharmAI est développée par [NOM DU DÉVELOPPEUR], développeur indépendant.
Contact : [ADRESSE E-MAIL DE CONTACT].

À ce jour, nous n’exploitons aucun serveur qui recevrait vos données : nous ne sommes donc pas
destinataires de vos données personnelles.

## Les données enregistrées sur votre téléphone

L’application enregistre, dans sa propre base sur l’appareil :

- les produits de votre armoire (nom, quantités, dates de péremption, numéros de lot, photos,
  notes, étiquettes) ;
- les personnes et animaux du foyer que vous ajoutez (prénom, profil adulte/enfant/animal) ;
- les prises enregistrées, les rappels programmés et les ordonnances (photo ou PDF et
  médicaments reconnus) ;
- vos réglages.

Ces informations peuvent être des **données de santé**. Elles ne quittent pas votre téléphone,
sauf si vous activez le partage (voir plus bas) ou si vous exportez vous-même une sauvegarde.

La lecture du code des boîtes et du texte des ordonnances se fait **sur le téléphone**. Sur
Android, la lecture de texte utilise la bibliothèque ML Kit de Google, qui fonctionne sans
envoyer les images ni le texte ; Google indique que ML Kit peut transmettre des statistiques
anonymes d’utilisation de la bibliothèque (performances, erreurs). Sur iPhone, la lecture
utilise les fonctions intégrées d’Apple.

## Les autorisations demandées

| Autorisation | Pourquoi | Quand |
|---|---|---|
| Caméra | Lire le code des boîtes, photographier un produit ou une ordonnance | Quand vous scannez ou prenez une photo |
| Photos / fichiers | Choisir une photo de produit ou le PDF d’une ordonnance | Seulement les éléments que vous choisissez |
| Notifications | Rappels de prise, péremptions, stock bas | Programmées sur le téléphone, sans serveur |
| Localisation (approximative suffit) | Trouver les pharmacies proches | Seulement quand vous lancez la recherche |

L’application n’utilise ni le micro, ni la localisation en arrière-plan, ni vos contacts.

## Les services extérieurs contactés

Ces services ne sont contactés que lorsque vous utilisez la fonction correspondante.
Leurs propres politiques de confidentialité s’appliquent.

| Fonction | Service | Ce qui est transmis |
|---|---|---|
| Pharmacies proches | Serveurs publics d’[OpenStreetMap](https://wiki.openstreetmap.org/wiki/Overpass_API) (Overpass) | Votre position au moment de la recherche, et le rayon de recherche |
| Photo d’un produit non médicamenteux | [Open Food Facts](https://world.openfoodfacts.org/privacy) et ses projets frères | Le code-barres du produit |
| Notice officielle | [Base de données publique des médicaments](https://base-donnees-publique.medicaments.gouv.fr) (ouverte dans votre navigateur) | Le code du médicament |
| Recherche d’image, fiche d’une pharmacie | Google (ouvert dans votre navigateur ou Google Maps) | Le nom du produit ou de la pharmacie |
| Pharmacie de garde | 3237.fr (ouvert dans votre navigateur) | Rien, sauf ce que vous y saisissez |

Nous ne recevons aucune de ces informations.

## Le partage entre téléphones (facultatif)

Vous pouvez partager l’armoire entre plusieurs téléphones (famille, aidant) via un serveur
PharmAI. Aujourd’hui, ce serveur est **celui que vous installez vous-même** (logiciel libre,
[code source](https://github.com/TonioBDS/PharmAI-Server)) : son exploitant est la personne qui
l’a installé, pas nous.

- Tout ce qui part vers le serveur est **chiffré sur les téléphones** avec une clé propre à
  votre foyer, que le serveur ne connaît pas. Le serveur ne peut lire ni les médicaments, ni les
  personnes, ni les prises, ni les photos.
- Le serveur conserve, en clair, seulement ce qui lui sert à acheminer les données : les noms
  que vous donnez aux téléphones, leurs rôles, les dates de connexion, des identifiants
  techniques et, dans ses journaux, l’adresse IP des connexions.
- Un administrateur peut choisir quelles personnes du foyer sont partagées avec chaque
  téléphone ; les autres ne lui sont pas transmises.
- Le **kit de secours** (code et QR code) permet de retrouver le partage si le téléphone
  administrateur est perdu. Le serveur n’en garde qu’une empreinte : gardez le kit en lieu sûr.

Une offre hébergée (PharmAI Cloud) est en préparation. Elle n’est pas encore disponible ; cette
politique sera mise à jour avant son ouverture.

## Sauvegardes et exports

Les sauvegardes et exports que vous créez (Réglages › Sauvegarde) sont des fichiers **non
chiffrés**, que vous enregistrez ou envoyez où vous le décidez. Rangez-les en lieu sûr.

## Durée de conservation et suppression

- Sur le téléphone : tant que l’application est installée. **Réglages › Sauvegarde, export et
  réinitialisation › Tout effacer** supprime tout ; désinstaller l’application aussi.
- Sur un serveur de partage : jusqu’à ce que l’administrateur supprime le partage
  (Réglages › Partage › Supprimer le partage pour tous), que le dernier téléphone le quitte, ou
  que le serveur l’efface après une longue inactivité si son exploitant l’a réglé ainsi.

## Vos droits

Comme nous ne détenons pas vos données, vous les gérez directement dans l’application :
consultation, modification, export et effacement. Pour un serveur de partage, adressez-vous à
la personne qui l’exploite. Pour toute question : [ADRESSE E-MAIL DE CONTACT]. Vous pouvez aussi
saisir l’autorité de protection des données de votre pays (en France, la
[CNIL](https://www.cnil.fr/fr/plaintes)).

## Enfants

Vous pouvez ajouter des enfants à votre foyer pour suivre leurs traitements. L’application est
destinée à être utilisée par des adultes.

## Information médicale

PharmAI affiche des informations officielles (notices) et vos propres notes. Elle ne remplace
pas l’avis d’un médecin ou d’un pharmacien et ne recommande aucune dose ni aucun traitement.

## Modifications

Toute modification de cette politique est publiée sur cette page, avec sa date. Les
changements importants seront signalés dans l’application.
