import { errorMessage, requestId } from "@domain/domain.mjs"
import { supabase } from "./supabase"

export async function rpc<T = any>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

export async function select<T = any>(builder: PromiseLike<{ data: any; error: any; count?: number | null }>) {
  const { data, error, count } = await builder
  if (error) throw error
  return { data: data as T, count: count ?? 0 }
}

// Same idempotency contract as the legacy UI: a retried identical command reuses its request id,
// so a network cut never creates a duplicate order, status change or invitation.
const pending = new Map<string, string>()
export async function command<T = any>(ctx: { userId: string; workspaceId: string }, action: string, payload: Record<string, unknown>) {
  const key = JSON.stringify([ctx.userId, ctx.workspaceId, action, payload])
  let id = pending.get(key)
  if (!id) {
    id = requestId()
    pending.set(key, id)
  }
  const result = await rpc<T>("crm_command", { p_workspace: ctx.workspaceId, p_action: action, p_payload: payload, p_request: id })
  pending.delete(key)
  return result
}
export const clearPendingCommands = () => pending.clear()

export const WOO_LABELS: Record<string, string> = {
  HISTORY_IMPORT_DISABLED: "L’import historique des commandes est désactivé ; les nouvelles commandes arrivent par webhook. Synchronisez toujours les produits ici.",
  ORDER_PREDATES_CONNECTION: "Commande créée avant la connexion de cette boutique : elle ne peut pas être reçue comme nouvelle vente.",
  INVALID_URL: "Utilisez l’URL HTTPS exacte de la boutique, avec son sous-dossier éventuel, sans /wp-admin ni /wp-json.",
  UNSAFE_HOST: "Cette adresse ne correspond pas à un serveur public autorisé.",
  DNS_FAILED: "Le domaine de la boutique est introuvable.",
  INVALID_KEYS: "Vérifiez la clé ck_ et le secret cs_ générés dans WooCommerce.",
  INVALID_METHODS: "Les identifiants de paiement doivent être séparés par des virgules.",
  WOO_AUTH: "WooCommerce refuse ces clés. Vérifiez leur permission Lecture et le compte utilisateur associé.",
  WOO_UNREACHABLE: "La boutique ne répond pas. Vérifiez sa disponibilité et son pare-feu, puis réessayez.",
  WOO_REDIRECT: "La boutique redirige cette URL. Saisissez son adresse HTTPS finale exacte (avec ou sans www).",
  WOO_NOT_FOUND: "L’API ou cette commande est introuvable. Vérifiez WooCommerce et les permaliens WordPress.",
  WOO_RATE_LIMIT: "La boutique limite les requêtes. Réessayez dans quelques instants.",
  WOO_RESPONSE: "La boutique ne renvoie pas de réponse WooCommerce valide. Vérifiez son pare-feu et ses extensions de sécurité.",
  STORE_URL_LOCKED: "Cette boutique CRM est liée à une autre URL. Ajoutez une boutique CRM pour connecter un autre site.",
  CONNECTION_CHANGED: "La connexion a été modifiée. Actualisez la page avant de reprendre.",
  SYNC_BUSY: "Un import est déjà en cours. Reprenez dans deux minutes si l’onglet précédent a été fermé.",
  IMPORT_NOT_STARTED: "Choisissez une date de départ pour lancer un import.",
  INVALID_DATE: "Choisissez une date de départ valide, antérieure à aujourd’hui.",
  INVALID_PHONE: "Téléphone manquant ou invalide dans WooCommerce. Corrigez-le puis cliquez sur Réessayer.",
  CUSTOMER_REQUIRED: "Nom du client manquant dans WooCommerce.",
  INVALID_ITEMS: "Les articles ou quantités de cette commande nécessitent une vérification dans WooCommerce.",
  INVALID_AMOUNT: "Les montants de cette commande nécessitent une vérification.",
  INVALID_REMOTE_DATE: "La date de cette commande est invalide.",
  PAYLOAD_TOO_LARGE: "La réponse dépasse la taille de sécurité autorisée.",
  SYNC_FAILED: "La synchronisation a échoué. Les commandes déjà importées sont conservées ; vous pouvez reprendre.",
  NON_COD: "Paiement autre que COD : commande ignorée.",
  CURRENCY_UNSUPPORTED: "Devise autre que DZD : commande ignorée.",
  STATUS_EXCLUDED: "Statut WooCommerce non pris en charge (ex. corbeille ou statut personnalisé).",
  PARTIAL_REFUND: "Remboursement partiel : montant à vérifier dans WooCommerce.",
  REMOTE_VERSION_AMBIGUOUS: "Deux versions WooCommerce portent la même date. La fiche CRM est conservée pour vérification.",
  CRM_EDIT_PRESERVED: "La fiche a déjà été travaillée dans le CRM. Vérifiez les dernières données WooCommerce.",
  PRODUCT_UNSUPPORTED: "Ce type de produit ne peut pas être vendu seul dans le catalogue CRM.",
  INVALID_PRODUCT: "Données produit WooCommerce à vérifier.",
  PRODUCT_IMPORTED: "Produit importé avec son stock WooCommerce géré.",
  PRODUCT_STOCK_UNMANAGED: "Produit importé, stock WooCommerce non géré : stock CRM à renseigner.",
  PRODUCT_MATCHED_SKU: "Produit rapproché par SKU ; vos valeurs CRM sont conservées.",
  PRODUCT_UPDATED: "Produit synchronisé depuis WooCommerce.",
  PRODUCT_CRM_PRESERVED: "Produit modifié dans le CRM ou stock inférieur aux réservations : valeurs conservées.",
  TRACKING_NOT_PROVEN: "Historique ignoré : aucun Purchase CAPI marqué envoyé. Vérifiez la Suite WeConvert sur cette boutique, puis réessayez.",
  TRACKING_RECONCILED: "Suivi Purchase rapproché de la fiche CRM existante.",
  ORDER_IMPORTED: "Commande WooCommerce reçue ; confirmation COD à vérifier dans le CRM.",
  ORDER_UPDATED: "Commande encore intacte mise à jour depuis WooCommerce.",
  CONNECTED: "Connexion vérifiée et enregistrée.",
  DISCONNECTED: "Connexion désactivée ; clés supprimées du serveur.",
  INVALID_SIGNATURE: "Le secret du webhook ne correspond pas.",
  FORBIDDEN: "Seuls le propriétaire et les administrateurs peuvent gérer les intégrations.",
  AUTH_REQUIRED: "Votre session a expiré. Reconnectez-vous.",
}
export const wooLabel = (code?: string) => (code ? WOO_LABELS[code] || code : "")

export function safeError(e: unknown): string {
  const err = e as { friendly?: boolean; message?: string } | null
  if (err?.friendly && err.message) return err.message
  return errorMessage(e)
}
