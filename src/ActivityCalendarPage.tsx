import { useEffect, useMemo, useState } from "react";
import { getActivityLogs } from "./api";
import "./ActivityCalendarPage.css";

type Row = Record<string, unknown>;
type FieldKind = "date" | "person" | "hours";
const CANDIDATES: Record<FieldKind, string[]> = {
  date: ["data", "giorno", "postingdate", "workdate", "activitydate", "date"],
  person: ["risorsa", "nome", "nominativo", "dipendente", "utente", "resource", "resourcename", "employeename", "person", "member"],
  hours: ["ore", "oreloggate", "durata", "oreconsuntivate", "hours", "loggedhours", "quantity", "workinghours", "time"]
};
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function guessField(columns: string[], kind: FieldKind) {
  return columns.find((column) => CANDIDATES[kind].includes(normalize(column))) || columns.find((column) => CANDIDATES[kind].some((candidate) => normalize(column).includes(candidate))) || "";
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

export default function ActivityCalendarPage() {
  const [records, setRecords] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedPerson, setSelectedPerson] = useState("");
  const [fields, setFields] = useState({ date: "", person: "", hours: "" });

  async function refresh() {
    setLoading(true); setError("");
    try { setRecords(await getActivityLogs()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Errore nel caricamento delle consuntivazioni"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const columns = useMemo(() => records.length ? Object.keys(records[0]) : [], [records]);
  useEffect(() => {
    if (!columns.length) return;
    setFields((current) => ({
      date: current.date || guessField(columns, "date"),
      person: current.person || guessField(columns, "person"),
      hours: current.hours || guessField(columns, "hours")
    }));
  }, [columns]);
  const people = useMemo(() => [...new Set(records.map((row) => String(row[fields.person] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it")), [records, fields.person]);
  useEffect(() => { if (people.length && !people.includes(selectedPerson)) setSelectedPerson(people[0]); }, [people, selectedPerson]);

  const totals = useMemo(() => {
    const result = new Map<string, number>();
    if (!fields.date || !fields.person || !fields.hours) return result;
    const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    records.forEach((row) => {
      if (String(row[fields.person] ?? "").trim() !== selectedPerson) return;
      const day = toDay(row[fields.date]);
      if (day.startsWith(monthPrefix)) result.set(day, (result.get(day) || 0) + toHours(row[fields.hours]));
    });
    return result;
  }, [records, fields, selectedPerson, month]);

  const firstWeekday = (month.getDay() + 6) % 7;
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const slots: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: lastDay }, (_, i) => i + 1)];
  const loggedHours = [...totals.values()];
  const compliant = loggedHours.filter((hours) => hours >= 8).length;
  const below = loggedHours.filter((hours) => hours < 8).length;
  const totalHours = loggedHours.reduce((sum, hours) => sum + hours, 0);
  const fieldsReady = Boolean(fields.date && fields.person && fields.hours);
  const monthName = month.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  return (
    <main className="activity-page">
      <header className="activity-header">
        <div><p className="activity-eyebrow">Controllo consuntivazioni</p><h1>Ore registrate per giornata</h1><p className="activity-description">Verifica per ogni componente del team il raggiungimento delle 8 ore giornaliere.</p></div>
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
          <label>Componente<select value={selectedPerson} onChange={(event) => setSelectedPerson(event.target.value)}>{people.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <div className="activity-field-map"><span>Colonne del file</span>
            {([["date", "Data"], ["person", "Componente"], ["hours", "Ore"]] as const).map(([kind, label]) => <label key={kind}>{label}<select value={fields[kind]} onChange={(event) => setFields((current) => ({ ...current, [kind]: event.target.value }))}><option value="">Seleziona colonna</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}
          </div>
        </section>
        {!fieldsReady && <div className="activity-alert">Associa le colonne di data, componente e ore per visualizzare il calendario.</div>}
        {fieldsReady && <>
          <section className="activity-stats">
            <article><span>Ore registrate</span><strong>{totalHours.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</strong><small>{selectedPerson} · {monthName}</small></article>
            <article><span>Giornate in soglia</span><strong className="activity-green">{compliant}</strong><small>Almeno 8 ore</small></article>
            <article><span>Sotto la soglia</span><strong className={below ? "activity-red" : "activity-green"}>{below}</strong><small>Giornate con dati sotto 8 ore</small></article>
            <article><span>Giornate consuntivate</span><strong>{loggedHours.length}</strong><small>I giorni vuoti non sono conteggiati</small></article>
          </section>
          <section className="activity-calendar" aria-label="Calendario delle ore giornaliere">
            <div className="activity-weekdays">{["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => <div key={day}>{day}</div>)}</div>
            <div className="activity-days">{slots.map((day, index) => {
              if (day === null) return <div className="activity-day activity-empty" key={`empty-${index}`} />;
              const dateKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const hours = totals.get(dateKey);
              const state = hours === undefined ? "activity-no-data" : hours >= 8 ? "activity-good" : "activity-low";
              return <article key={dateKey} className={`activity-day ${state}`}><span>{day}</span>{hours === undefined ? <small>Nessun dato</small> : <><strong>{hours.toLocaleString("it-IT", { maximumFractionDigits: 2 })} h</strong><small>{hours >= 8 ? "In soglia" : "Sotto 8 h"}</small></>}</article>;
            })}</div>
            <footer className="activity-legend"><span><i className="legend-good" /> Almeno 8 ore</span><span><i className="legend-low" /> Meno di 8 ore</span><span><i className="legend-none" /> Nessun dato</span></footer>
          </section>
        </>}
      </>}
    </main>
  );
}
