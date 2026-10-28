# WooCommerce → WeConvert CRM

Cette intégration reçoit les **nouvelles commandes COD en DZD** par webhook signé. WooCommerce est la source de la commande commerciale (client, lignes, montant, statut Woo) ; la décision de confirmation COD appartient au CRM ou, après raccordement, au SaaS de confirmation réellement utilisé. Une commande `completed` dans WooCommerce ne prouve pas qu'un agent l'a confirmée, et un SaaS tiers peut gérer confirmation et livraison sans mettre à jour WooCommerce.

## Connexion

1. Dans WooCommerce : **Réglages → Avancé → API REST → Ajouter une clé**, permission **Lecture** sur les commandes.
2. Dans WeConvert : choisir la boutique CRM puis **Intégrations → Connecter WooCommerce** ; saisir l'URL HTTPS finale et les clés `ck_…` et `cs_…`. La connexion teste `/wp-json/wc/v3/orders` et protège les clés avec Supabase Vault.
3. **Configurer les webhooks** fournit une URL et un secret. Créer dans WooCommerce deux webhooks actifs, `order.created` et `order.updated`, avec ces valeurs. Vérifier la réception d'une nouvelle commande test et l'heure du dernier webhook signé ; le ping initial ne prouve pas cette réception.
4. **Synchroniser les produits** importe les produits simples et les variantes vendables. La reprise du catalogue est possible après interruption.

L'import manuel de tout l'historique des **commandes** a été retiré de l'interface et désactivé côté serveur (`sync` retourne HTTP 410). Il n'existe plus de fenêtre ou de bouton « importer toutes les commandes / période précise ». La synchronisation des **produits** reste disponible. Un `order.updated` concernant une commande créée avant la première connexion de cette boutique ne crée pas une nouvelle fiche CRM ; un lien source déjà connu peut néanmoins être rafraîchi. Pour une commande déjà connue du journal, **Réessayer** cible une référence Woo unique : c'est une réparation ponctuelle, pas un backfill historique. L'API admin contrôle les droits avant chaque action.

Le paiement WooCommerce standard porte l'identifiant `cod`. Les extensions COD peuvent utiliser d'autres identifiants configurables. Chaque entreprise et chacune de ses boutiques ont des références et secrets isolés.

## Statuts et données

- Les commandes COD DZD reçues par webhook entrent dans WeConvert au statut CRM **Nouvelle**, quel que soit le statut Woo valide (`pending`, `on-hold`, `processing`, `completed`, `cancelled`, `failed`, `refunded`). Le statut Woo reste dans `woo_status` et le snapshot source ; il ne déclenche ni confirmation, ni annulation, ni réservation de stock CRM.
- Un événement `order.updated` peut rafraîchir les données d'une commande encore intacte, mais ne modifie pas son statut CRM. Après une action d'agent, la fiche reste protégée et une modification Woo est signalée **À vérifier**. La livraison ZR est un état distinct.
- Les anciennes fiches qui ont déjà reçu un statut terminal déduit de WooCommerce ne sont **ni supprimées ni requalifiées arbitrairement**. Elles portent `status_origin='woo_legacy'` si aucune action de statut CRM n'est enregistrée. Le détail et les listes l'indiquent. Ces statuts sont exclus des taux et montants de confirmation et des annulations des rapports. Une action explicite de changement de statut CRM supprime ce marqueur.
- Une future intégration avec le SaaS tiers de confirmation pourra rapprocher les décisions par boutique et référence source, avec preuves, états et dates. La date de création de la commande, la date de confirmation et la date de livraison doivent rester distinctes. Aucun historique de confirmation fiable ne peut être reconstruit à partir des seuls statuts WooCommerce.
- La Suite WeConvert peut ajouter les marqueurs `_kb_capi_event_id` et `_kb_capi_purchase_sent` après réponse positive à l'envoi CAPI `Purchase`. Un webhook reçu sans ces marqueurs crée quand même une fiche opérationnelle, avec suivi **non vérifié**. Le marqueur ne prouve ni la déduplication finale par Meta ni l'existence d'un Pixel navigateur.
- Les commandes hors COD, hors DZD, à statut personnalisé non supporté ou avec remboursement partiel sont ignorées avec une raison dans le journal. Les nouvelles fiches COD créées par une reprise ponctuelle hors webhook exigent toujours les deux marqueurs Suite afin de ne pas transformer un ancien stock de commandes en trafic « suivi ».

## Catalogue et fiabilité

Les SKU existants sont rapprochés. Le stock Woo géré et chiffré est copié quand la fiche CRM est intacte ; un produit sans stock Woo géré démarre à 0. Les modifications CRM sont conservées. Aucun statut, paiement, stock ou note n'est écrit vers WooCommerce. Les lignes reprennent les remises, taxes et frais pour conserver le total payable. Les UTM autorisés ne constituent pas une preuve d'attribution.

Les webhooks sont authentifiés par HMAC-SHA256 sur le corps exact. Une relivraison est idempotente ; les versions distantes anciennes sont rejetées et les changements ambigus sont signalés. WooCommerce peut suspendre un webhook après des échecs : vérifier ses journaux et le réactiver. Il n'existe pas encore de reprise automatique des commandes manquées ; une restauration historique sûre exigera une source de confirmation fiable et un flux dédié, validé par boutique et sans inférence de statut.

Les commandes anciennes, rapprochements ZR et historiques restent conservés lors de la déconnexion, qui supprime les clés et le secret côté serveur. Désactiver aussi les webhooks dans WooCommerce. RLS, contrôle de rôle et fonctions `SECURITY DEFINER` à chemin fixe isolent chaque boutique ; les agents ne voient que leurs commandes autorisées.

Validation : `tests/woocommerce.test.mjs` couvre HMAC, statuts Woo, normalisation, montants, produits et preuves Suite ; `tests/woocommerce.sql` couvre droits, isolation de deux entreprises, réception sans Suite, déduplication, conflits, non-propagation de statut Woo et réservations. Le temps de livraison du webhook reste distinct du délai d'affichage Realtime.

Sources : [API WooCommerce](https://developer.woocommerce.com/docs/apis/rest-api/), [statuts WooCommerce](https://woocommerce.com/document/managing-orders/), [webhooks WooCommerce](https://woocommerce.com/document/webhooks/).
