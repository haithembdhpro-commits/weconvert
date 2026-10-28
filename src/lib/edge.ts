import { supabase } from "./supabase"
import { WOO_LABELS } from "./api"

export const SHOPIFY_LABELS: Record<string, string> = {
  APP_NOT_CONFIGURED: "L’application Shopify WeConvert n’est pas encore configurée sur le serveur. Préparez son identifiant et son secret dans les variables sécurisées Supabase.",
  INVALID_SHOP: "Saisissez le domaine permanent « boutique.myshopify.com », sans https:// ni chemin.",
  INVALID_COD_METHODS: "Les noms des paiements COD doivent être séparés par des virgules.",
  SHOP_LOCKED: "Cette boutique CRM est déjà liée à un autre domaine Shopify. Créez une boutique CRM distincte.",
  FORBIDDEN: "Seuls le propriétaire et les administrateurs peuvent gérer cette connexion.",
  AUTH_REQUIRED: "Votre session a expiré. Reconnectez-vous.",
  INVALID_STATE: "Le lien Shopify a expiré. Relancez la connexion.",
  SHOPIFY_AUTH: "Shopify a refusé l’autorisation ou les droits de lecture des commandes.",
  SHOP_MISMATCH: "La commande reçue ne correspond pas à la boutique Shopify connectée ; elle a été ignorée. Reconnectez Shopify si le problème persiste.",
  REVOKE_FAILED: "La connexion est retirée du CRM, mais Shopify n’a pas confirmé la révocation : désinstallez l’application depuis l’administration Shopify.",
  INTEGRATION_ERROR: "La connexion Shopify a échoué. Réessayez plus tard.",
  NON_COD: "Paiement hors COD : commande ignorée.",
  CURRENCY_UNSUPPORTED: "Devise différente du DZD : commande ignorée.",
  REFUND_REVIEW: "Remboursement Shopify : montant à vérifier avant rapprochement.",
  WILAYA_REQUIRED: "Wilaya absente : complétez l’adresse dans Shopify.",
  ORDER_PREDATES_CONNECTION: "Commande créée avant la connexion : aucun import historique.",
  OAUTH_APPROVED: "Autorisation Shopify reçue ; première livraison webhook en attente.",
  RECEIVED: "Nouvelle commande reçue pour confirmation COD.",
  UPDATED: "Informations source actualisées.",
  ATTENTION: "Fiche CRM conservée : vérifiez les nouvelles informations Shopify.",
}

export const YOUCAN_LABELS: Record<string, string> = {
  APP_NOT_CONFIGURED: "Le canal est enregistré. WeConvert doit encore configurer son application YouCan avant de pouvoir lancer l’autorisation.",
  INVALID_CHANNEL_NAME: "Donnez un nom de canal de 2 à 100 caractères.",
  INVALID_STORE_URL: "Saisissez l’URL HTTPS de la boutique, sans chemin ni paramètres.",
  SHOP_URL_MISMATCH: "La boutique autorisée sur YouCan ne correspond pas à l’URL du canal. Vérifiez l’URL ou choisissez la bonne boutique lors de l’autorisation.",
  AUTH_IN_PROGRESS: "Une autorisation est déjà en cours pour ce canal. Attendez son retour avant de modifier l’URL.",
  INVALID_COD_METHODS: "Séparez les noms supplémentaires des moyens COD par des virgules.",
  SHOP_LOCKED: "Cette boutique CRM est déjà liée à une autre boutique YouCan. Ajoutez une boutique CRM distincte pour changer de boutique.",
  FORBIDDEN: "Seuls le propriétaire et les administrateurs peuvent gérer cette connexion.",
  AUTH_REQUIRED: "Votre session a expiré. Reconnectez-vous.",
  INVALID_STATE: "Le lien YouCan a expiré. Relancez l’autorisation.",
  YOUCAN_AUTH: "YouCan a refusé l’autorisation ou le jeton a expiré.",
  YOUCAN_UNREACHABLE: "L’API YouCan est momentanément indisponible.",
  HOOK_SUBSCRIBE_FAILED: "L’autorisation a réussi, mais les webhooks ne sont pas tous installés. Réactivez-les.",
  INTEGRATION_ERROR: "La connexion YouCan a échoué. Réessayez.",
  NON_COD: "Paiement hors COD : commande ignorée.",
  CURRENCY_UNSUPPORTED: "Devise différente du DZD : commande ignorée.",
  REFUND_REVIEW: "Remboursement YouCan : montant à vérifier.",
  CUSTOMER_REQUIRED: "Nom client absent sur YouCan.",
  INVALID_PHONE: "Téléphone absent ou invalide.",
  WILAYA_REQUIRED: "Wilaya absente sur YouCan.",
  INVALID_ITEMS: "Articles non exploitables sur la commande.",
  INVALID_AMOUNT: "Montant COD incohérent : vérification requise.",
  ORDER_PREDATES_CONNECTION: "Commande créée avant la connexion : aucun import historique.",
  OAUTH_APPROVED: "Autorisation YouCan reçue ; premier webhook en attente.",
  RECEIVED: "Nouvelle commande COD reçue.",
  UPDATED: "Informations source actualisées.",
  ATTENTION: "La fiche CRM est préservée : vérifiez la modification YouCan.",
  YOUCAN_UNINSTALLED: "Application désinstallée sur YouCan.",
  NOT_FOUND: "Cette commande YouCan ne peut plus être réessayée depuis ce canal.",
}

