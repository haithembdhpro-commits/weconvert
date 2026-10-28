export type Role = "owner" | "admin" | "agent"
export type Member = { user_id: string; display_name: string; role: Role; active: boolean }
export type Store = { id: string; name: string; workspace_id: string }
export type Workspace = { id: string; name: string }

export type OrderItem = { product_id: string; product_name: string; sku: string; quantity: number; unit_price: number }
export type OrderEvent = { id?: number; kind: string; actor_name: string; created_at: string; data: Record<string, any> }

export type Order = {
  id: string
  number: number
  version: number
  customer_name: string
  phone: string
  wilaya: string
  commune: string
  address: string
  channel: string
  source_detail?: string
  delivery_type: "home" | "desk"
  status: string
  status_origin?: string
  assigned_to: string | null
  callback_at: string | null
  attempts: number
  fee: number
  discount: number
  total: number
  created_at: string
  items: OrderItem[]
  woo_attention?: boolean
  woo_snapshot?: Record<string, any> | null
  woo_number?: number
  woo_status?: string
  woo_purchase_event_id?: string | null
  source_provider?: string | null
  source_snapshot?: Record<string, any> | null
  source_status?: string | null
  source_attention?: boolean
  /** Board only: logistic stage and the CRM parcel (carrier state, not a cash collection). */
  stage?: OrderStage
  shipment?: { state: string; raw_status: string | null; tracking: string | null; updated_at: string } | null
  source_external_id?: string | null
  events?: OrderEvent[]
}

export type Overview = Partial<{
  all: number
  today: number
  new: number
  pending: number
  confirmed: number
  confirmed_verified: number
  rate_base: number
  confirmed_verified_amount: number
  cancelled: number
  callbacks: number
  due: number
  woo_confirmation_unverified: number
  woo_cancellation_unverified: number
  days: { date: string; count: number }[]
}>

export type Product = {
  id: string
  name: string
  sku: string
  price: number
  stock: number
  reserved: number
  version: number
  store_id: string
}

export type OrderStage = "new" | "preparing" | "dispatched" | "delivered" | "returned" | "closed"
export type OrderBoard = { items: Order[]; total: number; stages: Partial<Record<OrderStage, number>> }
