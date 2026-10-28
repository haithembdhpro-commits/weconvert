# Livraisons · ZR Express

La section **Livraisons** reprend la coque et les composants du CRM. Seuls les propriétaires et administrateurs peuvent configurer le transporteur, créer un colis, relire son suivi ou rapprocher une création incertaine. Les agents peuvent lire les colis de leurs commandes affectées par RLS, mais l'écran d'exploitation ZR reste réservé aux administrateurs.

## Configurer une boutique

Dans `Livraisons → Connecter ZR Express`, choisir le compte utilisé :

| Plateforme | Identifiants | Vérification | API |
| --- | --- | --- | --- |
| Nouvelle ZR | Tenant ID (UUID), Secret/API Key, ID du dépôt de départ (UUID) | `POST /api/v1/workflows/search` | `https://api.zrexpress.app` |
| Historique | Token, Clé | `GET /api_v1/token` | `https://procolis.com` |

Chaque boutique CRM a sa propre connexion. Sur la nouvelle plateforme, saisissez le Tenant ID et la clé, puis cliquez sur **Trouver mes dépôts ZR** pour choisir l'ID du dépôt de départ. Le serveur vérifie les identifiants et l'appartenance du dépôt avant de les enregistrer dans Supabase Vault. Les tables publiques n'exposent jamais les clés. Le changement de plateforme est bloqué après le premier colis pour conserver la cohérence des historiques. La déconnexion efface les clés et conserve les colis.

## Envoyer un colis

1. Confirmer la commande dans le CRM avec commune, adresse et articles. Une commande WooCommerce signalée « à vérifier » ne peut pas être envoyée.
2. Dans **Prêtes à expédier**, contrôler le client, la destination et le montant COD, puis cliquer sur **Créer le colis**.
3. Sur la plateforme historique, vérifier le code de wilaya 1–58. Sur la nouvelle plateforme, choisir la wilaya et la commune dans le référentiel renvoyé par ZR. La nouvelle API accepte ici les livraisons à domicile ; l'envoi en point de retrait est bloqué tant que sa sélection de dépôt de destination n'est pas confirmée par contrat ZR.
4. Le serveur réserve l'envoi une seule fois et crée le colis avec la référence stable `WC<numéro>-<suffixe>`. Il garde la réponse de ZR et son statut brut. Un délai ou une réponse ambiguë donne « À vérifier chez ZR » : **ne pas créer un deuxième colis**. Rechercher cette référence dans le compte ZR puis utiliser **Rapprocher** avec son ID ou suivi. Le rapprochement vérifie la référence externe.

Sur la nouvelle API, l'envoi cherche le statut `ReadyToDispatch` avant la création. Si le statut n'est pas disponible, aucun colis n'est réservé ou créé. Une création acceptée par ZR mais suivie d'une erreur de lecture conserve l'ID distant pour le rapprochement.

## Suivre

Le bouton **Suivi** interroge ZR à la demande. L'écran montre le statut normalisé, le libellé brut, la dernière vérification et les dix derniers événements. Le statut de confirmation de la commande n'est pas modifié par le suivi transporteur. **Stock (décision du 28/10/2026)** : quand un colis quitte l'état « envoi / à vérifier » (remis à ZR), le stock physique et la réservation des produits de la commande diminuent une seule fois, et l'historique de la commande l'indique (« Colis remis à ZR »). Un colis **retourné** remet les quantités en stock sans les réserver ; un colis **annulé chez ZR** remet le stock et la réservation si la commande est toujours confirmée. Les colis historiques rattachés sans réservation CRM ne touchent jamais au stock. **Livré** est un statut opérationnel ZR, pas une preuve de reversement financier ; le montant affiché reste le COD demandé. Le serveur vérifie automatiquement au plus 12 colis échus toutes les cinq minutes : les états en cours sont revérifiés après 15 minutes, et les états terminaux après 12 heures. Le bouton **Synchroniser les statuts** permet aussi un contrôle à la demande, par lots de 5 pages (150 colis) ; s'il en reste, le bouton devient « Continuer la synchronisation · page N » et reprend là où il s'est arrêté. Le rattachement des colis existants ne charge que les commandes dont la référence figure sur la page ZR traitée (aucun plafond de volume par boutique).

## Rattacher les colis déjà présents chez ZR

Pour la nouvelle plateforme, **Rattacher les colis ZR existants** parcourt le compte ZR par pages de 50. La recherche est en lecture seule côté transporteur : elle ne crée aucun colis. Une commande WooCommerce est liée à un colis uniquement si la référence externe correspond exactement au numéro ou à l'ID Woo, si le téléphone normalisé est le même et si le montant COD est identique. Les colis ambigus, absents de Woo ou en désaccord restent non liés ; **Rattacher un suivi précis** permet de les examiner individuellement avec ces mêmes contrôles. L'import est idempotent et conserve l'historique local des changements d'état.

Les statuts ZR `Livré` et `Récupéré par le fournisseur` deviennent respectivement **Livré** et **Retourné**. Le rapport agrège les commandes rattachées par canal et période de création ; il ne transforme pas la commande WooCommerce en commande « confirmée » et ne prouve pas que le transporteur a reversé l'argent.

Dans **Performance & rapports**, la carte **Commandes livrées** et sa liste comptent les commandes **créées** pendant la période sélectionnée (heure d'Alger) et dont le colis est **actuellement** au statut normalisé `Livré` chez ZR. Les filtres canal et agent s'appliquent à ces commandes, et une ligne ouvre sa fiche CRM. C'est la même cohorte que dans **Livraison & marge COD** lorsque tous les agents sont sélectionnés. Le tableau de bord applique cette définition aux commandes créées sur les **7 derniers jours** ; l'export CSV nomme explicitement la cohorte.

La date `lastStateUpdateAt` importée de ZR peut dater un état financier ultérieur (`encaisse`, `recouvert`) ; elle **ne prouve pas** la date physique de livraison. Les colis historiques ne permettent donc pas encore un décompte fiable des *livraisons effectuées pendant la période*, indépendamment de leur date de commande. Le champ historique `crm_shipments.delivered_at` conserve cette approximation pour compatibilité, mais les rapports ne l'utilisent plus comme date de remise. Une métrique par vraie date de livraison exigera un historique ZR horodaté et vérifié.

La liste de préparation affiche 50 commandes. Les colis sont filtrables par statut ZR (**Toutes**, **Livrées**, **Retournées**, **Autres statuts**) puis paginés par 50, y compris les anciens, afin de voir leurs fiches et de saisir leurs frais. Le filtre **Livrées** couvre toutes les dates, indépendamment de la période du rapport Performance. La lecture ZR et le rapprochement ont été vérifiés sur le compte de Kitabooklibrary. Les étiquettes, les points relais de la nouvelle API et le reversement COD réel ne sont pas encore traités. Aucun test automatisé n'envoie de colis réel.

Sources de contrat : [documentation historique ZR](https://zrexpress.com/ZREXPRESS_WEB/FR/Developpement.awp) et [implémentation open source des deux adaptateurs](https://github.com/cd0uze/courier-dz/tree/main/src/adapters). Les formes de réponse doivent être confirmées avec les identifiants de la boutique avant un premier envoi en production.
