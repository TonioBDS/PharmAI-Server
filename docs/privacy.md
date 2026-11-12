---
title: Privacy policy
lang: en
permalink: /privacy/
---

# PharmAI privacy policy

*Last updated: 12 November 2026* · [Version française](../confidentialite/)

PharmAI is a medicine cabinet app for Android and iPhone. It is designed so that your health
data stays with you.

## In short

- **Your data stays on your phone.** Cabinet, household, doses, prescriptions, photos and
  reminders are stored only on the device. We have no access to them.
- **No account, no ads, no trackers, no analytics.**
- **Optional, end-to-end encrypted sharing**, through a server you choose (your own). That
  server cannot read your data.
- **A few outside services** are contacted only when you use the matching feature (nearby
  pharmacies, product photo); they are listed below.
- **Erase everything** at any time: Settings › Backup, export and reset.

## Who we are

PharmAI is developed by [DEVELOPER NAME], an independent developer.
Contact: [CONTACT EMAIL ADDRESS].

To date, we do not run any server that would receive your data, so we do not receive your
personal data.

## Data stored on your phone

The app stores, in its own database on the device:

- the products in your cabinet (name, quantities, expiry dates, batch numbers, photos, notes,
  tags);
- the people and pets in the household that you add (first name, adult/child/pet profile);
- recorded doses, scheduled reminders and prescriptions (photo or PDF and recognised
  medicines);
- your settings.

This information may be **health data**. It does not leave your phone unless you turn on
sharing (see below) or export a backup yourself.

Reading box codes and prescription text happens **on the phone**. On Android, text reading
uses Google's ML Kit library, which works without sending the images or the text; Google states
that ML Kit may send anonymous statistics about the library's use (performance, errors). On
iPhone, reading uses Apple's built-in features.

## Permissions requested

| Permission | Why | When |
|---|---|---|
| Camera | Read box codes, photograph a product or a prescription | When you scan or take a photo |
| Photos / files | Pick a product photo or a prescription PDF | Only the items you choose |
| Notifications | Dose, expiry and low-stock reminders | Scheduled on the phone, no server |
| Location (approximate is enough) | Find nearby pharmacies | Only when you start the search |

The app does not use the microphone, background location or your contacts.

## Outside services contacted

These services are contacted only when you use the matching feature. Their own privacy
policies apply.

| Feature | Service | What is sent |
|---|---|---|
| Nearby pharmacies | Public [OpenStreetMap](https://wiki.openstreetmap.org/wiki/Overpass_API) servers (Overpass) | Your position at the time of the search, and the search radius |
| Photo of a non-medicine product | [Open Food Facts](https://world.openfoodfacts.org/privacy) and its sister projects | The product barcode |
| Official leaflet | French [public medicines database](https://base-donnees-publique.medicaments.gouv.fr) (opened in your browser) | The medicine code |
| Image search, pharmacy page | Google (opened in your browser or Google Maps) | The product or pharmacy name |
| On-duty pharmacy (France) | 3237.fr (opened in your browser) | Nothing, except what you type there |

We receive none of this information.

## Sharing between phones (optional)

You can share the cabinet between several phones (family, carer) through a PharmAI server.
Today, this server is **one you install yourself** (free software,
[source code](https://github.com/TonioBDS/PharmAI-Server)): its operator is whoever installed
it, not us.

- Everything sent to the server is **encrypted on the phones** with a key specific to your
  household, which the server does not know. The server cannot read the medicines, people,
  doses or photos.
- The server keeps in clear only what it needs to route data: the names you give the phones,
  their roles, connection dates, technical identifiers and, in its logs, the IP address of
  connections.
- An administrator can choose which household members are shared with each phone; the others
  are not sent to it.
- The **recovery kit** (code and QR code) lets you recover the share if the administrator phone
  is lost. The server only keeps a fingerprint of it: keep the kit somewhere safe.

A hosted offer (PharmAI Cloud) is in preparation. It is not available yet; this policy will be
updated before it opens.

## Backups and exports

The backups and exports you create (Settings › Backup) are **unencrypted** files that you save
or send wherever you decide. Keep them somewhere safe.

## Retention and deletion

- On the phone: as long as the app is installed. **Settings › Backup, export and reset › Erase
  everything** deletes it all; so does uninstalling the app.
- On a sharing server: until the administrator deletes the share (Settings › Sharing › Delete
  the share for everyone), the last phone leaves it, or the server erases it after a long
  period of inactivity if its operator has set it up that way.

## Your rights

As we do not hold your data, you manage it directly in the app: viewing, editing, exporting and
erasing. For a sharing server, contact the person who runs it. For any question:
[CONTACT EMAIL ADDRESS]. You can also contact the data protection authority of your country.

## Children

You can add children to your household to track their treatments. The app is intended to be
used by adults.

## Medical information

PharmAI shows official information (leaflets) and your own notes. It does not replace the
advice of a doctor or pharmacist and never recommends a dose or a treatment.

## Changes

Any change to this policy is published on this page, with its date. Significant changes will
be announced in the app.
