@AGENTS.md
@docs/SAAS_PRODUCT_RULES.md

# WeConvert CRM — instructions de reprise pour Claude Code

Ce dépôt est le CRM SaaS COD de WeConvert. Les règles importées ci-dessus sont le contrat du projet. Les specs CODPilot et Confirmoo sont des références métier, pas du code à copier ni la preuve qu'une fonction existe ici. En cas de désaccord entre un ancien plan et le code actuel, inspecter les migrations, fonctions et tests avant de trancher.

## Ce qui existe aujourd'hui

- Interface **React 19 + Vite + TypeScript + Tailwind 4 + shadcn/ui** à la racine (`src/`), compilée vers `dist/` par `npm run build`. L'ancienne interface HTML/CSS/JS a été supprimée le 28/10/2026 ; elle ne doit pas être réintroduite.
- Auth Supabase, entreprises et boutiques isolées, rôles propriétaire/admin/agent, catalogue, commandes, confirmation, stock, rapports, finances (coûts, dépenses, marge) et thème clair/sombre.
- Connecteurs WooCommerce, Shopify et YouCan ; livraison ZR Express. Les ventes WhatsApp, Messenger, Instagram et téléphone peuvent être saisies comme canaux CRM, mais leurs API de messagerie ne sont pas encore connectées.
- Les données de suivi publicitaire, la déduplication Pixel/CAPI, l'attribution complète et l'abonnement commercial envisagé ne sont pas tous implémentés. Ne jamais présenter une spécification ou un canal saisi manuellement comme une intégration livrée.

## Contrats métier et sécurité

1. Chaque lecture, écriture, secret, webhook, lien de source et tâche asynchrone appartient à une entreprise et, si applicable, à une boutique. Tester au moins deux entreprises et deux boutiques lorsque la logique concernée change.
2. Distinguer quatre faits : **commande opérationnelle**, **preuve de tracking**, **attribution publicitaire**, **état du transporteur**. Un statut WooCommerce/YouCan n'est pas une confirmation téléphonique ; un statut transporteur n'est pas un encaissement ; absence de trace Meta signifie « non vérifié ».
3. Préserver la séparation des rôles dans RLS, les RPC et les Edge Functions. Une clé `service_role` ne va jamais dans `src/`, le HTML, le bundle ou les journaux (le build la refuse). Les actions utilisateur des fonctions doivent vérifier JWT et droits boutique ; les webhooks doivent valider leur signature avant d'utiliser le contenu reçu.
4. Les reprises doivent être ciblées et idempotentes (`command()` réutilise son `request_id`). Ne pas importer implicitement l'historique ni créer une fiche COD inexploitable sans nom/téléphone. Les événements rejetés restent visibles avec une cause et un chemin de reprise. Ne pas écraser notes, affectations, confirmation ou réservation de stock lors d'une mise à jour source.
5. Direction visuelle : lire `docs/UI.md` avant toute modification visuelle. Garder la palette Picton Blue (`src/index.css`), Outfit, Lucide, les composants shadcn et la coque. Deux densités (décision du 28/10/2026) : à la souris, contrôles compacts comme Stripe/Shopify (boutons et champs 36 px, petits 32 px, texte 14 px, cibles ≥ 24 px = WCAG 2.2 AA) ; au doigt (`pointer: coarse`, variante Tailwind `coarse:`), cibles ≥ 44 px. Focus visible, clair/sombre.

## Carte du code

- `src/pages/` : écrans. `src/components/app/` : coque, commandes, dialogues, primitives. `src/components/ui/` : shadcn.
- `src/lib/` : session et contexte boutique, accès RPC/REST (`api.ts`), fonctions Edge (`edge.ts`), temps réel (`live.ts`), requêtes (`queries.ts`), thème.
- `src/domain/` : logique pure partagée et testée en Node (`domain.mjs`, `report-domain.mjs`, `live-sync.mjs`) et `config.json` (URL Supabase + clé publiable).
- `scripts/postbuild.mjs` : CSP, `_headers`, contrôle anti-secret. `scripts/deploy.sh` : déploiement staging/production.
- `supabase/migrations/` : schéma, RLS, RPC et triggers. `supabase/functions/weconvert-{woocommerce,shopify,youcan,zr}/` : endpoints serveur.
- `tests/*.test.mjs` : tests Node ; `src/test/` : tests composants (Vitest) ; `tests/*.sql` + `tests/harness/` : scénarios SQL transactionnels (`npm run test:sql`).

## Workflow pour chaque changement

1. Lire la source, les migrations et les tests concernés, puis identifier tenant, boutique, rôle, source de vérité, état vide/erreur et reprise.
2. Faire un changement limité dans `src/`, la fonction Edge ou une nouvelle migration. Garder les secrets dans l'environnement serveur/Vault.
3. Exécuter `npm run check`, `npm test` et `npm run build` (et `npm run test:sql` pour le SQL). Pour une évolution SQL ou connecteur, tester aussi RLS, rejouement de webhook, boutique sans Suite, agent limité et multi-boutique avec données synthétiques.
4. Vérifier les écrans touchés en desktop/mobile, clair/sombre et au clavier ; préserver recherches, filtres et brouillons pendant le temps réel.
5. Mettre à jour la documentation et annoncer précisément ce qui est implémenté, testé, déployé et encore inconnu.

Quand Claude Code et Codex travaillent successivement sur ce dépôt, inspecter `git status` et le dernier commit avant d'éditer. Préserver les modifications non commitées de l'autre session ; utiliser une branche dédiée si les travaux se chevauchent. Ne pas faire de `reset --hard` ni de push forcé.

## Environnements et migrations

- Staging : Supabase `rnnjgkojhoyooovyqvnl`, frontend Cloudflare Pages `weconvert-crm-staging` → `https://crm-staging.kitabooklibrary.com`. Build : `VITE_SUPABASE_URL=… VITE_SUPABASE_KEY=<clé publiable staging> npm run build`.
- Production : Supabase `loxdcfxxefigfchmrwzy`. Le front, les fonctions Edge et les migrations se déploient séparément ; déployer le frontend avant les fonctions Edge. Ne pas supposer qu'un commit frontend met à jour Supabase.
- Avant tout `supabase db push` en production : comparer `supabase migration list` avec l'historique distant sur staging ; ne pas rejouer de migrations ni réinitialiser la production.
