# WeConvert CRM — commandes & confirmation

Socle du backend CRM et première intégration WooCommerce, raccordée au fichier **WeConvert-CRM-COD (2).html** fourni le 25 octobre 2026. Le prototype approuvé reste dans `references/approved-frontend.html` ; ses règles de base sont conservées, avec une feuille de style visuelle chargée après elles.

## Direction UI appliquée au frontend

Le [guideline WeConvert](docs/WECONVERT_GUIDELINES_UI.md) et les deux images dans `references/ui/` constituent le contrat visuel. La coque, les trois KPI, la carte d’activité, les tableaux, les commandes et la confirmation utilisent désormais ses tokens clair/sombre, la police Outfit et les icônes Lucide. Les futurs modules doivent partager ce système, sans refonte spontanée ni données factices. Les propositions du guide relatives aux modules non codés restent des spécifications.

## Fonctionnement livré

- Connexion Supabase par e-mail et mot de passe ; inscription, confirmation et récupération via les e-mails du projet.
- Création de l’entreprise et de sa première boutique après connexion. Ajout de boutiques et séparation des entreprises.
- Propriétaire, administrateur et agent. Un agent accède uniquement à ses commandes affectées ; ses nouvelles commandes lui sont affectées automatiquement.
- Invitations liées à une adresse e-mail vérifiée, valables 7 jours, à partager manuellement. Aucun e-mail d’invitation n’est envoyé par le CRM.
- Catalogue simple, SKU unique par boutique, prix, stock physique, réservé et disponible ; ajustements motivés et historisés.
- Commandes et lignes : client, téléphone normalisé, wilaya libre, commune, adresse, mode de livraison, frais, remise et source.
- Saisie des canaux site web, WhatsApp, Messenger, Instagram, téléphone et manuel. Il s’agit de la provenance saisie, **pas d’une connexion API à ces services**.
- Recherche et pagination serveur, filtre par statut/agent, export CSV des résultats filtrés, affectation individuelle ou par sélection.
- File de confirmation, appels sans réponse, rappels datés, notes, motifs d’annulation, doublons et faux numéros.
- Confirmation transactionnelle et réservation du stock ; libération à l’annulation ou à la réouverture par un administrateur.
- Historique append-only. La fiche affiche les 100 derniers événements ; la base conserve l’intégralité.
- Dashboard calculé sur les commandes autorisées ; activité sur sept jours en heure d’Alger. Taux de confirmation = commandes actuellement confirmées / toutes les commandes visibles.
- Performance & rapports : périodes de 7/30/90/365 jours ou personnalisées, filtres canal et agent selon le rôle, évolution, statuts, tableaux par canal/wilaya/produit/agent et export CSV des agrégats. Voir [les définitions et limites](docs/performance.md).
- Thème clair/sombre. Les données métier ne sont plus stockées dans le localStorage de l’ancien prototype.

## Avant la première utilisation réelle

1. La Site URL et l’URL de redirection autorisée dans **Supabase → Authentication → URL Configuration** ont été réglées sur `https://weconvert-cod-studio-ht26.citrus-mug-9991.chatgpt.site/`, puis relues dans un nouvel onglet. Aucun wildcard ni URL externe n’a été ajouté.
2. Le SMTP personnalisé est désactivé dans le projet (vérifié dans SMTP Settings). Les modèles par défaut sont utilisés. Vérifier la réception des confirmations/récupérations avec le premier compte, puis configurer un SMTP adapté avant d’ouvrir les inscriptions à l’équipe et aux clients. Aucun e-mail réel ni mot de passe personnel n’a été utilisé pendant les tests.
3. Créer le premier compte dans l’application, confirmer son e-mail, puis créer l’entreprise et sa boutique.
4. Ajouter un produit et son stock, puis une commande d’essai. Vérifier confirmation, réservation et annulation avant de traiter des commandes réelles.

Le Site conserve son audience privée, propriétaire uniquement. Une invitation CRM ne modifie pas l’accès à l’hébergement Sites : un coéquipier devra aussi pouvoir ouvrir le Site, ou le CRM devra être hébergé sur un domaine accessible à l’équipe. Aucune audience n’a été élargie automatiquement.

## Architecture et sécurité

