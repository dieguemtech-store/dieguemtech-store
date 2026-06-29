# Bilan du projet DieguemTech Store

Date de sauvegarde : 29 juin 2026

Ce document resume le travail realise sur DieguemTech Store depuis le debut du projet. Il sert de dossier de conservation, de passation et de rappel technique. Il ne contient aucune cle API ni mot de passe.

## 1. Identite du projet

- Nom du site : DieguemTech Store
- Activite : boutique e-commerce specialisee High-Tech, Gaming, IPTV, Smartphones, Accessoires, Gadgets electroniques et petit electromenager.
- Domaine principal : https://dieguemtechstore.com
- URL Render : https://dieguemtech-store.onrender.com
- Depot GitHub : https://github.com/dieguemtech-store/dieguemtech-store.git
- Hebergement : Render
- Domaine : LWS, connecte a Render
- Base de donnees : PostgreSQL Render
- Stack technique : Node.js, Express, PostgreSQL, HTML, CSS, JavaScript.

## 2. Design et experience client

Le site a ete construit avec une identite moderne et professionnelle :

- Couleurs principales : orange `#F68B1E`, noir `#313133`, blanc `#FFFFFF`.
- Interface responsive mobile, tablette et ordinateur.
- Header avec logo, recherche, compte, favoris et panier.
- Menu principal : Accueil, Boutique, Smartphones, Gaming, IPTV, Accessoires, Promotions, Contact.
- Page d'accueil complete avec hero, categories, produits populaires, offres, avis clients, FAQ, informations utiles et footer.
- Logo, favicon, manifest PWA et assets de marque ajoutes.

## 3. Catalogue et produits

Les produits initiaux de demo ont ete supprimes. Le catalogue a ete reconstruit avec des produits plus adaptes au commerce :

- Produits High-Tech inspires de Jumia avec marge de 25%.
- Categories ajoutees : Smartphones, Gaming, IPTV, Audio, Montres, Informatique, Accessoires, Electromenager, TV/Videos/Home cinema, Climatisation/Ventilation.
- Produits personnalises ajoutes :
  - Mini projecteur Android intelligent, prix 40 000 FCFA.
  - Ecouteurs TWS semi intra-auriculaires, prix 15 000 FCFA.
- Images produits nettoyees pour eviter les doublons.
- Possibilite d'ajouter jusqu'a 8 images par produit depuis l'admin.
- Images produits cliquables.
- Pages produits completes avec description, galerie, details, produits similaires et bouton de commande.
- Descriptions avec affichage plus propre et possibilite de lire la suite quand le texte est long.

## 4. Navigation boutique

- Clic sur une categorie : ouverture d'une vraie page categorie.
- Gestion des sous-categories.
- Retour progressif vers la categorie precedente puis vers l'accueil.
- Produits cliquables depuis la boutique.
- Recherche produits.
- Liste de souhaits.
- Panier dynamique.
- Apres ajout au panier, le client choisit entre aller au panier ou continuer ses achats.
- Le message de choix panier reste affiche tant que le client n'a pas choisi.
- Message flottant d'assistance WhatsApp ajoute sur le site, avec fermeture memorisee 24h.

## 5. Commande et paiement

La page commande a ete professionnalisee :

- Formulaire client : nom, telephone, email, adresse, zone de livraison.
- Frais de livraison selon zone :
  - Dakar : 1 500 FCFA
  - Pikine : 2 000 FCFA
  - Guediawaye : 2 000 FCFA
  - Rufisque : 2 500 FCFA
  - Thies : 4 000 FCFA
  - Mbour : 4 000 FCFA
  - Autre zone Senegal : 5 000 FCFA
- Modal commande corrigee pour pouvoir defiler et valider sur mobile.
- Suivi commande par numero de commande et telephone.
- Experience commande amelioree avec messages plus clairs.

Moyens de paiement actuellement prevus :

- PayDunya en production.
- Wave via lien de paiement direct.
- Paiement a la livraison.

PayTech a ete retire du site.

Regles importantes :

- PayDunya a un minimum de 6 000 FCFA.
- Pour les commandes inferieures a 6 000 FCFA, le site oriente vers Wave, paiement a la livraison ou WhatsApp.
- Les emails de commande sont envoyes apres confirmation du paiement.
- Pour Wave et paiement a la livraison, le paiement peut rester en attente jusqu'a confirmation/admin selon le cas.

## 6. PayDunya

PayDunya a ete integre avec :

- Creation de facture checkout.
- Redirection vers la page PayDunya.
- Retour paiement reussi.
- Page paiement annule.
- Verification IPN/callback.
- Verification du hash PayDunya.
- Mode production active selon les variables Render.
- Gestion des erreurs PayDunya plus lisible.

