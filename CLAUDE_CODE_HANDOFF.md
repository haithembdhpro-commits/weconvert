# WeConvert CRM — reprise intégrale du code

Cette archive contient **les 97 fichiers suivis du dépôt au commit `ea29ea61c915c38cf97ba233f7dbabfed84ba179`**, plus ce guide. C'est tout le code actuellement écrit, sans couper le HTML, le CSS, le JavaScript, les fonctions Supabase ou les migrations. Il ne faut pas confondre « tout le code existant » et « toutes les fonctions du produit terminées » : Meta/UTM/attribution, messageries API, facturation et plusieurs modules du guide restent à développer.

## Lire avant de modifier

1. `AGENTS.md` et `docs/SAAS_PRODUCT_RULES.md` : contrat multitenant, permissions, provenance des commandes et absence de données propres à la boutique pilote dans les règles globales.
2. `docs/WECONVERT_GUIDELINES_UI.md` et `references/ui/` : conserver **la même UI**, la police Outfit, les tokens et les icônes Lucide. Ajouter les fonctions sans redessiner la coque, les cartes ou la navigation.
3. `README.md` et les guides de `docs/` pour les flux opérationnels. Les anciens paragraphes du README peuvent précéder les changements récents ; lire aussi le code et les migrations finales.

## Structure complète

| Chemin | Contenu |
| --- | --- |
| `src/` | Source de l'interface CRM, thèmes, icônes, Realtime, WooCommerce, Shopify, YouCan, ZR, rapports, calculs. |
| `scripts/`, `package.json`, `package-lock.json` | Build et dépendances épinglées. |
| `dist/`, `WeConvert-CRM-COD.html` | Build publié et HTML autonome inclus dans le dépôt. Modifier `src/`, puis reconstruire. |
| `supabase/functions/` | Quatre Edge Functions complètes : WooCommerce, ZR Express, Shopify, YouCan. |
| `supabase/migrations/` | 27 migrations SQL : schéma, RLS, RPC métier, intégrations et signal Realtime. |
| `tests/` | Tests Node et scénarios SQL transactionnels. |
| `docs/`, `references/`, `.openai/hosting.json`, `AGENTS.md` | Documentation, direction UI, références et configuration du Site. |

## État vérifié au 27 octobre 2026

- Dépôt propre au commit ci-dessus ; archive créée à partir de `git archive HEAD`.
- Site privé publié : `https://weconvert-cod-studio-ht26.citrus-mug-9991.chatgpt.site` ; projet Sites `appgprj_6ada92bc5e408191a91f075a077d54e0`.
- Supabase : projet `loxdcfxxefigfchmrwzy`. Les quatre fonctions Edge déployées correspondent fichier par fichier aux sources de cette archive : `weconvert-woocommerce` v7, `weconvert-zr` v6, `weconvert-shopify` v3, `weconvert-youcan` v9.
- Les 27 noms de migrations du dépôt sont présents à distance. **Huit versions horodatées diffèrent** (table ci-dessous).
- L'événement YouCan #002 a été reçu mais marqué `CUSTOMER_REQUIRED` : aucun nom ou téléphone sur la commande source. La page Commandes affiche maintenant une anomalie à compléter et un réessai ciblé ; un événement source émet un signal Realtime. Cette commande n'entre pas dans les ventes opérationnelles tant que ses coordonnées ne sont pas corrigées.
- `npm run check`, `npm test` (44 tests) et `npm run build` passaient sur ce commit. Les tests SQL du dépôt doivent être joués de préférence sur un environnement de test et avec leur transaction annulée.

## Démarrage avec Claude Code

```bash
unzip WeConvert-CRM-code-complet.zip
cd weconvert-crm
npm ci
npm run check
npm test
npm run build
```

Pour inspecter l'interface statique, servir `dist/` sur un serveur HTTP local. Une authentification réelle nécessite que l'URL locale soit autorisée dans Supabase Auth et que les origines CORS des fonctions soient adaptées. Ne pas copier une clé service dans le navigateur.

## Migration : attention avant `supabase db push`

Les migrations ont été appliquées avec des versions attribuées par Supabase qui ne correspondent pas toujours aux noms de fichiers du dépôt. **Ne pas lancer `supabase db push` tel quel sur la production**, car le CLI pourrait traiter ces huit fichiers comme des migrations nouvelles. Réconcilier les versions locales et distantes dans une branche de travail, vérifier l'historique, puis tester sur une base de staging avant tout push. Ne pas réinitialiser la base de production.

| Migration | Fichier local | Version enregistrée à distance |
| --- | --- | --- |
| `omni_source_connectors` | `20261026210953` | `20261026211742` |
| `source_oauth_alias_fix` | `20261026212000` | `20261026211906` |
| `source_sku_variable_fix` | `20261026213000` | `20261026211932` |
| `source_security_indexes` | `20261026214000` | `20261026212006` |
| `youcan_connector` | `20261026215000` | `20261026214216` |
| `youcan_channel_identity` | `20261027013652` | `20261027014007` |
| `youcan_long_lived_oauth_expiry` | `20261027020959` | `20261027021103` |
| `source_event_live_signal` | `20261027144500` | `20261027144535` |

## Secrets et sécurité

- L'archive exclut `.git/`, `node_modules/`, `.env*`, les jetons de déploiement et toute donnée de production. Un contrôle des fichiers suivis n'a trouvé aucune clé privée ni jeton secret connu.
- `src/config.json` contient l'URL Supabase et une **clé publiable** destinée au navigateur ; ce n'est pas la clé `service_role`.
- Variables d'environnement des Edge Functions : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `YOUCAN_CLIENT_ID`, `YOUCAN_CLIENT_SECRET`. Les valeurs restent dans Supabase, hors archive.
- Les identifiants marchands WooCommerce/ZR et les jetons OAuth sont conservés côté serveur/Supabase Vault, liés à chaque boutique. Aucune donnée client ou commande réelle n'est exportée dans ce code.
- Les fonctions hébergent aussi des callbacks/webhooks, d'où `verify_jwt=false` au niveau passerelle ; le code vérifie les signatures ou le JWT et les droits des actions utilisateur. Garder ce contrôle lors de chaque évolution.
- Le Site est actuellement visible seulement par son propriétaire ; ouvrir l'accès aux clients CRM exige une décision d'hébergement/partage distincte.

Pour reprendre le projet, demande à Claude Code d'auditer `AGENTS.md`, la chaîne complète d'une commande par connecteur, l'isolation RLS par entreprise/boutique et la table des versions de migrations avant de modifier la production. Conserver le même système visuel et valider chaque nouvelle fonction sur au moins deux entreprises et deux boutiques synthétiques.