Frontend statique HTML/CSS/JS. Le SDK Supabase est embarqué dans le bundle avec une **clé publiable**. Aucune clé service_role ou secrète n’est nécessaire dans le navigateur.

Toutes les tables publiques sont en RLS. Le rôle authenticated dispose de SELECT uniquement. Les mutations passent par `crm_command`. Son implémentation transactionnelle est dans le schéma privé `crm_private`, avec contrôle des memberships en base, search_path fixe et EXECUTE révoqué pour PUBLIC/anon. Les wrappers publics sont SECURITY INVOKER.

Chaque écriture porte un identifiant de requête. Une répétition identique renvoie le résultat déjà enregistré ; le même identifiant avec un autre contenu est refusé. Les mises à jour utilisent une version attendue. La confirmation verrouille les produits dans un ordre déterministe avant de réserver le stock.

Un agent peut corriger l’adresse tout en conservant les prix ou remises déjà accordés. Les anciennes lignes sont enregistrées dans l’événement d’édition. Aucun rôle applicatif ne peut supprimer une commande ou modifier l’historique directement.

Les changements sont reçus par WebSocket et actualisent immédiatement les listes et compteurs, sans remplacer les filtres ni les formulaires ouverts. Une réconciliation de secours toutes les 30 secondes couvre les coupures et les rappels arrivés à échéance. Une erreur conserve la saisie ; un conflit de version demande de rouvrir la fiche. Pas de mode hors ligne ni d’envoi différé automatique des brouillons.

## Développement

```sh
npm ci
npm run check
npm run build
npm test
```

Le build produit `dist/index.html`, `dist/styles.css`, `dist/app.js` et le HTML autonome `WeConvert-CRM-COD.html`. Pour l’authentification, utiliser le Site HTTPS ou un serveur local autorisé dans Supabase, plutôt qu’une URL file://.

- `src/crm.js` : écrans, état et appels RPC.
- `src/ui.js`, `src/icon-registry.mjs`, `src/style.css`, `src/crm.css`, `src/visual.css` : composants, Lucide, base approuvée et contrat visuel.
- `src/domain.mjs`, `src/report-domain.mjs`, `src/performance-ui.js`, `src/shipping-ui.js` : calcul COD, rapports et écran de livraison ZR Express.
- `src/config.json` : URL Supabase et clé publiable.
- `supabase/migrations/` : migrations appliquées à `loxdcfxxefigfchmrwzy` ; versions alignées sur l’historique distant.
- `tests/database.sql`, `tests/edge-cases.sql`, `tests/woocommerce.sql`, `tests/performance.sql`, `tests/shipping.sql` : tests SQL à exécuter dans une transaction terminée par **ROLLBACK**.

L’historique Git conserve les anciennes sources de simulation. Elles ne sont plus le point d’entrée du CRM.

## Validation effectuée

- Tests SQL hébergés : isolation des entreprises/boutiques, droits agents, révocation immédiate, refus anonyme, refus des écritures directes, invitation liée à l’e-mail, idempotence, versions obsolètes, réservations/libérations, refus de survente, adresse obligatoire, rappels passés, prix convenus, recalcul des montants et historique.
- Les fixtures Auth et métier ont été créées puis annulées dans ces transactions. Aucun faux compte ni aucune fausse commande ne subsiste. Les séquences PostgreSQL peuvent conserver des trous après rollback.
- API publique interrogée avec la clé publiable sans session : accès table et RPC refusés, HTTP 401 / code 42501.
- Tests Node : calcul en centimes, protection CSV, dates, messages d’erreur, initiales Unicode, identifiants de requête, conservation du CSS et absence du jeu d’essai dans le bundle.
- Navigateur : écran de connexion réel ; dashboard, formulaire, canal, montant COD, file de confirmation, rappel et conservation des saisies après erreur sur un jeu visuel isolé sans connexion Supabase ; thèmes et navigation mobile à 390 px.
- Contrôle de sécurité Supabase : aucune anomalie RLS/fonction sur le CRM et le connecteur. Un avertissement distinct concerne la protection des mots de passe compromis, désactivée dans Auth.

Limites : aucun parcours navigateur connecté avec un compte personnel, aucun e-mail envoyé, aucun test de charge ni campagne concurrente multi-session. Le premier parcours Auth + navigateur réel et la délivrabilité des e-mails restent à vérifier ; les URL de redirection sont configurées.

