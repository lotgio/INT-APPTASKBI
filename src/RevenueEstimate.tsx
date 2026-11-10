import { useMemo } from "react";
import "./RevenueEstimate.css";

type Row = Record<string, unknown>;
type RevenueLine = {
  customer: string;
  code: string;
  job: string;
  activity: string;
  logged: number;
  billable: number;
  unitPrice: number;
  revenue: number;
  match: string;
  source: string;
  kind: string;
};

function norm(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").trim().replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function hours(value: unknown) {
  const raw = String(value ?? "").trim();
  const duration = raw.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  return duration ? Number(duration[1]) + Number(duration[2]) / 60 + Number(duration[3] || 0) / 3600 : number(value);
}
const fmt = (value: number) => value.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const eur = (value: number) => value.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

export default function RevenueEstimate({ records, person, monthPrefix, todayKey }: {
  records: Row[];
  person: string;
  monthPrefix: string;
  todayKey: string;
}) {
  const lines = useMemo(() => {
    const grouped = new Map<string, RevenueLine>();
    records.forEach((row) => {
      if (norm(row.Componente) !== norm(person)) return;
      const day = String(row.Data ?? "").slice(0, 10);
      if (!day.startsWith(monthPrefix) || day > todayKey) return;
      const code = String(row["Codice commessa"] ?? "").trim();
      const job = String(row["Nome commessa"] ?? "").trim();
      const activity = String(row["Dettaglio attività"] ?? "").trim();
      const customer = String(row.Cliente ?? "").trim() || "Cliente non disponibile";
      const match = String(row["Esito valorizzazione"] ?? "Dati di valorizzazione non disponibili");
      const source = String(row["Fonte ore stima"] ?? "—");
      const kind = String(row["Tipo attività"] ?? "").toUpperCase();
      const logged = hours(row["Ore Loggate"] ?? row.Ore);
      const key = [customer, code, job, activity, match, source].join("|");
      const current = grouped.get(key) || {
        customer, code, job, activity, logged: 0, billable: 0,
        unitPrice: number(row["Prezzo unitario NAV"]),
        revenue: 0, match, source, kind
      };
      current.logged += logged;
      current.billable += hours(row["Ore valorizzate"]);
      current.revenue += number(row["Stima fatturato"]);
      grouped.set(key, current);
    });
    return [...grouped.values()].sort((a, b) => b.revenue - a.revenue || a.customer.localeCompare(b.customer, "it"));
  }, [records, person, monthPrefix, todayKey]);

  const totals = lines.reduce((sum, line) => ({
    logged: sum.logged + line.logged,
    billable: sum.billable + line.billable,
    revenue: sum.revenue + line.revenue
  }), { logged: 0, billable: 0, revenue: 0 });
  const unresolved = lines.filter((line) => line.match !== "Valorizzata");
  const clients = useMemo(() => {
    const values = new Map<string, { revenue: number; logged: number; lines: number }>();
    lines.filter((line) => line.match === "Valorizzata" && line.kind !== "COIG").forEach((line) => {
      const current = values.get(line.customer) || { revenue: 0, logged: 0, lines: 0 };
      current.revenue += line.revenue;
      current.logged += line.logged;
      current.lines++;
      values.set(line.customer, current);
    });
    return [...values.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.revenue - a.revenue);
  }, [lines]);
  const maxClientRevenue = clients[0]?.revenue || 0;
  const valuedCount = lines.filter((line) => line.match === "Valorizzata").length;

  return (
    <section className="revenue-panel" aria-label="Stima del fatturato">
      <header className="revenue-header">
        <div><p className="revenue-eyebrow">CRM · NAV</p><h2>Stima del fatturato</h2><p>{person} · {monthPrefix} · attività registrate fino a oggi</p></div>
        <span>{valuedCount} voci valorizzate{unresolved.length ? ` · ${unresolved.length} da verificare` : ""}</span>
      </header>
      <div className="revenue-kpis">
        <article><span>Fatturato stimato</span><strong>{eur(totals.revenue)}</strong><small>Prezzo unitario NAV × ore valorizzate</small></article>
        <article><span>Ore valorizzate</span><strong>{fmt(totals.billable)} h</strong><small>Enable Invoice CRM oppure ore loggate</small></article>
        <article><span>Ore loggate collegate</span><strong>{fmt(totals.logged)} h</strong><small>{lines.length} voci attività nel mese</small></article>
        <article><span>Da verificare</span><strong className={unresolved.length ? "revenue-warning" : ""}>{unresolved.length}</strong><small>Commesse senza abbinamento o prezzo univoco</small></article>
      </div>
      <div className="revenue-body">
        <section className="revenue-clients">
          <div className="revenue-section-heading"><div><h3>Stima per cliente</h3><p>Importo stimato per le attività non interne</p></div><span>{clients.length} clienti</span></div>
          {clients.length === 0 ? <p className="revenue-empty">Nessun importo stimato per il periodo.</p> :
            <ol>{clients.slice(0, 8).map((client) => <li key={client.name}>
              <div><span title={client.name}>{client.name}</span><strong>{eur(client.revenue)} <small>{totals.revenue ? (client.revenue / totals.revenue * 100).toLocaleString("it-IT", { maximumFractionDigits: 0 }) : 0}%</small></strong></div>
              <i><b style={{ width: `${maxClientRevenue ? client.revenue / maxClientRevenue * 100 : 0}%` }} /></i>
            </li>)}</ol>}
        </section>
        <section className="revenue-detail">
          <div className="revenue-section-heading"><div><h3>Dettaglio commesse</h3><p>Valorizzazione delle ore per commessa e attività</p></div><span>{lines.length} voci</span></div>
          {lines.length === 0 ? <p className="revenue-empty">Non risultano attività registrate nel periodo selezionato.</p> :
            <div className="revenue-table-wrap"><table>
              <thead><tr><th>Esito</th><th>Cliente</th><th>Commessa / attività</th><th>Ore loggate</th><th>Ore valorizzate</th><th>Tariffa NAV</th><th>Stima</th></tr></thead>
              <tbody>{lines.map((line, index) => <tr key={`${line.customer}|${line.code}|${line.activity}|${index}`} className={line.match === "Valorizzata" ? "" : "revenue-unresolved"}>
                <td><span className={line.match === "Valorizzata" ? "revenue-badge" : "revenue-badge unresolved"}>{line.match}</span>{line.source !== "—" && <small className="revenue-source">{line.source}</small>}</td>
                <td>{line.customer}</td><td><strong>{line.code || "—"}</strong><small>{[line.job, line.activity].filter(Boolean).join(" · ")}</small></td>
                <td>{fmt(line.logged)} h</td><td>{fmt(line.billable)} h</td><td>{line.match === "Valorizzata" ? eur(line.unitPrice) : "—"}</td><td><strong>{line.match === "Valorizzata" ? eur(line.revenue) : "—"}</strong></td>
              </tr>)}</tbody>
            </table></div>}
        </section>
      </div>
      <footer className="revenue-footnote">Le ore Enable Invoice CRM sono sommate una sola volta per commessa/task/riga nel mese; se non sono presenti, si usa la durata ZDT. La stima non è un importo fatturato.</footer>
    </section>
  );
}
