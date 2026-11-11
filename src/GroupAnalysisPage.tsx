import { useEffect, useMemo, useState } from "react";
import { getActivityLogs } from "./api";
import { TEAM_MEMBERS, type TeamGroup } from "./teamMembers";
import "./GroupAnalysisPage.css";

type Row = Record<string, unknown>;
type ClientMetrics = {
  name: string;
  logged: number;
  confirmed: number;
  planned: number;
  effectiveBillable: number;
  plannedBillable: number;
  effectiveRevenue: number;
  plannedRevenue: number;
  jobs: Set<string>;
  people: Set<string>;
};

const GROUPS: TeamGroup[] = ["BI", "CRM", "DEV"];
const HOLIDAYS: Record<string, string> = {
  "01-01": "Capodanno", "01-06": "Epifania", "04-25": "Festa della Liberazione",
  "05-01": "Festa del Lavoro", "06-02": "Festa della Repubblica",
  "06-13": "Sant’Antonio, patrono di Padova", "08-15": "Ferragosto",
  "11-01": "Tutti i Santi", "12-08": "Immacolata Concezione",
  "12-25": "Natale", "12-26": "Santo Stefano"
};

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function toDay(value: unknown) {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return iso[1] + "-" + iso[2].padStart(2, "0") + "-" + iso[3].padStart(2, "0");
  const local = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (local) return local[3] + "-" + local[2].padStart(2, "0") + "-" + local[1].padStart(2, "0");
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
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
function isCoig(row: Row) {
  const code = String(row["Codice commessa"] ?? "");
  const name = String(row["Nome commessa"] ?? "");
  const activity = String(row["Dettaglio attività"] ?? "");
  return String(row["Tipo attività"] ?? "").toUpperCase() === "COIG" || [code, name, activity].some((value) => /^COIG/i.test(value));
}
function isWorkday(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day || isHoliday(dayKey)) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}
function addDays(dayKey: string, amount: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}
function easterMonday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return addDays(year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"), 1);
}
function isHoliday(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return dayKey === easterMonday(year) || Boolean(HOLIDAYS[String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0")]);
}
function italianToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value || "00";
  return get("year") + "-" + get("month") + "-" + get("day");
}

const fmt = (value: number) => value.toLocaleString("it-IT", { maximumFractionDigits: 2 });
const eur = (value: number) => value.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const monthLabel = (date: Date) => date.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

export default function GroupAnalysisPage() {
  const [records, setRecords] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [group, setGroup] = useState<TeamGroup>("BI");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const todayKey = italianToday();

  useEffect(() => {
    let active = true;
    getActivityLogs()
      .then((data) => { if (active) setRecords(data); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Errore nel caricamento delle attività"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const prefix = String(month.getFullYear()) + "-" + String(month.getMonth() + 1).padStart(2, "0");
  const yearPrefix = String(month.getFullYear());
  const memberNames = TEAM_MEMBERS[group] ?? [];
  const memberSet = useMemo(() => new Set(memberNames.map(normalize)), [memberNames]);
  const metrics = useMemo(() => {
    const empty = () => ({ logged: 0, confirmed: 0, planned: 0, effectiveRevenue: 0, plannedRevenue: 0, effectiveBillable: 0, plannedBillable: 0, unresolved: 0 });
    const monthTotals = empty();
    const yearTotals = empty();
    const clients = new Map<string, ClientMetrics>();
    const daily = new Map<string, number>();
    const firstByPerson = new Map<string, string>();
    const activePeople = new Set<string>();
    const jobKeys = new Set<string>();

    const add = (target: ReturnType<typeof empty>, row: Row, planned: boolean) => {
      const logged = Math.max(hours(row["Ore Loggate"] ?? row.Ore), 0);
      const confirmed = Math.max(hours(row["Ore Confermate"]), 0);
      const billable = Math.max(hours(row["Ore valorizzate"]), 0);
      const price = Math.max(number(row["Prezzo unitario NAV"]), 0);
      const revenue = Math.max(number(row["Stima fatturato"]) || billable * price, 0);
      if (String(row["Esito valorizzazione"] ?? "") !== "Valorizzata") target.unresolved++;
      if (planned) {
        target.planned += logged;
        target.plannedBillable += billable;
        target.plannedRevenue += revenue;
      } else {
        target.logged += logged;
        target.confirmed += confirmed;
        target.effectiveBillable += billable;
        target.effectiveRevenue += revenue;
      }
    };

    records.forEach((row) => {
      const person = String(row.Componente ?? "").trim();
      const personKey = normalize(person);
      if (!memberSet.has(personKey)) return;
      const day = toDay(row.Data);
      if (!day) return;
      const planned = day > todayKey;
      const isGroupYear = day.startsWith(yearPrefix);
      const isGroupMonth = day.startsWith(prefix);
      const hasPlannedWork = planned && isWorkday(day);
      const monthInScope = isGroupMonth && (!planned || hasPlannedWork);
      const yearInScope = isGroupYear && (!planned || hasPlannedWork);
      const code = String(row["Codice commessa"] ?? "").trim();
      const name = String(row["Nome commessa"] ?? "").trim();
      const activity = String(row["Dettaglio attività"] ?? "").trim();
      const customerName = String(row.Cliente ?? "").trim() || "Cliente non disponibile";
      const internal = isCoig(row);
      const customer = internal ? "Attività interne · COIG" : customerName;
      const clientKey = normalize(customer);
      const kindKey = [personKey, day, code, name, activity].join("|");
      const billable = Math.max(hours(row["Ore valorizzate"]), 0);
      const price = Math.max(number(row["Prezzo unitario NAV"]), 0);
      const revenue = Math.max(number(row["Stima fatturato"]) || billable * price, 0);

      if (yearInScope) add(yearTotals, row, planned);
      if (monthInScope) {
        add(monthTotals, row, planned);
        if (person) activePeople.add(person);
        if (!planned) {
          daily.set(personKey + "|" + day, (daily.get(personKey + "|" + day) || 0) + Math.max(hours(row["Ore Loggate"] ?? row.Ore), 0));
          const first = firstByPerson.get(personKey);
          if (!first || day < first) firstByPerson.set(personKey, day);
        }
        const existing = clients.get(clientKey) || {
          name: customer, logged: 0, confirmed: 0, planned: 0, effectiveBillable: 0, plannedBillable: 0,
          effectiveRevenue: 0, plannedRevenue: 0, jobs: new Set<string>(), people: new Set<string>()
        };
        if (planned) {
          existing.planned += Math.max(hours(row["Ore Loggate"] ?? row.Ore), 0);
          existing.plannedBillable += billable;
          existing.plannedRevenue += revenue;
        } else {
          existing.logged += Math.max(hours(row["Ore Loggate"] ?? row.Ore), 0);
          existing.confirmed += Math.max(hours(row["Ore Confermate"]), 0);
          existing.effectiveBillable += billable;
          existing.effectiveRevenue += revenue;
        }
        if (code) existing.jobs.add(code);
        if (person) existing.people.add(person);
        clients.set(clientKey, existing);
        if (code) jobKeys.add(code);
      }
    });

    let expectedPersonDays = 0;
    let belowPersonDays = 0;
    const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (const person of memberNames) {
      const personKey = normalize(person);
      const first = firstByPerson.get(personKey);
      if (!first) continue;
      for (let dayNumber = 1; dayNumber <= monthDays; dayNumber++) {
        const day = yearPrefix + "-" + String(month.getMonth() + 1).padStart(2, "0") + "-" + String(dayNumber).padStart(2, "0");
        if (day < first || day >= todayKey || !isWorkday(day)) continue;
        expectedPersonDays++;
        if ((daily.get(personKey + "|" + day) || 0) < 8) belowPersonDays++;
      }
    }

    const clientRows = [...clients.values()].sort((a, b) =>
      (b.logged + b.planned) - (a.logged + a.planned) || b.effectiveRevenue + b.plannedRevenue - (a.effectiveRevenue + a.plannedRevenue) || a.name.localeCompare(b.name, "it")
    );
    const topHours = clientRows[0]?.logged + clientRows[0]?.planned || 0;
    const totalHours = monthTotals.logged + monthTotals.planned;
    return { monthTotals, yearTotals, clientRows, activePeople: activePeople.size, jobs: jobKeys.size, belowPersonDays, expectedPersonDays, topHours, totalHours };
  }, [records, memberSet, memberNames, prefix, yearPrefix, month, todayKey]);

  const maxClientHours = Math.max(1, ...metrics.clientRows.map((client) => client.logged + client.planned));
  const rankedClients = metrics.clientRows.slice(0, 10);
  const clientColumnRows = Math.ceil(rankedClients.length / 2);
  const clientColumns = [rankedClients.slice(0, clientColumnRows), rankedClients.slice(clientColumnRows)];
  const renderClient = (client: ClientMetrics) => {
    const total = client.logged + client.planned;
    const coig = client.name === "Attività interne · COIG";
    return <li key={client.name}>
      <div className="group-analysis-client-title"><strong title={client.name}>{client.name}</strong><span>{fmt(total)} h</span></div>
      <div className="group-analysis-bar" role="img" aria-label={client.name + ": " + fmt(client.logged) + " ore loggate e " + fmt(client.planned) + " ore pianificate"}>
        <i className={"group-analysis-bar-actual" + (coig ? " group-analysis-coig" : "")} style={{ width: (client.logged / maxClientHours * 100) + "%" }} />
        <i className={"group-analysis-bar-planned" + (coig ? " group-analysis-coig" : "")} style={{ width: (client.planned / maxClientHours * 100) + "%" }} />
      </div>
      <div className="group-analysis-client-meta">
        <span><i className={"group-analysis-dot actual" + (coig ? " coig" : "")} />{fmt(client.logged)} h loggate · {fmt(client.confirmed)} h confermate</span>
        <span><i className={"group-analysis-dot planned" + (coig ? " coig" : "")} />{fmt(client.planned)} h pianificate</span>
      </div>
    </li>;
  };
  const periodLabel = monthLabel(month);
  const plannedToDateText = "consuntivi fino a oggi · piani da domani";

  return (
    <main className="group-analysis-page">
      <header className="group-analysis-header">
        <div>
          <p className="group-analysis-eyebrow">Vista del gruppo</p>
          <h1>Analisi del gruppo</h1>
          <p>Ore, andamento economico e concentrazione delle attività per cliente.</p>
        </div>
        <div className="group-analysis-month">
          <button type="button" aria-label="Mese precedente" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <strong>{periodLabel}</strong>
          <button type="button" aria-label="Mese successivo" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        </div>
      </header>
      {error && <div className="group-analysis-alert" role="alert">{error}. Verifica che la sincronizzazione Azure sia terminata.</div>}
      {loading && <div className="group-analysis-card group-analysis-loading">Caricamento consuntivazioni…</div>}
      {!loading && !error && records.length === 0 && <div className="group-analysis-alert">Il file delle consuntivazioni non contiene righe.</div>}
      {!loading && !error && records.length > 0 && <>
        <section className="group-analysis-toolbar">
          <div className="group-analysis-group-picker" role="group" aria-label="Seleziona gruppo">
            <span>Gruppo</span>
            <div>{GROUPS.map((item) => <button key={item} type="button" aria-pressed={group === item} onClick={() => setGroup(item)}>{item}</button>)}</div>
          </div>
          <div className="group-analysis-meta"><strong>{memberNames.length} componenti</strong><span>{plannedToDateText}</span></div>
        </section>

        <section className="group-analysis-kpis" aria-label="Indicatori del gruppo">
          <article><span>Ore loggate</span><strong>{fmt(metrics.monthTotals.logged)} h</strong><small>{periodLabel} · include oggi</small></article>
          <article><span>Ore confermate</span><strong className="group-analysis-green">{fmt(metrics.monthTotals.confirmed)} h</strong><small>{metrics.monthTotals.logged ? fmt(metrics.monthTotals.confirmed / metrics.monthTotals.logged * 100) : 0}% delle ore loggate</small></article>
          <article><span>Ore pianificate</span><strong className="group-analysis-violet">{fmt(metrics.monthTotals.planned)} h</strong><small>Giornate lavorative future</small></article>
          <article><span>Giornate componente sotto 8 h</span><strong className={metrics.belowPersonDays ? "group-analysis-orange" : "group-analysis-green"}>{metrics.belowPersonDays}</strong><small>{metrics.belowPersonDays} su {metrics.expectedPersonDays} giorni componente conclusi</small></article>
          <article><span>Commesse attive</span><strong>{metrics.jobs}</strong><small>{metrics.activePeople} componenti con attività</small></article>
          <article><span>Fatturato effettivo stimato</span><strong>{eur(metrics.monthTotals.effectiveRevenue)}</strong><small>{fmt(metrics.monthTotals.effectiveBillable)} h fatturabili fino a oggi</small></article>
          <article><span>Fatturato pianificato</span><strong className="group-analysis-violet">{eur(metrics.monthTotals.plannedRevenue)}</strong><small>{fmt(metrics.monthTotals.plannedBillable)} h fatturabili da domani</small></article>
          <article><span>Attività da verificare</span><strong>{metrics.monthTotals.unresolved}</strong><small>Commesse o tariffe da controllare</small></article>
        </section>

        <section className="group-analysis-card group-analysis-totalizers">
          <header><div><h2>Totalizzatori economici del gruppo</h2><p>Valore stimato effettivo fino a oggi e pianificato da domani · {yearPrefix}</p></div></header>
          <div className="group-analysis-totalizer-grid">
            <article><span>Mese · {prefix}</span><strong>{eur(metrics.monthTotals.effectiveRevenue + metrics.monthTotals.plannedRevenue)}</strong><small>Effettivo {eur(metrics.monthTotals.effectiveRevenue)} <b>·</b> Pianificato {eur(metrics.monthTotals.plannedRevenue)}</small></article>
            <article><span>Anno · {yearPrefix}</span><strong>{eur(metrics.yearTotals.effectiveRevenue + metrics.yearTotals.plannedRevenue)}</strong><small>Effettivo {eur(metrics.yearTotals.effectiveRevenue)} <b>·</b> Pianificato {eur(metrics.yearTotals.plannedRevenue)}</small></article>
          </div>
        </section>

        <section className="group-analysis-card group-analysis-clients">
          <header><div><h2>Dove lavora il gruppo</h2><p>Ore loggate fino a oggi e pianificate da domani, raggruppate per cliente. Le attività COIG sono raccolte a parte.</p></div><span>{metrics.clientRows.length} voci</span></header>
          {metrics.clientRows.length === 0 ? <p className="group-analysis-empty">Nessuna attività per il periodo selezionato.</p> : <>
            <div className="group-analysis-client-columns">
              {clientColumns.map((column, index) => <ol className="group-analysis-client-column" key={index}>
                {column.map(renderClient)}
              </ol>)}
            </div>
            <div className="group-analysis-table-wrap"><table>
              <thead><tr><th>Cliente / attività</th><th>Componenti</th><th>Commesse</th><th>Ore loggate</th><th>Ore confermate</th><th>Ore pianificate</th><th>Fatturato effettivo</th><th>Fatturato previsto</th></tr></thead>
              <tbody>{metrics.clientRows.map((client) => <tr key={"row-" + client.name}>
                <td><strong className={client.name === "Attività interne · COIG" ? "group-analysis-coig-label" : undefined}>{client.name}</strong></td><td>{client.people.size}</td><td>{client.jobs.size}</td>
                <td>{fmt(client.logged)} h</td><td>{fmt(client.confirmed)} h</td><td>{fmt(client.planned)} h</td>
                <td>{eur(client.effectiveRevenue)}<small>{fmt(client.effectiveBillable)} h fatturabili</small></td>
                <td>{eur(client.plannedRevenue)}<small>{fmt(client.plannedBillable)} h fatturabili</small></td>
              </tr>)}</tbody>
            </table></div>
          </>}
          <footer><span><i className="group-analysis-dot actual" /> Effettivo: ore loggate e valore maturato fino a oggi</span><span><i className="group-analysis-dot planned" /> Pianificato: attività future fatturabili</span></footer>
        </section>
      </>}
    </main>
  );
}