## Suite du périmètre CODPilot / Confirmoo

Les modules suivants restent dans la navigation avec l’état « À venir » :

1. Clients, doublons enrichis et affectation automatique.
2. Étiquettes, points relais de la nouvelle API ZR, synchronisation planifiée du suivi, autres transporteurs, retours et échanges. La première intégration ZR est dans Livraisons.
3. Gestion complète des variantes, catégories, packs, inventaires, fournisseurs et achats (les variantes commandées sur WooCommerce sont déjà importées comme articles distincts).
4. Encaissements COD, rapprochements, coûts, marges, livraison réelle et attribution publicitaire (absents du rapport CRM actuel).
5. Messageries connectées, automatisations, Suite WordPress, UTM, attribution et événements Pixel/CAPI.
6. Abonnement et facturation. Aucun quota commercial de commandes, agents ou boutiques n’est codé dans cette tranche.

Les rappels sont des dates dans la file CRM, pas des notifications push ni des messages automatiques. Appeler ouvre le gestionnaire téléphonique de l’appareil ; aucun appel n’est lancé par le serveur.

## Intégration WooCommerce

La section **Intégrations** est raccordée : connexion avec clés API en lecture, import de toutes les commandes COD historiques ou d’une période choisie, traduction des statuts WooCommerce, synchronisation manuelle des produits simples et variantes, webhooks signés, journal, reprise et références sans doublons. Voir [la procédure et les limites](docs/woocommerce.md). Les fonctions Edge et migrations sont dans `supabase/`. Une commande historique terminée devient confirmée sans réservation rétroactive ; le stock et les statuts WooCommerce ne sont jamais modifiés par le CRM.

## Livraisons · ZR Express

La section **Livraisons** permet de connecter l'une des deux plateformes ZR, de créer volontairement un colis depuis une commande confirmée, de relire son statut et de rapprocher un envoi incertain sans double création. Voir [la procédure ZR et ses limites](docs/shipping-zr.md). Les commandes ne changent pas de statut CRM après un statut transporteur ; le COD affiché n'est pas un encaissement confirmé.

## Affichage en temps réel

`src/live-sync.mjs` gère une souscription par utilisateur/boutique, les rafales, le rattrapage à la reconnexion et les changements de boutique. `crm_live_stores`, publiée dans Supabase Realtime, ne contient que des identifiants et une révision ; les commandes sont toujours relues via les API avec RLS. Une transaction produit un signal par boutique. Les notes en cours et les fenêtres de saisie sont conservées.

Le badge **En direct** indique une connexion active. L’objectif est un affichage en moins d’une seconde après réception dans le CRM sur une connexion normale ; il n’est pas une garantie du délai total de livraison des webhooks WordPress. Un webhook v3 complet et signé est traité directement, sans relire la même commande via WooCommerce. Les notifications minimales conservent cette relecture.

Validation de la synchronisation : tests Node et SQL sous transaction annulée, essais d’interface isolés (dont une arrivée affichée en 24 ms avec conservation de la recherche). Le test de création de commandes de démonstration sur le projet hébergé a été refusé par le contrôle automatique et n’a pas été poursuivi. Le compte de test inutilisé a été supprimé ; aucun espace ni aucune commande n’y avaient été créés. Les mesures d’interface simulées ne constituent pas une mesure WooCommerce → navigateur en production.

Validation complémentaire sur la session réelle du propriétaire, le 26 octobre 2026 : badge « En direct », signal de révision reçu via WebSocket, données relues et écran mis à jour automatiquement. Le signal serveur a été émis à `00:34:00.389670Z` et le rendu terminé à `00:34:00.926Z`, soit environ **536 ms**, dont **180 ms** entre réception du signal dans le navigateur et fin du rendu. Il s’agit d’un contrôle de synchronisation, sans création ni modification de commande, et d’une mesure ponctuelle dépendant des horloges/réseaux. Capture : `docs/realtime-active.png`.

## Nouvelle interface React (en cours)
Une interface React + Tailwind + shadcn/ui est développée dans `app/`, à côté de l'interface actuelle et sur le même backend. Voir `docs/UI-REACT.md` pour l'état, les écrans migrés et la procédure de build.
