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
  CRM_EDIT_PRESERVED: "La fiche a déjà été travaillée dans le CRM. Vérifiez les dernières données WooCommerce.",
  REMOTE_VERSION_AMBIGUOUS: "Deux versions WooCommerce portent la même date. La fiche CRM est conservée pour vérification.",
  PARTIAL_REFUND: "Remboursement partiel : montant à vérifier dans WooCommerce.",
  INVALID_PHONE: "Téléphone manquant ou invalide dans WooCommerce. Corrigez-le puis cliquez sur Réessayer.",
  CUSTOMER_REQUIRED: "Nom du client manquant dans WooCommerce.",
  INVALID_ITEMS: "Les articles ou quantités de cette commande nécessitent une vérification dans WooCommerce.",
  INVALID_AMOUNT: "Les montants de cette commande nécessitent une vérification.",
  STATUS_EXCLUDED: "Statut WooCommerce non pris en charge (ex. corbeille ou statut personnalisé).",
}
export const wooLabel = (code?: string) => (code ? WOO_LABELS[code] || code : "")

export function safeError(e: unknown): string {
  return errorMessage(e)
}