export const ZR_LABELS: Record<string, string> = {
  AUTH_REQUIRED: "Votre session a expiré. Reconnectez-vous.",
  FORBIDDEN: "Seuls les administrateurs peuvent gérer ZR Express.",
  INVALID_REQUEST: "Vérifiez les champs et réessayez.",
  INVALID_PLATFORM: "Choisissez la plateforme ZR utilisée par votre compte.",
  INVALID_KEYS: "Vérifiez vos identifiants API ZR.",
  INVALID_HUB: "Le Tenant ID et le dépôt de départ doivent être des UUID valides.",
  HUB_REQUIRED: "Renseignez le dépôt de départ ZR.",
  PLATFORM_LOCKED: "Cette boutique possède déjà des colis sur cette plateforme. Conservez la plateforme existante.",
  DISCONNECTED: "La connexion ZR est désactivée.",
  NOT_FOUND: "Commande ou colis introuvable.",
  CONNECTION_CHANGED: "La connexion a changé. Actualisez la page.",
  ORDER_NOT_READY: "La commande doit être confirmée et sans modification WooCommerce à vérifier.",
  ADDRESS_REQUIRED: "Complétez la commune et l’adresse sur la commande.",
  INVALID_ITEMS: "Cette commande doit contenir des articles.",
  ALREADY_SENT: "Un colis est déjà réservé pour cette commande. Vérifiez la liste des colis.",
  WILAYA_CODE_REQUIRED: "Renseignez le code officiel de la wilaya (1 à 69).",
  TERRITORY_REQUIRED: "Choisissez la wilaya et la commune dans le référentiel ZR.",
  READY_STATE_REQUIRED: "ZR ne retourne pas son statut Prêt à expédier. Aucun colis n’a été créé.",
  PICKUP_UNAVAILABLE: "L’envoi en point de retrait sur la nouvelle API nécessite une validation du contrat ZR. Utilisez une commande à domicile.",
  INVALID_TRACKING: "Le suivi ZR indiqué est invalide.",
  NEEDS_REVIEW: "Création incertaine : vérifiez le colis sur ZR avant de le rapprocher.",
  ZR_AUTH: "ZR refuse ces identifiants API.",
  ZR_UNREACHABLE: "ZR ne répond pas. Réessayez le test de connexion.",
  ZR_RESPONSE: "La réponse ZR est inattendue. Vérifiez dans votre compte ZR avant toute nouvelle tentative.",
  ZR_REJECTED: "ZR a refusé cette opération. Consultez votre compte ZR.",
  ZR_RATE_LIMIT: "ZR limite les demandes. Réessayez plus tard.",
  ZR_NOT_FOUND: "Colis introuvable chez ZR.",
  REFERENCE_MISMATCH: "La référence externe ZR ne correspond pas à cette commande WooCommerce.",
  PARCEL_MISMATCH: "Le téléphone ou le montant COD ne correspond pas : colis non lié.",
}

const LABELS: Record<string, [Record<string, string>, string]> = {
  "weconvert-woocommerce": [WOO_LABELS, "SYNC_FAILED"],
  "weconvert-shopify": [SHOPIFY_LABELS, "INTEGRATION_ERROR"],
  "weconvert-youcan": [YOUCAN_LABELS, "INTEGRATION_ERROR"],
  "weconvert-zr": [ZR_LABELS, "ZR_RESPONSE"],
}

/** Calls an Edge Function action. Errors carry the provider code and a ready-to-show French label. */
export async function edge<T = any>(fn: keyof typeof LABELS | string, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const [labels, fallback] = LABELS[fn] || [{}, "INTEGRATION_ERROR"]
  const fail = (code: string) => Object.assign(Error(labels[code] || code), { code, friendly: !!labels[code] })
  const { data, error } = await supabase.functions.invoke(fn, { body: { action, ...body } })
  if (error) {
    let code = ""
    try {
      code = (await (error as any).context.json()).error
    } catch {}
    throw fail(code || fallback)
  }
  if (data?.error) throw fail(data.error)
  return data as T
}

export const ZR_STATES: Record<string, [string, "warning" | "danger" | "info" | "success" | "neutral"]> = {
  sending: ["Envoi en cours", "warning"],
  needs_review: ["À vérifier chez ZR", "danger"],
  submitted: ["Prêt à expédier", "info"],
  in_transit: ["En transit", "info"],
  out_for_delivery: ["En livraison", "warning"],
  ready_for_pickup: ["Au point de retrait", "info"],
  delivered: ["Livré", "success"],
  failed_delivery: ["Échec de livraison", "danger"],
  returning: ["En retour", "warning"],
  returned: ["Retourné", "neutral"],
  cancelled: ["Annulé chez ZR", "neutral"],
  exception: ["Incident", "danger"],
  unknown: ["Statut ZR inconnu", "neutral"],
}
