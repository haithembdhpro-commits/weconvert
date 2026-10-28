import { Link2, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/app/page"
import { ToneBadge } from "@/components/app/tone"
import { TITLES } from "@/components/app/AppShell"
import { navigate } from "@/lib/router"

const FUTURE: Record<string, string[]> = {
  returns: ["Retours, échanges et remise en stock", "Suivi des motifs de refus"],
  clients: ["Annuaire unifié par téléphone", "Historique client, doublons et liste noire"],
  purchases: ["Fournisseurs et bons d’achat", "Réceptions et coûts d’achat"],
  finance: ["Encaissements COD et rapprochement", "Charges, trésorerie et marge"],
  ads: ["UTM et identifiants publicitaires", "Attribution jusqu’à la livraison et déduplication Pixel / CAPI"],
  suite: ["Raccordement de votre Suite WordPress", "Collecte des commandes et événements de tracking"],
  messages: ["Boîte de réception WhatsApp, Messenger et Instagram", "Passage d’une conversation à une commande"],
  automation: ["Affectation automatique et rappels", "Règles et scénarios métier"],
  pos: ["Ventes comptoir", "Tickets et sessions de caisse"],
}

export function Planned({ route }: { route: string }) {
  return (
    <>
      <PageHeader title={TITLES[route]} description="Ce module sera raccordé au socle CRM dans une prochaine étape." />
      <Card className="max-w-3xl gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
            <Link2 className="size-[18px]" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">À connecter progressivement</h2>
            <p className="text-sm text-muted-foreground">Aucune donnée n’est affichée tant que le module n’est pas branché.</p>
          </div>
        </div>
        <ul className="grid gap-2">
          {(FUTURE[route] || []).map((t) => (
            <li key={t} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-sm">
              {t}
              <ToneBadge>À venir</ToneBadge>
            </li>
          ))}
        </ul>
        <div>
          <Button onClick={() => navigate("orders")}>
            <ShoppingBag />
            Ouvrir les commandes
          </Button>
        </div>
      </Card>
    </>
  )
}