Variables Render a garder configurees :

- `PAYDUNYA_MODE`
- `PAYDUNYA_MASTER_KEY`
- `PAYDUNYA_PRIVATE_KEY`
- `PAYDUNYA_TOKEN`
- `PAYDUNYA_STORE_NAME` optionnel
- `PAYDUNYA_MIN_AMOUNT` optionnel

Ne jamais mettre ces valeurs dans GitHub.

## 7. Wave et WhatsApp

- Lien Wave integre comme moyen de paiement :
  - https://pay.wave.com/m/M_sn_Y0u8_bUZ_dN-/c/sn/
- Numero WhatsApp principal mis a jour :
  - +221772177176
- Le paiement Wave manuel visible dans le mauvais endroit a ete supprime.
- WhatsApp Business API avait ete explore mais suspendu temporairement.

Variables WhatsApp optionnelles si reprise plus tard :

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TEMPLATE_LANGUAGE`
- `WHATSAPP_GRAPH_VERSION`
- `WHATSAPP_API_URL`
- `WHATSAPP_SEND_TEXT`

## 8. Emails et Resend

Les notifications email ont ete configurees avec Resend.

Travail realise :

- Domaine `dieguemtechstore.com` verifie sur Resend.
- Correction DNS LWS pour SPF/DKIM/MX.
- Diagnostic email ajoute dans l'admin.
- Bouton de test email admin.
- Les emails de commande ne partent pas avant confirmation du paiement.

Variables Render a garder :

- `RESEND_API_KEY`
- `ORDER_EMAIL_FROM`
- `ORDER_ADMIN_EMAIL`
- `ADMIN_EMAIL` optionnel

## 9. Admin DieguemTech

L'admin permet maintenant :

- Connexion protegee par mot de passe.
- Consultation des commandes.
- Mise a jour des statuts commande/paiement.
- Export CSV.
- Suppression de toutes les commandes via bouton dedie.
- Gestion des produits :
  - ajout
  - modification
  - desactivation
  - image principale
  - galerie jusqu'a 8 images
  - upload d'images
  - chemin asset possible
- Nettoyage visuel de la page admin.
- Diagnostics email.
- Analytics interne.
- Sauvegarde/export JSON du site.

Variable Render essentielle :

- `ADMIN_PASSWORD`

Apres certains deploiements, il faut se reconnecter a l'admin.

## 10. Analytics et publicites

Suivi interne ajoute :

- Pages vues.
- Consultations produit.
- Recherches.
- Ajouts panier.
- Ouvertures checkout.
- Commandes creees.
- Sources de campagnes.
- Attribution UTM.

Tableau admin analytics :

- Sessions uniques.
- Pages vues.
- Produits les plus consultes.
- Recherches populaires.
- Categories populaires.
- Sources publicitaires.
- Chiffre d'affaires suivi.

Pixels/publicites prevus :

- Meta Pixel
- TikTok Pixel
- Google Tag Manager
- Google Ads

Variables Render marketing :

- `META_PIXEL_ID`
- `TIKTOK_PIXEL_ID`
- `GOOGLE_TAG_MANAGER_ID`
- `GOOGLE_ADS_ID`
- `GOOGLE_ADS_LEAD_LABEL`

## 11. SEO

SEO final realise :

- `robots.txt`
- `sitemap.xml`
- Meta title et meta description.
- Pages produits SEO.
- Pages categories SEO.
- Pages legales indexables : conditions generales, confidentialite, livraison/retours, mentions legales.
- Donnees structurees JSON-LD.
- SEO local Senegal.
- Signaux confiance : livraison, paiement securise, support, garantie.
- Domaine canonique : `dieguemtechstore.com`
- Redirection du domaine Render et du `www` vers le domaine principal hors API.

Pages SEO importantes :

- `/produit/:id`
- `/produit/:id/:slug`
- `/categorie/:categorySlug`
- `/categorie/:categorySlug/:subcategorySlug`
- `/conditions-generales`
- `/politique-confidentialite`
- `/livraison-retours`
- `/mentions-legales`
- `/sitemap.xml`
- `/robots.txt`

## 12. Securite generale

Passe securite realisee le 29 juin 2026 :

- Blocage de l'exposition publique des fichiers internes comme `server.js`, `db.js` et `package.json`.
- Le site ne sert plus tout le dossier projet en statique.
- Ajout de headers securite :
  - `Content-Security-Policy`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy`
  - `Permissions-Policy`
- Admin durci :
  - le mot de passe admin n'est plus utilise comme token permanent.
  - sessions temporaires opaques.
  - expiration de session.
  - limitation des tentatives de connexion.
- Routes techniques protegees :
  - `/api/email/status`
  - `/api/paydunya/status`
