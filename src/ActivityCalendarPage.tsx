import { useEffect, useMemo, useState } from "react";
import { getActivityLogs } from "./api";
import "./ActivityCalendarPage.css";

type Row = Record<string, unknown>;
type TeamGroup = "BI" | "CRM";
type DayTotals = { logged: number; confirmed: number; unconfirmed: number };
const TEAM_MEMBERS: Record<TeamGroup, string[]> = {
  BI: ["Lotta Giorgia", "Favero Matteo", "Stocco Alberto", "Vita Anna"],
  CRM: ["Mason Mauro", "Padovan Matteo", "Micheletto Nicola"]
};
function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function toDay(value: unknown) {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
function toHours(value: unknown) {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").trim().replace(",", ".");
  const duration = raw.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (duration) return Number(duration[1]) + Number(duration[2]) / 60 + Number(duration[3] || 0) / 3600;
  const number = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}
const formatHours = (hours: number) => hours.toLocaleString("it-IT", { maximumFractionDigits: 2 });

export default function ActivityCalendarPage() {
  const [records, setRecords] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [group, setGroup] = useState<TeamGroup>("BI");
  const [selectedPerson, setSelectedPerson] = useState(TEAM_MEMBERS.BI[0]);

  async function refresh() {
    setLoading(true); setError("");
    try { setRecords(await getActivityLogs()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Errore nel caricamento delle consuntivazioni"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const people = TEAM_MEMBERS[group];
  const totals = useMemo(() => {
    const result = new Map<string, DayTotals>();
    const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    records.forEach((row) => {
      if (normalize(String(row.Componente ?? "").trim()) !== normalize(selectedPerson)) return;
      const day = toDay(row.Data);
      if (!day.startsWith(monthPrefix)) return;
      const current = result.get(day) || { logged: 0, confirmed: 0, unconfirmed: 0 };
      current.logged += toHours(row["Ore Loggate"] ?? row.Ore);
      current.confirmed += toHours(row["Ore Confermate"]);
      current.unconfirmed += toHours(row["Ore Non Confermate"]);
      result.set(day, current);
    });
    return result;
  }, [records, selectedPerson, month]);

  const firstWeekday = (month.getDay() + 6) % 7;
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const slots: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: lastDay }, (_, i) => i + 1)];
  const days = [...totals.values()];
  const compliant = days.filter((day) => day.logged >= 8).length;
  const below = days.filter((day) => day.logged < 8).length;
  const total = days.reduce((sum, day) => ({ logged: sum.logged + day.logged, confirmed: sum.confirmed + day.confirmed, unconfirmed: sum.unconfirmed + day.unconfirmed }), { logged: 0, confirmed: 0, unconfirmed: 0 });
  const monthName = month.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  return (
    <main className="activity-page">
      <header className="activity-header">
        <div><p className="activity-eyebrow">Controllo consuntivazioni</p><h1>Ore registrate per giornata</h1><p className="activity-description">Verifica le ore loggate e confermate per ogni componente del team.</p></div>
        <div className="activity-month-controls">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mese precedente">‹</button>
          <strong>{monthName}</strong>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mese successivo">›</button>
          <button className="activity-refresh" onClick={() => void refresh()} disabled={loading}>Aggiorna</button>
        </div>
      </header>
      {error && <div className="activity-alert" role="alert">{error}. Verifica che la sincronizzazione Azure sia terminata.</div>}
      {loading && <div className="activity-panel activity-message">Caricamento consuntivazioni…</div>}
      {!loading && !error && records.length === 0 && <div className="activity-alert">Il file delle consuntivazioni non contiene righe.</div>}
      {!loading && records.length > 0 && <>
        <section className="activity-toolbar">
          <div className="activity-group-picker" role="group" aria-label="Gruppo del team">
            <span>Gruppo</span>
            <div>{(["BI", "CRM"] as TeamGroup[]).map((teamGroup) => <button key={teamGroup} type="button" aria-pressed={group === teamGroup} onClick={() => { setGroup(teamGroup); setSelectedPerson(TEAM_MEMBERS[teamGroup][0]); }}>{teamGroup}</button>)}</div>
          </div>
          <label>Componente<select value={selectedPerson} onChange={(event) => setSelectedPerson(event.target.value)}>{people.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        </section>
        <section className="activity-stats">
          <article><span>Ore loggate</span><strong>{formatHours(total.logged)}</strong><small>{selectedPerson} · {monthName}</small></article>
          <article><span>Ore confermate</span><strong className="activity-green">{formatHours(total.confirmed)}</strong><small>Approvate</small></article>
          <article><span>Ore non confermate</span><strong className={total.unconfirmed ? "activity-red" : "activity-green"}>{formatHours(total.unconfirmed)}</strong><small>Da confermare</small></article>
          <article><span>Giornate in soglia</span><strong className="activity-green">{compliant}</strong><small>Almeno 8 ore loggate</small></article>
          <article><span>Giornate sotto soglia</span><strong className={below ? "activity-red" : "activity-green"}>{below}</strong><small>{days.length} giornate consuntivate</small></article>
        </section>
        <section className="activity-calendar" aria-label="Calendario delle ore giornaliere">
          <div className="activity-weekdays">{["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => <div key={day}>{day}</div>)}</div>
          <div className="activity-days">{slots.map((day, index) => {
            if (day === null) return <div className="activity-day activity-empty" key={`empty-${index}`} />;
            const dateKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const value = totals.get(dateKey);
            const state = value === undefined ? "activity-no-data" : value.confirmed >= 8 ? "activity-good" : value.logged >= 8 ? "activity-logged" : "activity-low";
            return <article key={dateKey} className={`activity-day ${state}`}><span>{day}</span>{value === undefined ? <small>Nessun dato</small> : <><strong>{formatHours(value.logged)} h loggate</strong><small>{formatHours(value.confirmed)} h confermate</small><small>{formatHours(value.unconfirmed)} h non confermate</small></>}</article>;
          })}</div>
          <footer className="activity-legend"><span><i className="legend-good" /> Almeno 8 ore confermate</span><span><i className="legend-logged" /> Almeno 8 ore loggate, meno di 8 confermate</span><span><i className="legend-low" /> Meno di 8 ore loggate</span><span><i className="legend-none" /> Nessun dato</span></footer>
        </section>
      </>}
    </main>
  );
}
