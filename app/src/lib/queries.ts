import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { rpc, select } from "./api"
import { supabase } from "./supabase"
import { useSession } from "./session"
import type { Order, Overview, Product } from "./types"

export const PAGE_SIZE = 20

export function useOverview() {
  const { store } = useSession()
  return useQuery({
    queryKey: ["store", store, "overview"],
    queryFn: () => rpc<Overview>("crm_overview", { p_store: store }),
    enabled: !!store,
    placeholderData: keepPreviousData,
  })
}

export type OrderFilter = { status: string; q: string; page: number; agent: string; ascending: boolean; size?: number }

export function useOrders(f: OrderFilter) {
  const { store } = useSession()
  return useQuery({
    queryKey: ["store", store, "orders", f],
    queryFn: () =>
      rpc<{ items: Order[]; total: number }>("crm_list_orders", {
        p_store: store,
        p_status: f.status,
        p_query: f.q,
        p_page: f.page,
        p_size: f.size ?? PAGE_SIZE,
        p_agent: f.agent || null,
        p_ascending: f.ascending,
      }),
    enabled: !!store,
    placeholderData: keepPreviousData,
  })
}

export function useOrderDetail(id: string | null) {
  const { store } = useSession()
  return useQuery({
    queryKey: ["store", store, "order", id],
    queryFn: async () => {
      const o = await rpc<Order | null>("crm_order_detail", { p_id: id })
      if (!o) throw Error("NOT_FOUND")
      return o
    },
    enabled: !!store && !!id,
  })
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&")

export function useProducts(q: string, page: number) {
  const { store } = useSession()
  return useQuery({
    queryKey: ["store", store, "products", q, page],
    queryFn: () =>
      select<Product[]>(
        supabase
          .from("crm_products")
          .select("*", { count: "exact" })
          .eq("store_id", store!)
          .ilike("name", "%" + escapeLike(q) + "%")
          .order("name")
          .order("id")
          .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
      ),
    enabled: !!store,
    placeholderData: keepPreviousData,
  })
}

export async function searchProducts(store: string, text = "") {
  const { data } = await select<Product[]>(
    supabase.from("crm_products").select("*").eq("store_id", store).ilike("name", "%" + escapeLike(text) + "%").order("name").order("id").limit(80),
  )
  return data
}
