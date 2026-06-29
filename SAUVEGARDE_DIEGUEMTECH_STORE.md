# Guide de sauvegarde DieguemTech Store

Date de creation : 29 juin 2026

Ce guide explique comment sauvegarder le site DieguemTech Store sans exposer les commandes clients, les donnees personnelles ou les cles API.

## 1. Ce qu'il faut sauvegarder

Il y a trois choses importantes :

- Le code source : deja conserve sur GitHub.
- Les donnees de boutique : produits, commandes, analytics, exports admin.
- La base PostgreSQL Render : sauvegarde complete de la base.

Important : les sauvegardes peuvent contenir des noms, telephones, adresses et commandes. Elles ne doivent pas etre envoyees dans GitHub.

## 2. Sauvegarde admin depuis le site

Cette sauvegarde est la plus simple pour garder une copie lisible du site.

Etapes :

1. Ouvrir `https://dieguemtechstore.com/admin`.
2. Se connecter avec `ADMIN_PASSWORD`.
3. Aller dans l'onglet `Sauvegarde`.
4. Choisir la periode analytics.
5. Cliquer sur `Telecharger sauvegarde`.
6. Garder le fichier JSON dans un dossier prive.

Cette sauvegarde contient notamment :

- commandes,
- produits,
- analytics,
- statut des integrations,
- date de generation.

Elle ne doit pas contenir les cles secretes Render.

## 3. Sauvegarde admin par script Windows

Un script a ete ajoute pour telecharger l'export admin automatiquement :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-admin-backup.ps1
```

Le script demande `ADMIN_PASSWORD`, se connecte a l'admin, puis telecharge un fichier dans :

```text
backups/
```

Le dossier `backups/` est volontairement ignore par Git pour eviter d'envoyer des donnees clients sur GitHub.

Options utiles :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-admin-backup.ps1 -AnalyticsDays 365
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-admin-backup.ps1 -SiteUrl "https://dieguemtechstore.com" -OutputDir "C:\Users\IBOU\Documents\Sauvegardes-DieguemTech"
```

## 4. Sauvegarde PostgreSQL Render

Render propose des sauvegardes selon le type de base et le plan utilise.

Methode recommandee dans Render :

1. Ouvrir le dashboard Render.
2. Aller dans la base PostgreSQL de DieguemTech Store.
3. Ouvrir la partie `Recovery` ou `Backups`.
4. Creer ou telecharger un export disponible.
5. Conserver le fichier dans un dossier prive.

Selon la documentation Render, les exports logiques sont crees depuis la page `Recovery` de la base, puis restent disponibles temporairement. Voir la documentation officielle :

https://render.com/docs/postgresql-backups

Si la base est sur un plan qui ne donne pas acces aux sauvegardes automatiques, utiliser un export `pg_dump` depuis un ordinateur qui possede PostgreSQL installe.

Exemple general :

```bash
pg_dump "DATABASE_URL" > dieguemtech-store-db-backup.sql
```

Ne jamais mettre `DATABASE_URL` dans un fichier public.

## 5. Frequence conseillee

- Avant chaque grosse modification du site : sauvegarde admin.
- Une fois par semaine : sauvegarde admin.
- Une fois par mois : sauvegarde PostgreSQL Render.
- Avant suppression massive de commandes : sauvegarde admin + base PostgreSQL.

## 6. Ou garder les sauvegardes

Emplacements recommandes :

- disque local personnel,
- cle USB,
- disque externe,
- stockage cloud prive.

Eviter :

- GitHub,
- captures publiques,
- groupes WhatsApp,
- ordinateur partage sans mot de passe.

## 7. Verification rapide apres sauvegarde

Apres telechargement :

1. Verifier que le fichier existe.
2. Verifier que sa taille n'est pas 0 Ko.
3. Ouvrir le fichier dans un editeur texte pour verifier qu'il commence par `{`.
4. Ne pas modifier le fichier original.
5. Conserver une copie datee.

## 8. Restauration

La restauration depend du type de sauvegarde :

- Sauvegarde admin JSON : utile pour consultation, audit, reprise manuelle de commandes et produits.
- Sauvegarde PostgreSQL : utile pour restaurer toute la base.
- GitHub : utile pour restaurer le code source du site.

Avant toute restauration de base, faire une nouvelle sauvegarde de l'etat actuel.

## 9. Regle importante

Une sauvegarde est utile seulement si elle est :

- recente,
- lisible,
- conservee hors du site,
- protegee,
- testee de temps en temps.