- Upload images limite a 8 fichiers, 5 Mo par fichier, avec controle du type MIME.
- Verification hash PayDunya.
- `npm audit --omit=dev` : 0 vulnerabilite connue au moment du test.

## 13. Sauvegardes

Sauvegardes disponibles :

- Code source sur GitHub.
- Base de donnees PostgreSQL sur Render.
- Export JSON depuis l'admin.
- Historique Git complet.
- Guide dedie : `SAUVEGARDE_DIEGUEMTECH_STORE.md`.
- Script Windows : `scripts/download-admin-backup.ps1`.

Commande utile pour verifier l'etat local :

```bash
git status
```

Commande utile pour voir l'historique :

```bash
git log --oneline
```

Sauvegarde admin :

- Ouvrir admin.
- Onglet sauvegarde.
- Telecharger le JSON.
- Conserver ce fichier dans un endroit separe.

Sauvegarde admin par script :

```bash
npm.cmd run backup:admin
```

Le dossier `backups/` est ignore par Git pour eviter d'envoyer des donnees clients dans GitHub.

## 14. Variables Render a conserver

Liste des variables importantes, sans les valeurs :

```text
ADMIN_PASSWORD
DATABASE_URL

PAYDUNYA_MODE
PAYDUNYA_MASTER_KEY
PAYDUNYA_PRIVATE_KEY
PAYDUNYA_TOKEN
PAYDUNYA_STORE_NAME
PAYDUNYA_MIN_AMOUNT

WAVE_PAYMENT_URL

RESEND_API_KEY
ORDER_EMAIL_FROM
ORDER_ADMIN_EMAIL
ADMIN_EMAIL

META_PIXEL_ID
TIKTOK_PIXEL_ID
GOOGLE_TAG_MANAGER_ID
GOOGLE_ADS_ID
GOOGLE_ADS_LEAD_LABEL

WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_TEMPLATE_LANGUAGE
WHATSAPP_GRAPH_VERSION
WHATSAPP_API_URL
WHATSAPP_SEND_TEXT
```

Important : ne jamais envoyer ces cles dans une capture publique, ne jamais les mettre dans GitHub, et les changer si elles ont ete partagees.

## 15. Commandes utiles

Lancer le site en local :

```bash
npm.cmd start
```

Verifier la syntaxe :

```bash
node --check server.js
node --check app.js
node --check admin.js
```

Verifier les vulnerabilites :

```bash
npm.cmd audit --omit=dev
```

Pousser une correction :

```bash
git add .
git commit -m "Message clair"
git push
```

## 16. Historique des grands jalons

- Creation du site DieguemTech Store.
- Ajout du backend Express.
- Connexion PostgreSQL.
- Connexion Render et domaine.
- Ajout admin commandes.
- Ajout admin produits.
- Ajout images produits et upload admin.
- Nettoyage produits demo.
- Ajout catalogue high-tech, TV, home cinema, climatisation, ventilateurs, accessoires et petit electromenager.
- Ajout pages produits completes.
- Ajout pages categories et navigation par sous-categories.
- Ajout logo, favicon et manifest PWA.
- Integration PayDunya.
- Correction PayDunya et passage production.
- Ajout paiement Wave.
- Ajout paiement a la livraison.
- Suppression PayTech.
- Configuration emails Resend.
- Ajout analytics interne.
- Ajout sauvegarde admin.
- Finalisation SEO.
- Ajout suivi publicitaire.
- Ajout produits mini projecteur et ecouteurs TWS.
- Nettoyage admin.
- Suppression possible des commandes admin.
- Passe securite generale.
- Ajout des pages legales completes et mise a jour du sitemap.
- Ajout du guide de sauvegarde et du script de telechargement de backup admin.
- Ajout d'un message flottant d'assistance WhatsApp sur les pages principales du site.

## 17. Points a surveiller

- Faire regulierement un test de commande PayDunya en production.
- Verifier que les emails arrivent bien apres paiement.
- Exporter une sauvegarde admin de temps en temps.
- Garder les cles Render secretes.
- Mettre a jour les prix et stocks.
- Surveiller les commandes Wave et paiement a la livraison pour bien les marquer payees dans l'admin.
- Continuer a enrichir les descriptions produits.
- Faire relire les conditions generales, la politique de confidentialite et les mentions legales par un juriste lorsque l'entreprise aura ses informations administratives finales.

## 18. Dernier etat connu

- Branche Git : `main`
- Dernier commit securite : `c027eff Harden site security`
- Site public teste :
  - page d'accueil : OK
  - headers securite : OK
  - `server.js` public : bloque en 404
  - statut email sans admin : bloque en 401
- Audit dependencies : 0 vulnerabilite connue.
