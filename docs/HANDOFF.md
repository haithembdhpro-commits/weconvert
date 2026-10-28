# Passation WeConvert CRM — état au 29/10/2026

Document pour reprendre le projet avec un autre assistant ou développeur. Lire ensuite, dans cet ordre : `CLAUDE.md`, `AGENTS.md`, `docs/SAAS_PRODUCT_RULES.md`, `docs/UI.md`.

## Code
- Branche de travail : `feat/react-shadcn` (17 commits au-dessus de `main`, non fusionnée). Aucun dépôt distant configuré : pousser sur GitHub dès la reprise.
- Frontend React 19 + Vite + TypeScript + Tailwind 4 + shadcn/ui (`src/`). Backend Supabase (`supabase/migrations/`, `supabase/functions/`).
- Commandes : `npm ci`, `npm run check` (TypeScript), `npm test` (Node + Vitest), `npm run test:sql` (Postgres 16 local jetable, jamais distant), `npm run build`.
- Build staging : `VITE_SUPABASE_URL=https://rnnjgkojhoyooovyqvnl.supabase.co VITE_SUPABASE_KEY=sb_publishable_ly3iyv5oJ5VLVFwfuOpN6w_XoFEobVD npm run build` (clé publiable, pas un secret).

## Environnements
| | Staging | Production |
|---|---|---|
| Supabase | `rnnjgkojhoyooovyqvnl` | `loxdcfxxefigfchmrwzy` |
| Cloudflare Pages | `weconvert-crm-staging` → https://crm-staging.kitabooklibrary.com | `weconvert-crm` |
| Migrations | toutes appliquées jusqu'à `20261028230814_notifications_seen_private` | **non comparées** : lancer `supabase migration list` avant tout `db push`, ne jamais rejouer ni réinitialiser |
| Frontend | lot 2 déployé le 29/10 (panneau latéral, notifications, Ctrl/⌘K) | ancienne version |

Déploiement complet depuis un ordinateur : `bash scripts/deploy.sh staging|production` (Supabase CLI + wrangler connectés). Ordre : migrations, frontend, puis fonctions Edge (`weconvert-woocommerce`, `-shopify`, `-youcan`, `-zr`, déployées avec `--no-verify-jwt`).

## Secrets — ne jamais les coller dans un chat
Clé `service_role`, mots de passe base, secrets OAuth Shopify/YouCan, clés ZR, secrets webhook WooCommerce, jetons Cloudflare/Supabase. Ils vivent dans Supabase (Vault / secrets des fonctions) et Cloudflare. Shopify sur staging répond `APP_NOT_CONFIGURED` (secrets non posés). Seule la clé **publiable** peut apparaître dans le code.

## Fait récemment (staging)
- Durcissement backend (stock à la remise ZR, Shopify `shop_id`, purge des journaux, RLS `my_workspaces`…), tableau Commandes façon Confirmoo (`crm_order_board`, étapes, appels 1/2/3+).
- Audit UX (90 défauts, voir le doc de projet `claude/AUDIT-UX-2026-10-28.md`) : lot 1 corrigé (poste d'agent, confirmation annulable 5 s, états de chargement honnêtes, 69 wilayas, menu « Bientôt », accent bleu définitif).
- Lot 2 : fiche commande en panneau latéral non modal (clic extérieur ferme, clic sur une autre commande bascule), notifications (`crm_notifications`, `crm_notification_seen`), recherche Ctrl/⌘K, filtres mobiles, totaux de page.
- Tests : SQL 12/12, Node 50, Vitest 8, build OK.

## Reste à faire (par priorité)
1. Pousser le code sur GitHub ; fusionner `feat/react-shadcn` après relecture.
2. Vérifier l'interface sur un vrai téléphone (panneau plein écran, filtres mobiles) — jamais vu à l'écran.
3. Format wilaya : la liste écrit « 06 - Béjaïa » ; aligner avec les données existantes si elles utilisent « 6 - Béjaïa ».
4. Défauts P2/P3 restants de l'audit UX (titres marketing, couleurs de statut uniques, raccourcis clavier de la fiche, états Livraisons, filtres Performance…).
5. Lot 2 Confirmoo : filtres avancés, corbeille, détection de doublons, nombre d'appels configurable.
6. Tests d'écriture sur staging avec 2 entreprises × 3 rôles ; en-tête CSP non servi par Cloudflare (la balise meta CSP est active) ; documentation sauvegardes et supervision.
7. Production : comparer l'historique des migrations, puis déployer seulement sur décision du propriétaire.

## Données de test sur staging
Entreprise Test A / Boutique Test A1 (propriétaire « Haithem Test ») : commandes WC00001 (annulée) et WC00003 (confirmée, 1 Produit Test réservé). Espace réel « WeConvert.io » : commande WC00002.

## Règles qui ne se négocient pas
Isolation par entreprise et boutique (RLS + contrôles serveur), agent limité à ses commandes, aucune métrique ou action factice, « non vérifié » plutôt qu'une certitude inventée (confirmation ≠ statut Woo ; livré ≠ encaissé ; envoi Meta ≠ déduplication), traitements idempotents, pas de `reset --hard` ni de push forcé, toujours distinguer implémenté / testé / déployé / à faire.
