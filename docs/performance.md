# Performance & rapports — périmètre actuel

L’écran utilise exclusivement les commandes du CRM et de WooCommerce déjà synchronisées dans la **boutique sélectionnée**. Les filtres portent sur la date de création de la commande en `Africa/Algiers`, du premier au dernier jour inclus. Les statuts, affectations et montants lus sont ceux **au moment de la consultation** : une commande créée pendant la période puis confirmée plus tard augmente le nombre confirmé de cette période. La plage maximale est de 366 jours inclusifs ; les choix rapides couvrent les 7, 30, 90 et 365 derniers jours.

| Indicateur | Définition |
| --- | --- |
| Commandes reçues | Nombre de commandes créées dans la plage et la boutique filtrées. |
| Confirmées | Commandes au statut CRM `confirmed`, hors anciennes fiches dont le statut a été déduit de WooCommerce (`status_origin='woo_legacy'`). Une confirmation dans le CRM est distincte du statut Woo. |
| Taux de confirmation | Confirmées vérifiées / base de taux × 100, arrondi à une décimale ; « — » si la base est vide. La base (`rate_base`) compte les commandes reçues **hors** statuts hérités de WooCommerce (`status_origin = woo_legacy`, décision du 28/10/2026) : ces commandes restent visibles et comptées dans « reçues », mais n'entrent ni au numérateur ni au dénominateur. |
| À traiter | Statuts `new`, `call1`, `call2`, `call3`, `reported` et `check`. |
| Annulées, doublons, faux numéros | Statuts CRM actuels `cancelled`, `duplicate`, `fake`, séparés. Les anciennes annulations déduites de WooCommerce sont exclues des annulations vérifiées. |
| Montant COD confirmé | Somme des totaux des commandes actuellement confirmées, frais et remises inclus. Ce n’est ni un encaissement, ni une livraison, ni une marge. |
| Couverture du suivi WooCommerce | Nombre de commandes Woo de la période qui portent les deux marqueurs `Purchase` de la Suite WeConvert, sur le total des commandes Woo de la même sélection. Les commandes déjà importées sans preuve restent comptées dans les indicateurs **opérationnels** ci-dessus, mais ne doivent pas être comparées directement aux achats Meta. L'import historique des commandes est désactivé ; seules les nouvelles commandes arrivent par webhook et une référence connue peut être réparée ponctuellement. |
| Produit : unités et lignes confirmées | Quantités des lignes de commande ; sommes quantité × prix de ligne sur commandes confirmées. Les frais et remises de la commande ne sont pas répartis entre produits. Les dix premiers produits sont triés par unités confirmées. |

Les rapports affichent séparément le nombre de confirmations et d'annulations historiques Woo non vérifiées. Les commandes concernées restent dans le dénominateur des commandes reçues, mais sont exclues des numérateurs confirmés/annulés et des montants COD confirmés, y compris dans les séries et ventilations par canal, wilaya, produit et agent. Le statut des fiches individuelles reste visible pour permettre un futur rapprochement avec le système tiers réellement utilisé.

Le graphique regroupe automatiquement les jours en semaines pour une plage de plus de 31 jours et en mois pour plus de 120 jours. Le détail des valeurs reste accessible sous le graphique ; le CSV contient les jours bruts, ainsi que les agrégats par canal, wilaya, produit et agent. Le canal correspond à la provenance **saisie ou importée** dans la commande : WhatsApp, Messenger, Instagram et téléphone ne sont pas des mesures directes des plateformes de messagerie. Les dix premières wilayas sont sélectionnées par nombre de commandes reçues.

Le propriétaire et les administrateurs voient les commandes de la boutique et peuvent filtrer par agent, y compris un ancien membre. Un agent ne voit que ses commandes actuellement affectées, même dans les agrégats et le CSV. Les commandes non affectées figurent dans la ligne « Non attribué » pour les responsables. La fonction SQL est `SECURITY INVOKER`, vérifie l’appartenance active et s’appuie aussi sur les politiques RLS des commandes et lignes.

La page s’actualise au signal Realtime comme les autres écrans du CRM. Le rapport complémentaire **Livraison & marge COD**, réservé aux responsables, utilise les colis ZR liés aux commandes de la même boutique. Les filtres par période et canal suivent la création de la commande, puis lisent le dernier état connu du colis : `delivered`, `returned` ou en cours. Le nombre livré et le montant COD livré sont des résultats de transport, **pas de l'argent reversé**. Un filtre par agent masque ce rapport tant que son attribution n'est pas disponible.

La marge de contribution est le COD des colis livrés moins le coût des produits de ces commandes livrées et moins les frais ZR saisis pour **tous les colis liés** de la période, retours compris. Les coûts unitaires du catalogue actuel servent d'estimation pour les anciennes commandes : il ne s'agit pas de coûts historiques figés. Un coût produit manquant, une commande livrée sans ligne produit ou des frais transport absents rendent la marge indisponible (`—`), jamais égale à zéro par défaut. Les frais ZR peuvent être marqués explicitement à zéro s'ils sont gratuits.

