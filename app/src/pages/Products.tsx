import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Box, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, FormField, PageHeader, Pager } from "@/components/app/page"
import { FormDialog } from "@/components/app/FormDialog"
import { ToneBadge } from "@/components/app/tone"
import { useSubmit } from "@/components/app/useSubmit"
import { rpc, safeError, select } from "@/lib/api"
import { f, money } from "@/lib/format"
import { useProducts } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { supabase } from "@/lib/supabase"
import type { Product } from "@/lib/types"
import { useDebounced } from "./Orders"

type DialogState = { kind: "edit" | "cost" | "stock"; product: Product | null } | null

export function Products() {
  const s = useSession()
  const qc = useQueryClient()
  const [q, setQ] = useState("")
  const query = useDebounced(q)
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<DialogState>(null)
  const list = useProducts(query, page)
  const costs = useQuery({
    queryKey: ["store", s.store, "product-costs"],
    enabled: !!s.store && s.manager,
    queryFn: () => select<{ product_id: string; unit_cost: number }[]>(supabase.from("crm_product_costs").select("product_id,unit_cost").eq("store_id", s.store!)),
  })
  const costOf = (id: string) => costs.data?.data.find((c) => c.product_id === id)
  const products = list.data?.data || []
  const sub = useSubmit()
  const refresh = () => qc.invalidateQueries({ queryKey: ["store", s.store] })

  useEffect(() => setPage(1), [query, s.store])

  const close = () => {
    setDialog(null)
    sub.reset()
  }
  const p = dialog?.product

  return (
    <>
      <PageHeader
        title="Les bons produits. Le bon stock."
        description="Le stock disponible tient compte des commandes confirmées."
        actions={
          s.manager && (
            <Button size="lg" onClick={() => setDialog({ kind: "edit", product: null })}>
              <Plus />
              Nouveau produit
            </Button>
          )
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="relative min-w-[220px] flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un produit…" aria-label="Rechercher un produit" className="pl-9" />
          </div>
          <span className="text-xs text-muted-foreground">Stock physique − réservé = disponible</span>
        </div>
        {list.isError && <p className="p-4 text-sm text-danger">{safeError(list.error)}</p>}
        {!products.length ? (
          <EmptyState icon={<Box />} title={query ? "Aucun produit trouvé" : "Aucun produit"} description={query ? "Essayez un autre nom." : "Ajoutez votre premier produit pour créer des commandes."} />
        ) : (
          <div role="region" aria-label="Catalogue, défilement horizontal si nécessaire" tabIndex={0} className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Produit</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Prix de vente</TableHead>
                  {s.manager && <TableHead className="text-right">Coût d’achat estimé</TableHead>}
                  <TableHead className="text-right">Physique</TableHead>
                  <TableHead className="text-right">Réservé</TableHead>
                  <TableHead>Disponible</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((x) => {
                  const free = x.stock - x.reserved
                  const c = costOf(x.id)
                  return (
                    <TableRow key={x.id}>
                      <TableCell className="font-medium">{x.name}</TableCell>
                      <TableCell className="text-muted-foreground">{x.sku}</TableCell>
                      <TableCell className="num text-right">{money(x.price)}</TableCell>
                      {s.manager && <TableCell className="num text-right">{c ? money(c.unit_cost) : <span className="text-warning">À renseigner</span>}</TableCell>}
                      <TableCell className="num text-right">{f(x.stock)}</TableCell>
                      <TableCell className="num text-right">{f(x.reserved)}</TableCell>
                      <TableCell>
                        <ToneBadge tone={free > 0 ? "success" : "danger"}>
                          <span className="num">{f(free)}</span>
                        </ToneBadge>
                      </TableCell>
                      <TableCell>
                        {s.manager ? (
                          <div className="flex flex-wrap gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "edit", product: x })}>Modifier</Button>
                            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "cost", product: x })}>Coût d’achat</Button>
                            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "stock", product: x })}>Stock</Button>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Lecture seule</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <Pager total={list.data?.count || 0} page={page} onPage={(n) => setPage(Math.max(1, n))} />
      </Card>

      {dialog?.kind === "edit" && (
        <FormDialog
          id="product-form"
          title={p ? "Modifier le produit" : "Nouveau produit"}
          submitLabel="Enregistrer"
          busy={sub.busy}
          error={sub.error}
          onClose={close}
          onSubmit={(d) =>
            sub.run(async () => {
              await s.command("product.save", {
                name: d.name, sku: d.sku, price: Number(d.price), stock: Number(d.stock || 0),
                store_id: s.store, id: p?.id || null, version: p?.version || null,
              })
              toast.success("Produit enregistré.")
              await refresh()
              close()
            })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom du produit" htmlFor="p-name" required className="sm:col-span-2">
              <Input id="p-name" name="name" defaultValue={p?.name} required minLength={2} maxLength={160} />
            </FormField>
            <FormField label="Référence SKU" htmlFor="p-sku" required>
              <Input id="p-sku" name="sku" defaultValue={p?.sku} required maxLength={80} />
            </FormField>
            <FormField label="Prix de vente (DA)" htmlFor="p-price" required>
              <Input id="p-price" name="price" type="number" min={0} step={0.01} defaultValue={p?.price ?? 0} required className="num" />
            </FormField>
            {!p && (
              <FormField label="Stock physique initial" htmlFor="p-stock" required>
                <Input id="p-stock" name="stock" type="number" min={0} step={1} defaultValue={0} required className="num" />
              </FormField>
            )}
          </div>
        </FormDialog>
      )}
      {dialog?.kind === "cost" && p && (
        <FormDialog
          id="product-cost-form"
          title={"Coût d’achat · " + p.name}
          description="Coût unitaire en DA. Pour les anciennes commandes Woo, le rapport utilise ce coût actuel comme estimation, sans reconstruire le prix payé à l’époque."
          submitLabel="Enregistrer"
          busy={sub.busy}
          error={sub.error}
          onClose={close}
          onSubmit={(d) =>
            sub.run(async () => {
              await rpc("crm_cost_command", { p_store: s.store, p_action: "product", p: { product_id: p.id, unit_cost: Number(d.unit_cost) } })
              toast.success("Coût enregistré.")
              await refresh()
              close()
            })
          }
        >
          <FormField label="Coût d’achat unitaire (DA)" htmlFor="c-cost" required>
            <Input id="c-cost" name="unit_cost" type="number" min={0} step={0.01} defaultValue={costOf(p.id)?.unit_cost ?? ""} required className="num" />
          </FormField>
        </FormDialog>
      )}
      {dialog?.kind === "stock" && p && (
        <FormDialog
          id="stock-form"
          title="Ajuster le stock"
          description={`${p.name} · ${f(p.stock)} physiques, ${f(p.reserved)} réservés. Les réservations sont protégées et chaque ajustement est historisé.`}
          submitLabel="Mettre à jour"
          busy={sub.busy}
          error={sub.error}
          onClose={close}
          onSubmit={(d) =>
            sub.run(async () => {
              await s.command("stock.adjust", { store_id: s.store, id: p.id, version: p.version, delta: Number(d.delta), reason: d.reason })
              toast.success("Stock mis à jour.")
              await refresh()
              close()
            })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Variation (+ entrée / − sortie)" htmlFor="s-delta" required>
              <Input id="s-delta" name="delta" type="number" step={1} required className="num" />
            </FormField>
            <FormField label="Motif" htmlFor="s-reason" required>
              <Input id="s-reason" name="reason" required minLength={2} maxLength={2000} />
            </FormField>
          </div>
        </FormDialog>
      )}
    </>
  )
}
