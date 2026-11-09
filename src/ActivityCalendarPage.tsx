import { useEffect, useMemo, useState } from "react";
import { getActivityLogs } from "./api";
import "./ActivityCalendarPage.css";

type Row = Record<string, unknown>;
type TeamGroup = "BI" | "CRM";
type DayTotals = { logged: number; confirmed: number; unconfirmed: number };
type ActivityAlert = { id: string; date: string; kind: "hours" | "confirmation"; logged: number; confirmed: number };
const DAILY_TARGET = 8;
const ALERT_START_DATE = "2026-11-01";
const TEAM_MEMBERS: Record<TeamGroup, string[]> = {
  BI: ["Lotta Giorgia", "Favero Matteo", "Stocco Alberto", "Vita Anna"],
  CRM: ["Mason Mauro", "Padovan Matteo", "Micheletto Nicola"]
};
const FIXED_HOLIDAYS: Record<string, string> = {
  "01-01": "Capodanno",
  "01-06": "Epifania",
  "04-25": "Festa della Liberazione",
  "05-01": "Festa del Lavoro",
  "06-02": "Festa della Repubblica",
  "06-13": "Sant’Antonio, patrono di Padova",
  "08-15": "Ferragosto",
  "11-01": "Tutti i Santi",
  "12-08": "Immacolata Concezione",
  "12-25": "Natale",
  "12-26": "Santo Stefano"
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
function addDays(dayKey: string, amount: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}
function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function easterMondayKey(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return addDays(dateKey(year, month, day), 1);
}
function holidayName(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return "";
  if (dayKey === easterMondayKey(year)) return "Lunedì dell’Angelo";
  return FIXED_HOLIDAYS[`${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`] || "";
}
function isWorkday(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day || holidayName(dayKey)) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}
function mondayOfWeek(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(dayKey, -((weekday + 6) % 7));
}
function romeDateTime(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const value = (name: string) => parts.find((part) => part.type === name)?.value || "00";
  return { day: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}
function confirmationDeadlinePassed(dayKey: string, todayKey: string, currentHourRome: number) {
  const deadlineDay = addDays(mondayOfWeek(dayKey), 7);
  return todayKey > deadlineDay || (todayKey === deadlineDay && currentHourRome >= 20);
}
function formatDay(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

export default function ActivityCalendarPage() {
  const [records, setRecords] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const people = TEAM_MEMBERS[group];
  const { day: todayKey, hour: romeHour } = romeDateTime(now);
  const allTotals = useMemo(() => {
    const result = new Map<string, DayTotals>();
    records.forEach((row) => {
      if (normalize(String(row.Componente ?? "").trim()) !== normalize(selectedPerson)) return;
      const day = toDay(row.Data);
      if (!day) return;
      const current = result.get(day) || { logged: 0, confirmed: 0, unconfirmed: 0 };
      current.logged += toHours(row["Ore Loggate"] ?? row.Ore);
      current.confirmed += toHours(row["Ore Confermate"]);
      current.unconfirmed += toHours(row["Ore Non Confermate"]);
      result.set(day, current);
    });
    return result;
  }, [records, selectedPerson]);

  const firstActivityDate = useMemo(() => [...allTotals.keys()].sort()[0] || "", [allTotals]);
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const totals = useMemo(() => new Map([...allTotals.entries()].filter(([day]) => day.startsWith(monthPrefix))), [allTotals, monthPrefix]);

  const alerts = useMemo(() => {
    if (!firstActivityDate) return [] as ActivityAlert[];
    const found = new Map<string, ActivityAlert>();
    const addAlert = (day: string, kind: ActivityAlert["kind"]) => {
      if (day < ALERT_START_DATE || day < firstActivityDate) return;
      const total = allTotals.get(day) || { logged: 0, confirmed: 0, unconfirmed: 0 };
      const id = `${kind}:${day}`;
      found.set(id, { id, date: day, kind, logged: total.logged, confirmed: total.confirmed });
    };

    for (const [key, total] of allTotals.entries()) {
      if (key >= todayKey || key < firstActivityDate || !isWorkday(key)) continue;
      if (total.logged < DAILY_TARGET) addAlert(key, "hours");
      if (confirmationDeadlinePassed(key, todayKey, romeHour) && total.confirmed < DAILY_TARGET) addAlert(key, "confirmation");
    }

    const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= monthDays; day++) {
      const key = dateKey(month.getFullYear(), month.getMonth() + 1, day);
      if (!isWorkday(key) || key >= todayKey || key < firstActivityDate) continue;
      const total = allTotals.get(key) || { logged: 0, confirmed: 0, unconfirmed: 0 };
      if (total.logged < DAILY_TARGET) addAlert(key, "hours");
      if (confirmationDeadlinePassed(key, todayKey, romeHour) && total.confirmed < DAILY_TARGET) addAlert(key, "confirmation");
    }

    const previousWeekStart = addDays(mondayOfWeek(todayKey), -7);
    for (let offset = 0; offset < 5; offset++) {
      const key = addDays(previousWeekStart, offset);
      if (!isWorkday(key) || key < firstActivityDate) continue;
      const total = allTotals.get(key) || { logged: 0, confirmed: 0, unconfirmed: 0 };
      if (total.logged < DAILY_TARGET) addAlert(key, "hours");
      if (confirmationDeadlinePassed(key, todayKey, romeHour) && total.confirmed < DAILY_TARGET) addAlert(key, "confirmation");
    }
    return [...found.values()].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  }, [allTotals, firstActivityDate, month, todayKey, romeHour]);

  const monthEntries = [...totals.entries()].filter(([day]) => isWorkday(day) && day <= todayKey);
  const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const completeWorkdayKeys = Array.from({ length: monthDays }, (_, index) => dateKey(month.getFullYear(), month.getMonth() + 1, index + 1))
    .filter((day) => day >= firstActivityDate && day < todayKey && isWorkday(day));
  const compliant = completeWorkdayKeys.filter((day) => (allTotals.get(day)?.logged || 0) >= DAILY_TARGET).length;
  const below = completeWorkdayKeys.filter((day) => (allTotals.get(day)?.logged || 0) < DAILY_TARGET).length;
  const total = monthEntries.reduce((sum, [, day]) => ({
    logged: sum.logged + day.logged,
    confirmed: sum.confirmed + day.confirmed,
    unconfirmed: sum.unconfirmed + day.unconfirmed
  }), { logged: 0, confirmed: 0, unconfirmed: 0 });
  const complianceRate = completeWorkdayKeys.length ? compliant / completeWorkdayKeys.length * 100 : 0;
  const confirmationRate = total.logged ? total.confirmed / total.logged * 100 : 0;
  const weeklyKpis = new Map<string, { workdays: number; completeDays: number; logged: number; confirmed: number; unconfirmed: number }>();
  completeWorkdayKeys.forEach((day) => {
    const week = mondayOfWeek(day);
    const kpi = weeklyKpis.get(week) || { workdays: 0, completeDays: 0, logged: 0, confirmed: 0, unconfirmed: 0 };
    const value = allTotals.get(day) || { logged: 0, confirmed: 0, unconfirmed: 0 };
    kpi.workdays++;
    if (value.logged >= DAILY_TARGET) kpi.completeDays++;
    kpi.logged += value.logged;
    kpi.confirmed += value.confirmed;
    kpi.unconfirmed += value.unconfirmed;
    weeklyKpis.set(week, kpi);
  });
  const weeklyRows = [...weeklyKpis.entries()].sort(([a], [b]) => a.localeCompare(b));
  const firstWeekday = (month.getDay() + 6) % 7;
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const slots: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: lastDay }, (_, i) => i + 1)];
  const monthName = month.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  return (
    <main className="activity-page">
      <header className="activity-header">
        <div><p className="activity-eyebrow">Controllo consuntivazioni</p><h1>Ore registrate per giornata</h1><p className="activity-description">Obiettivo 8 ore per giorno lavorativo; le conferme della settimana precedente scadono il lunedì alle 20:00 (ora italiana).</p></div>
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
          <article><span>Giornate lavorative concluse</span><strong>{completeWorkdayKeys.length}</strong><small>Giorno corrente escluso</small></article>
          <article><span>Giornate ≥ 8 ore</span><strong className="activity-green">{compliant} / {completeWorkdayKeys.length}</strong><small>{complianceRate.toLocaleString("it-IT", { maximumFractionDigits: 0 })}% di copertura</small></article>
          <article><span>Ore loggate nel mese</span><strong>{formatHours(total.logged)}</strong><small>{selectedPerson} · include le ore di oggi</small></article>
          <article><span>Ore confermate nel mese</span><strong className="activity-green">{formatHours(total.confirmed)}</strong><small>Solo giorni lavorativi</small></article>
          <article><span>Percentuale confermata</span><strong>{confirmationRate.toLocaleString("it-IT", { maximumFractionDigits: 0 })}%</strong><small>{formatHours(total.unconfirmed)}h ancora non confermate</small></article>
          <article><span>Alert aperti</span><strong className={alerts.length ? "activity-red" : "activity-green"}>{alerts.length}</strong><small>Dal 1° novembre 2026 · {below} giornate sotto 8h</small></article>
        </section>

        <section className="activity-report">
          <header><div><h2>Report settimanale</h2><p>{selectedPerson} · {monthName} · giornate concluse, oggi escluso</p></div><span>Obiettivo giornaliero: 8h</span></header>
          {weeklyRows.length === 0 ? <p className="activity-report-empty">Nessun giorno lavorativo trascorso nel periodo selezionato.</p> :
            <div className="activity-table-wrap"><table>
              <thead><tr><th>Settimana</th><th>Giorni</th><th>Giornate ≥ 8h</th><th>Ore loggate / attese</th><th>Ore confermate</th><th>Tasso conferma</th><th>Alert</th></tr></thead>
              <tbody>{weeklyRows.map(([week, kpi]) => {
                const weekAlerts = alerts.filter((alert) => alert.date >= week && alert.date <= addDays(week, 6)).length;
                const expectedHours = kpi.workdays * DAILY_TARGET;
                const weekConfirmationRate = kpi.logged ? kpi.confirmed / kpi.logged * 100 : 0;
                return <tr key={week} className={weekAlerts ? "weekly-alert" : ""}>
                  <td>{formatDay(week)} – {formatDay(addDays(week, 4))}</td>
                  <td>{kpi.workdays}</td>
                  <td>{kpi.completeDays} / {kpi.workdays} ({(kpi.completeDays / kpi.workdays * 100).toLocaleString("it-IT", { maximumFractionDigits: 0 })}%)</td>
                  <td>{formatHours(kpi.logged)} / {formatHours(expectedHours)}h</td>
                  <td>{formatHours(kpi.confirmed)}h</td>
                  <td>{weekConfirmationRate.toLocaleString("it-IT", { maximumFractionDigits: 0 })}%</td>
                  <td>{weekAlerts || "—"}</td>
                </tr>;
              })}</tbody>
            </table></div>}
        </section>

        <section className="activity-alert-register" aria-live="polite">
          <header><h2>Registro anomalie</h2><span>{alerts.length ? `${alerts.length} alert attiv${alerts.length === 1 ? "o" : "i"}` : "Nessuna anomalia attiva"}</span></header>
          {alerts.length === 0 ? <p>Per {selectedPerson} non risultano giornate lavorative sotto le 8 ore né conferme scadute.</p> :
            <ul>{alerts.map((alert) => <li key={alert.id} className={alert.kind === "confirmation" ? "alert-confirmation" : "alert-hours"}>
              <time dateTime={alert.date}>{formatDay(alert.date)}</time>
              <strong>{alert.kind === "confirmation" ? "Conferma scaduta" : "Ore loggate sotto soglia"}</strong>
              <span>{alert.kind === "confirmation"
                ? `${formatHours(alert.confirmed)}h confermate su 8h richieste (lunedì, ore 20:00).`
                : `${formatHours(alert.logged)}h loggate su 8h richieste.`}</span>
            </li>)}</ul>}
        </section>

        <section className="activity-calendar" aria-label="Calendario delle ore giornaliere">
          <div className="activity-weekdays">{["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => <div key={day}>{day}</div>)}</div>
          <div className="activity-days">{slots.map((day, index) => {
            if (day === null) return <div className="activity-day activity-empty" key={`empty-${index}`} />;
            const key = dateKey(month.getFullYear(), month.getMonth() + 1, day);
            const value = totals.get(key);
            const holiday = holidayName(key);
            const workingDay = isWorkday(key);
            const dayAlerts = alerts.filter((alert) => alert.date === key);
            const state = !workingDay ? "activity-nonworking" : dayAlerts.length ? "activity-anomaly" : value === undefined ? "activity-no-data" : value.confirmed >= DAILY_TARGET ? "activity-good" : value.logged >= DAILY_TARGET ? "activity-logged" : "activity-low";
            return <article key={key} className={`activity-day ${state}`} title={holiday || (!workingDay ? "Fine settimana — escluso dal conteggio" : "")}>
              <span>{day}</span>
              {!workingDay ? <small>{holiday || "Weekend · escluso"}</small> : value === undefined ? <><small>{dayAlerts.some((alert) => alert.kind === "hours") ? "Nessun dato · 0h loggate" : "Nessun dato"}</small>{dayAlerts.length > 0 && <small className="activity-day-alert-label">Anomalia da verificare</small>}</> :
                <><strong>{formatHours(value.logged)} h loggate</strong><small>{formatHours(value.confirmed)} h confermate</small><small>{formatHours(value.unconfirmed)} h non confermate</small>{dayAlerts.length > 0 && <small className="activity-day-alert-label">Anomalia da verificare</small>}</>}
            </article>;
          })}</div>
          <footer className="activity-legend"><span><i className="legend-good" /> Almeno 8 ore confermate</span><span><i className="legend-logged" /> Almeno 8 ore loggate, meno di 8 confermate</span><span><i className="legend-low" /> Meno di 8 ore loggate</span><span><i className="legend-anomaly" /> Anomalia / conferma scaduta</span><span><i className="legend-none" /> Weekend o festività esclusi</span></footer>
        </section>
      </>}
    </main>
  );
}