Les dépenses de publicité et d'exploitation saisies par date peuvent être soustraites de cette marge pour obtenir un **résultat partiel après dépenses enregistrées** ; les dépenses non saisies ne sont pas supposées nulles. Ce résultat est masqué pour un filtre par canal, faute de ventilation des dépenses. Les dépenses datées suivent la période civile, alors que les commandes sont regroupées par date de création : leur différence temporelle interdit d'assimiler ce résultat à un bénéfice net comptable. Les 100 dépenses les plus récentes sont visibles dans la liste, mais la somme du rapport porte sur toutes les dépenses de la période. Le chiffre réellement encaissé, le reversement ZR, le ROAS et l'attribution UTM/publicitaire attendent des données vérifiables supplémentaires.

## Rétention des journaux techniques (28/10/2026)

Une tâche planifiée (`weconvert-purge-logs`, chaque nuit à 03:23 UTC) supprime : les clés d'idempotence de plus de 30 jours, les identifiants de livraison de webhooks Shopify/YouCan de plus de 30 jours, et les journaux d'intégration/source de plus de 180 jours en gardant toujours les 200 derniers par connexion. L'historique des commandes (`crm_events`) n'est jamais purgé.

## Rapport complet (29/10/2026)

Fonction `crm_report_insights` (migration `20261029120000_report_insights.sql`, `SECURITY INVOKER`, mêmes filtres et contrôles que `crm_performance` : un agent ne lit que ses commandes et leurs colis). Logique d'affichage dans `src/domain/report-domain.mjs` (testée en Node), écrans dans `src/pages/report-parts.tsx`. Le mot « cohorte » n'est jamais affiché : on parle des « commandes créées pendant la période ».

| Bloc | Ce qu'il montre |
| --- | --- |
| L'essentiel | Reçues, taux de confirmation, **taux de livraison** = livrées ÷ (livrées + retournées), COD livré (montant ZR, reversement non vérifié). |
| Le parcours de vos commandes | Reçues → Confirmées → Expédiées (remises à ZR) → Livrées, avec le % à chaque étape ; barre livrées / retournées / en route ; perdues avant l'expédition et encore à traiter. Tant que des colis sont en route, le taux de livraison est annoncé **provisoire**. |
| À surveiller | Alertes en mots simples, seulement avec assez de données (20 commandes décidées ou 10 colis arrivés au bout) : confirmation < 65 %, livraison < 72 %, premier appel médian > 30 min, wilayas avec plus de 30 % de retours (5 colis minimum). Ce sont des **repères habituels du COD en Algérie** (`REPORT_MARKS`), pas des objectifs de la boutique ; à rendre réglables par entreprise. |
| Pourquoi des commandes sont perdues | Motif de la dernière décision Annulée / Faux numéro / Doublon (texte saisi, avec les motifs proposés), part des pertes. Les anciens statuts Woo sont exclus. |
| Wilayas | Toutes les wilayas ayant des commandes (10 affichées, bouton pour tout voir), tri par commandes ou par part de retours (5 colis minimum pour monter en tête) : confirmation, livrées, retournées, taux de livraison (signalé « bas » sous le repère), délai moyen remise ZR → livraison, COD livré. |
| Agents | Confirmation, **livraison de ses confirmées** (un agent qui force les confirmations crée des retours), premier appel médian (arrivée → première action : appel, rappel ou décision), appels sans réponse par commande. |
| Panier et heures | Panier moyen des confirmées, articles par commande, % à plusieurs articles, % traitées en 30 min, délai de livraison médian ; commandes par heure (heure d'Alger) pour planifier l'équipe d'appel. |

Le CSV exporte aussi le parcours, les wilayas, les motifs, les agents et le panier. Test SQL : `tests/insights.sql` (2 entreprises, 2 boutiques, propriétaire / agent / autre entreprise).

## Organisation de la page (29/10/2026, audit UX)
- **Barre de filtres compacte** (collée en haut sur ordinateur) : 7 j / 30 j / 90 j / 12 mois / Dates…, canal et agent appliqués immédiatement, rappel de la période et de la comparaison.
- **Six onglets**, un sujet par écran, avec lien direct `#performance/<onglet>` : Vue d'ensemble (`overview`), Pertes (`losses`), Wilayas (`wilayas`), Équipe & horaires (`team`), Produits & canaux (`products`), Marge & dépenses (`money`, responsables).
- **Vue d'ensemble** : 4 chiffres clés avec la variation par rapport à la période de même durée juste avant (`previousRange`, `periodDelta`, flèche + texte, jamais la couleur seule), puis « À surveiller », le parcours, l'évolution et « Comment lire ce rapport » replié.
- Les longues explications sont repliées ; « COD livré » ouvre la liste des commandes livrées dans Marge & dépenses.
