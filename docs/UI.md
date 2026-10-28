# WeConvert CRM — interface (React + Tailwind + shadcn/ui)

Depuis le 28/10/2026, l'interface du CRM est une application **Vite + React 19 + TypeScript + Tailwind 4**, avec des composants **shadcn/ui** (style new-york v4, copiés dans `src/components/ui/`), Radix, lucide-react, TanStack Query et sonner. L'ancienne interface HTML/CSS/JS a été supprimée du dépôt (elle reste dans l'historique git).

Le backend ne change pas : schéma, RLS, RPC, fonctions Edge, Vault et cron sont dans `supabase/`. L'interface appelle les mêmes RPC avec les mêmes charges utiles.

## Carte du code
- `src/main.tsx`, `src/App.tsx` : providers (thème, requêtes, session) et routage par hash (`#orders/confirmed`, `#join/<jeton>`, `#oauth/<fournisseur>/<ticket>`).
- `src/lib/session.tsx` : authentification, entreprise/boutique courante, rôle, invitation, confirmation OAuth par l'initiateur.
- `src/lib/api.ts` : `rpc`, `select`, `command` (idempotence par `request_id`), messages d'erreur. `src/lib/edge.ts` : appels des fonctions Edge et libellés WooCommerce/Shopify/YouCan/ZR.
- `src/lib/live.ts` : un signal temps réel par boutique (`crm_live_stores`), puis relecture des requêtes actives via RLS.
- `src/lib/queries.ts` : requêtes partagées (aperçu, commandes, fiche, produits).
- `src/domain/` : logique pure partagée et testée en Node (`domain.mjs`, `report-domain.mjs`, `live-sync.mjs`) et `config.json` (URL Supabase + clé **publiable** par défaut).
- `src/pages/` : Vue d'ensemble, Performance & finances, Commandes, Confirmation, Livraisons ZR, Produits & stock, Équipe, Intégrations, Paramètres, modules prévus.
- `src/components/app/` : coque, tableau et dialogues de commande, primitives de page. `src/components/ui/` : shadcn.

## Direction visuelle (décision du propriétaire, 28/10/2026)
Palette **Picton Blue** (Kigen.design) en tokens shadcn dans `src/index.css`, thème clair et sombre. Police Outfit auto-hébergée. Icônes Lucide.

Contrastes calculés (WCAG) :
- clair : bouton principal blanc sur `#0071a4` 5,39:1 · texte `#001320` sur blanc 18,85:1 · texte secondaire `#005278` sur `#f5faff` 8,07:1 · bordure de champ `#009de1` 3,04:1.
- sombre : bouton `#001320` sur `#00b2ff` 7,91:1 · texte secondaire `#85c8ff` sur `#001b2b` 9,82:1 · bordure de champ `#0071a4` 3,50:1.
- `#00b2ff` n'est jamais un fond de texte blanc en clair (2,4:1). Les statuts restent vert/ambre/rouge/violet et portent toujours leur libellé.

Règles de taille (décision du 28/10/2026, alignée sur Stripe, Shopify Polaris et shadcn) : **à la souris**, texte courant 14 px, boutons et champs 36 px (petits 32 px), titres de page 20–24 px, chiffres clés 28 px, en-tête 56 px — cibles ≥ 24 px (WCAG 2.2 AA, 2.5.8). **Au doigt** (`@media (pointer: coarse)`, variante Tailwind `coarse:` déclarée dans `src/index.css`), cibles ≥ 44 px (WCAG AAA 2.5.5, Apple 44 pt). Focus visible, tables utilisables au clavier, cartes par commande sur téléphone, navigation basse mobile. Les recherches, filtres, sélections et brouillons sont dans l'état des composants : un rafraîchissement temps réel ne les touche pas. Aucune donnée factice : un module non branché l'indique.

## Sécurité navigateur
- CSP stricte sans script inline (`scripts/postbuild.mjs` l'injecte dans `dist/index.html` et dans `dist/_headers`), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, HSTS.
- Le build refuse une clé `service_role` / `sb_secret_`.
- Constat staging du 28/10 : Cloudflare Pages n'a pas renvoyé l'en-tête CSP de `_headers` (les autres en-têtes oui). La CSP reste appliquée par la balise `<meta>`. À éclaircir avant la production.

## Commandes
```bash
npm ci
npm run check     # TypeScript
npm test          # tests Node (domaine, connecteurs, durcissement) + tests composants
npm run test:sql  # migrations + scénarios SQL sur un Postgres local jetable
VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_KEY=sb_publishable_... npm run build   # → dist/
```
Sans variables, le build vise le projet de `src/domain/config.json` (production). Pour staging, toujours passer les deux variables.

## Commandes façon Confirmoo (28/10/2026)
- La page **Commandes** s'ouvre sur 7 cartes d'étape avec compteurs : Toutes · Nouvelles (à confirmer) · En préparation (confirmées, pas encore chez le transporteur) · Expédiées · Livrées · Retournées · Annulées (annulées, doublons, faux numéros). Expédiée/Livrée/Retournée viennent du colis ZR : c'est un statut transporteur, pas un encaissement.
- Le **badge de statut** est cliquable : Appel 1 / 2 / 3+ (on peut sauter à l'appel 3, jamais revenir en arrière), Confirmée, Reportée (rappel daté), À vérifier, Faux numéro, Doublon, Annulée. Les responsables peuvent rouvrir ou annuler une commande confirmée tant qu'aucun colis actif n'existe. Le serveur reste juge (RPC `crm_command`).
- Colonnes **Livraison** (état ZR + n° de suivi) et **Source** (WooCommerce, Shopify, YouCan ou canal saisi) ; bouton **Colonnes** pour masquer Produit, Adresse, Agent, Livraison, Source, Date (choix mémorisé dans le navigateur).
- La recherche trouve aussi un n° de suivi. Les anciens liens `#orders/pending`, `#orders/cancelled_all` et `#orders/confirmed` restent valides.
- Données : RPC `crm_order_board` (RLS appliquée : un agent ne voit que ses commandes et ses compteurs). L'écran **Confirmation** (file + fiche d'appel) est conservé en complément.
