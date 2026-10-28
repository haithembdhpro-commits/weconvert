# Nouvelle interface React + Tailwind + shadcn/ui (`app/`)

Branche `feat/react-shadcn`, démarrée le 28/10/2026. L'interface actuelle (`src/`, `dist/`, `WeConvert-CRM-COD.html`) reste intacte et déployable : les deux coexistent jusqu'à la bascule.

## Ce qui ne change pas
Supabase entier : schéma, RLS, RPC (`crm_command`, `crm_list_orders`, `crm_order_detail`, `crm_overview`, …), fonctions Edge, Vault, cron. Le nouveau front appelle **les mêmes RPC avec les mêmes charges utiles** et réutilise tels quels `src/domain.mjs`, `src/report-domain.mjs`, `src/live-sync.mjs` et `src/config.json` (alias `@domain`).

## Pile
Vite 8 · React 19 · TypeScript · Tailwind 4 · composants shadcn/ui (new-york v4, copiés depuis le dépôt GitHub de shadcn dans `app/src/components/ui/`) · Radix · lucide-react · TanStack Query · sonner · police Outfit auto-hébergée.

## Écrans migrés
Connexion / inscription / mot de passe oublié / nouveau mot de passe · création d'espace · invitation (`#join/…`) · retour OAuth Shopify/YouCan (`#oauth/…`, confirmation par l'initiateur) · coque (barre latérale, sélecteur boutique/entreprise, thème, état temps réel, navigation mobile) · Vue d'ensemble · Commandes (onglets, recherche, filtre agent, tri, sélection et affectation en masse, export CSV, anomalies YouCan) · fiche commande (actions, motifs, rappel, note, historique, sources Woo/Shopify/YouCan, « Marquer comme vérifié ») · formulaire commande (lignes, recherche catalogue, alerte doublon téléphone, total) · Confirmation (file + fiche d'appel + script) · Produits & stock (produit, coût d'achat, ajustement) · Équipe (membres, permissions, invitation, accès) · Paramètres (boutiques, compte, thème).

## Encore dans l'interface actuelle
Performance & rapports (finances, dépenses), Livraisons ZR, Intégrations (WooCommerce, Shopify, YouCan). La nouvelle interface affiche un lien vers l'interface actuelle (`VITE_LEGACY_URL`) ; elle ne simule aucune donnée.

## Contrats conservés
- **Idempotence** : une commande répétée réutilise son `request_id` (`app/src/lib/api.ts`).
- **Temps réel** : un seul signal par boutique (`crm_live_stores`), puis relecture de toutes les requêtes actives de la boutique via RLS. Les recherches, filtres, sélections et brouillons sont dans l'état des composants : un rafraîchissement ne les touche pas.
- **Rôles** : affichage par rôle identique ; les droits restent vérifiés côté serveur.
- **Sécurité navigateur** : CSP stricte sans script inline (`app/scripts/postbuild.mjs`), `_headers` Cloudflare, refus de compiler avec une clé `service_role`/`sb_secret_`, polices servies par le site.

## Couleurs (palette Picton Blue, demande du propriétaire du 28/10)
Tokens shadcn dans `app/src/index.css`. Contrastes calculés (WCAG) :
- clair : bouton principal blanc sur `#0071a4` 5,39:1 · texte `#001320` sur blanc 18,85:1 · texte secondaire `#005278` sur `#f5faff` 8,07:1 · bordure de champ `#009de1` 3,04:1.
- sombre : bouton `#001320` sur `#00b2ff` 7,91:1 · texte secondaire `#85c8ff` sur `#001b2b` 9,82:1 · bordure de champ `#0071a4` 3,50:1.
- `#00b2ff` n'est jamais un fond de texte blanc en clair (2,4:1). Les statuts restent vert/ambre/rouge/violet avec leur libellé.
- Contrôles ≥ 44 px (boutons, champs, sélecteurs, onglets), 48 px pour les actions mobiles fréquentes.

## Commandes
```bash
cd app
npm ci
npm run typecheck && npm test
VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_KEY=sb_publishable_... VITE_LEGACY_URL=https://... npm run build   # → app/dist
```
Sans variables, le build pointe vers `src/config.json` (production). Pour staging, toujours passer les trois variables.

## Vérifié / non vérifié
- Vérifié : typecheck, 3 tests unitaires, build, CSP sans erreur console, rendu clair/sombre desktop 1440 px et mobile 390 px, avec un Supabase **simulé** (données synthétiques).
- Non vérifié : parcours réel contre staging (le réseau de l'environnement de travail ne joint pas Supabase), temps réel réel, rejeu de webhook, deux entreprises × deux boutiques en vrai. À faire sur staging avant toute bascule.
