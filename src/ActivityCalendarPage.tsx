import { useEffect, useMemo, useState } from "react";
import { getActivityLogs } from "./api";
import RevenueEstimate from "./RevenueEstimate";
import { TEAM_MEMBERS, type TeamGroup } from "./teamMembers";
import "./ActivityCalendarPage.css";

type Row = Record<string, unknown>;
type DayTotals = { logged: number; confirmed: number; unconfirmed: number };
type ActivityAlert = { id: string; date: string; kind: "hours" | "confirmation"; logged: number; confirmed: number };
type JobDetail = { code: string; name: string; activity: string; customer: string; kind: "COIG" | "Non COIG"; logged: number; confirmed: number; planned?: number };
type ClientDayGroup = { customer: string; logged: number; confirmed: number; jobs: JobDetail[] };
type ActivitySummary = { label: string; logged: number; confirmed: number; planned: number; codes: Set<string> };
const DAILY_TARGET = 8;
const ALERT_START_DATE = "2026-11-01";
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
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null);

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

  useEffect(() => {
    setSelectedCalendarDay(null);
  }, [selectedPerson, month]);

  useEffect(() => {
    if (!selectedCalendarDay) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedCalendarDay(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedCalendarDay]);

  const people = TEAM_MEMBERS[group] ?? TEAM_MEMBERS.BI;
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

  const selectedDayGroups = useMemo(() => {
    if (!selectedCalendarDay || selectedCalendarDay > todayKey) return [] as ClientDayGroup[];
    const groups = new Map<string, { customer: string; logged: number; confirmed: number; jobs: Map<string, JobDetail> }>();
    records.forEach((row) => {
      if (normalize(String(row.Componente ?? "").trim()) !== normalize(selectedPerson) || toDay(row.Data) !== selectedCalendarDay) return;
      const code = String(row["Codice commessa"] ?? "").trim();
      const name = String(row["Nome commessa"] ?? "").trim();
      const activity = String(row["Dettaglio attività"] ?? "").trim();
      const rawCustomer = String(row.Cliente ?? "").trim();
      const kind: JobDetail["kind"] = String(row["Tipo attività"] ?? "").toUpperCase() === "COIG" || [code, name, activity].some((value) => /^COIG/i.test(value)) ? "COIG" : "Non COIG";
      const customer = kind === "COIG" ? "Attività interne · COIG" : rawCustomer || "Cliente non disponibile";
      const group = groups.get(customer) || { customer, logged: 0, confirmed: 0, jobs: new Map<string, JobDetail>() };
      const key = [kind, code, name, activity].join("|");
      const job = group.jobs.get(key) || { code, name, activity, customer: rawCustomer, kind, logged: 0, confirmed: 0 };
      job.logged += toHours(row["Ore Loggate"] ?? row.Ore);
      job.confirmed += toHours(row["Ore Confermate"]);
      group.logged += toHours(row["Ore Loggate"] ?? row.Ore);
      group.confirmed += toHours(row["Ore Confermate"]);
      group.jobs.set(key, job);
      groups.set(customer, group);
    });
    return [...groups.values()]
      .map((group) => ({ ...group, jobs: [...group.jobs.values()].sort((a, b) => b.logged - a.logged || a.code.localeCompare(b.code, "it")) }))
      .sort((a, b) => b.logged - a.logged || a.customer.localeCompare(b.customer, "it"));
  }, [records, selectedPerson, selectedCalendarDay, todayKey]);
  const selectedDayTotals = selectedDayGroups.reduce((sum, group) => ({ logged: sum.logged + group.logged, confirmed: sum.confirmed + group.confirmed }), { logged: 0, confirmed: 0 });

  const jobDetails = useMemo(() => {
    const grouped = new Map<string, JobDetail>();
    records.forEach((row) => {
      if (normalize(String(row.Componente ?? "").trim()) !== normalize(selectedPerson)) return;
      const day = toDay(row.Data);
      if (!day || !day.startsWith(monthPrefix) || day > todayKey) return;
      const code = String(row["Codice commessa"] ?? "").trim();
      const name = String(row["Nome commessa"] ?? "").trim();
      const activity = String(row["Dettaglio attività"] ?? "").trim();
      const customer = String(row.Cliente ?? "").trim();
      const startsWithCoig = [code, name, activity].some((value) => /^COIG/i.test(value));
      const kind: JobDetail["kind"] = String(row["Tipo attività"] ?? "").toUpperCase() === "COIG" || startsWithCoig ? "COIG" : "Non COIG";
      const key = [kind, code, name, activity, customer].join("|");
      const current = grouped.get(key) || { code, name, activity, customer, kind, logged: 0, confirmed: 0 };
      current.logged += toHours(row["Ore Loggate"] ?? row.Ore);
      current.confirmed += toHours(row["Ore Confermate"]);
      grouped.set(key, current);
    });
    return [...grouped.values()].sort((a, b) => b.logged - a.logged || a.code.localeCompare(b.code, "it"));
  }, [records, selectedPerson, monthPrefix, todayKey]);
  const plannedDetails = useMemo(() => {
    const grouped = new Map<string, JobDetail>();
    records.forEach((row) => {
      if (normalize(String(row.Componente ?? "").trim()) !== normalize(selectedPerson)) return;
      const day = toDay(row.Data);
      if (!day || !day.startsWith(monthPrefix) || day <= todayKey || !isWorkday(day)) return;
      const planned = Math.max(toHours(row["Ore Loggate"] ?? row.Ore), 0);
      if (!planned) return;
      const code = String(row["Codice commessa"] ?? "").trim();
      const name = String(row["Nome commessa"] ?? "").trim();
      const activity = String(row["Dettaglio attività"] ?? "").trim();
      const customer = String(row.Cliente ?? "").trim();
      const startsWithCoig = [code, name, activity].some((value) => /^COIG/i.test(value));
      const kind: JobDetail["kind"] = String(row["Tipo attività"] ?? "").toUpperCase() === "COIG" || startsWithCoig ? "COIG" : "Non COIG";
      const key = [kind, code, name, activity, customer].join("|");
      const current = grouped.get(key) || { code, name, activity, customer, kind, logged: 0, confirmed: 0, planned: 0 };
      current.planned = (current.planned || 0) + planned;
      grouped.set(key, current);
    });
    return [...grouped.values()].sort((a, b) => (b.planned || 0) - (a.planned || 0) || a.code.localeCompare(b.code, "it"));
  }, [records, selectedPerson, monthPrefix, todayKey]);
  const coigDetails = jobDetails.filter((item) => item.kind === "COIG");
  const otherDetails = jobDetails.filter((item) => item.kind === "Non COIG");
  const coigPlannedDetails = plannedDetails.filter((item) => item.kind === "COIG");
  const otherPlannedDetails = plannedDetails.filter((item) => item.kind === "Non COIG");
  const coigHours = coigDetails.reduce((sum, item) => sum + item.logged, 0);
  const otherHours = otherDetails.reduce((sum, item) => sum + item.logged, 0);
  const coigPlannedHours = coigPlannedDetails.reduce((sum, item) => sum + (item.planned || 0), 0);
  const otherPlannedHours = otherPlannedDetails.reduce((sum, item) => sum + (item.planned || 0), 0);
  const coigConfirmedHours = coigDetails.reduce((sum, item) => sum + item.confirmed, 0);
  const otherConfirmedHours = otherDetails.reduce((sum, item) => sum + item.confirmed, 0);
  const totalConfirmedJobHours = coigConfirmedHours + otherConfirmedHours;
  const totalPlannedJobHours = coigPlannedHours + otherPlannedHours;
  const totalReportHours = totalConfirmedJobHours + totalPlannedJobHours;
  const totalizerScale = Math.max(1, coigConfirmedHours + coigPlannedHours, otherConfirmedHours + otherPlannedHours);
  const coigConfirmedShare = totalReportHours ? coigConfirmedHours / totalReportHours * 100 : 0;
  const otherConfirmedShare = totalReportHours ? otherConfirmedHours / totalReportHours * 100 : 0;
  const coigPlannedShare = totalReportHours ? coigPlannedHours / totalReportHours * 100 : 0;
  const otherPlannedShare = totalReportHours ? otherPlannedHours / totalReportHours * 100 : 0;
  const internalReportHours = coigConfirmedHours + coigPlannedHours;
  const externalReportHours = otherConfirmedHours + otherPlannedHours;
  const internalActivitySummary = useMemo(() => {
    const groups = new Map<string, ActivitySummary>();
    const add = (item: JobDetail, planned = false) => {
      const label = item.activity || item.name || item.code || "Attività senza descrizione";
      const current = groups.get(label) || { label, logged: 0, confirmed: 0, planned: 0, codes: new Set<string>() };
      if (planned) current.planned += item.planned || 0;
      else { current.logged += item.logged; current.confirmed += item.confirmed; }
      if (item.code) current.codes.add(item.code);
      groups.set(label, current);
    };
    coigDetails.forEach((item) => add(item));
    coigPlannedDetails.forEach((item) => add(item, true));
    return [...groups.values()].sort((a, b) => (b.confirmed + b.planned) - (a.confirmed + a.planned));
  }, [coigDetails, coigPlannedDetails]);
  const clientSummary = useMemo(() => {
    const groups = new Map<string, ActivitySummary>();
    const add = (item: JobDetail, planned = false) => {
      const label = item.customer || "Cliente non disponibile";
      const current = groups.get(label) || { label, logged: 0, confirmed: 0, planned: 0, codes: new Set<string>() };
      if (planned) current.planned += item.planned || 0;
      else { current.logged += item.logged; current.confirmed += item.confirmed; }
      if (item.code) current.codes.add(item.code);
      groups.set(label, current);
    };
    otherDetails.forEach((item) => add(item));
    otherPlannedDetails.forEach((item) => add(item, true));
    return [...groups.values()].sort((a, b) => (b.confirmed + b.planned) - (a.confirmed + a.planned) || a.label.localeCompare(b.label, "it"));
  }, [otherDetails, otherPlannedDetails]);
  const internalChartMax = Math.max(1, ...internalActivitySummary.map((item) => item.confirmed + item.planned));
  const clientChartMax = Math.max(1, ...clientSummary.map((item) => item.confirmed + item.planned));
  const internalLead = [...internalActivitySummary].filter((item) => item.confirmed > 0).sort((a, b) => b.confirmed - a.confirmed)[0];
  const plannedInternalLead = [...internalActivitySummary].filter((item) => item.planned > 0).sort((a, b) => b.planned - a.planned)[0];
  const clientLead = [...clientSummary].filter((item) => item.confirmed > 0).sort((a, b) => b.confirmed - a.confirmed)[0];
  const plannedClientLead = [...clientSummary].filter((item) => item.planned > 0).sort((a, b) => b.planned - a.planned)[0];
  const balanceLabel = !totalReportHours ? "Nessuna ora confermata o pianificata" : internalReportHours === externalReportHours ? "Ore interne ed esterne equivalenti" : internalReportHours > externalReportHours ? `Prevalgono le attività interne di ${formatHours(internalReportHours - externalReportHours)} h` : `Prevalgono le attività non COIG di ${formatHours(externalReportHours - internalReportHours)} h`;

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
  const plannedEntries = [...totals.entries()].filter(([day, value]) => day > todayKey && isWorkday(day) && value.logged > 0);
  const plannedHours = plannedEntries.reduce((sum, [, value]) => sum + value.logged, 0);
  const complianceRate = completeWorkdayKeys.length ? compliant / completeWorkdayKeys.length * 100 : 0;
  const confirmationRate = total.logged ? total.confirmed / total.logged * 100 : 0;
  const weeklyKpis = new Map<string, { workdays: number; completeDays: number; logged: number; confirmed: number; unconfirmed: number; planned: number; plannedDays: number }>();
  if (firstActivityDate) {
    for (let day = 1; day <= monthDays; day++) {
      const key = dateKey(month.getFullYear(), month.getMonth() + 1, day);
      if (key < firstActivityDate || !isWorkday(key)) continue;
      const week = mondayOfWeek(key);
      const kpi = weeklyKpis.get(week) || { workdays: 0, completeDays: 0, logged: 0, confirmed: 0, unconfirmed: 0, planned: 0, plannedDays: 0 };
      const value = allTotals.get(key) || { logged: 0, confirmed: 0, unconfirmed: 0 };
      if (key < todayKey) {
        kpi.workdays++;
        if (value.logged >= DAILY_TARGET) kpi.completeDays++;
        kpi.logged += value.logged;
        kpi.confirmed += value.confirmed;
        kpi.unconfirmed += value.unconfirmed;
      } else if (key > todayKey && value.logged > 0) {
        kpi.planned += value.logged;
        kpi.plannedDays++;
      }
      weeklyKpis.set(week, kpi);
    }
  }
  const weeklyRows = [...weeklyKpis.entries()]
    .filter(([, kpi]) => kpi.workdays > 0 || kpi.planned > 0)
    .sort(([a], [b]) => a.localeCompare(b));
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
            <div>{(["BI", "CRM", "DEV"] as TeamGroup[]).map((teamGroup) => <button key={teamGroup} type="button" aria-pressed={group === teamGroup} onClick={() => { setGroup(teamGroup); setSelectedPerson(TEAM_MEMBERS[teamGroup][0]); }}>{teamGroup}</button>)}</div>
          </div>
          <label>Componente<select value={selectedPerson} onChange={(event) => setSelectedPerson(event.target.value)}>{people.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        </section>
        <section className="activity-stats">
          <article><span>Giornate lavorative concluse</span><strong>{completeWorkdayKeys.length}</strong><small>Giorno corrente escluso</small></article>
          <article><span>Giornate ≥ 8 ore</span><strong className="activity-green">{compliant} / {completeWorkdayKeys.length}</strong><small>{complianceRate.toLocaleString("it-IT", { maximumFractionDigits: 0 })}% di copertura</small></article>
          <article><span>Ore loggate nel mese</span><strong>{formatHours(total.logged)}</strong><small>{selectedPerson} · include le ore di oggi</small></article>
          <article><span>Ore pianificate</span><strong className="activity-planned-text">{formatHours(plannedHours)}</strong><small>{plannedEntries.length} giornate future lavorative</small></article>
          <article><span>Ore confermate nel mese</span><strong className="activity-green">{formatHours(total.confirmed)}</strong><small>Solo giorni lavorativi</small></article>
          <article><span>Percentuale confermata</span><strong>{confirmationRate.toLocaleString("it-IT", { maximumFractionDigits: 0 })}%</strong><small>{formatHours(total.unconfirmed)}h ancora non confermate</small></article>
          <article><span>Alert aperti</span><strong className={alerts.length ? "activity-red" : "activity-green"}>{alerts.length}</strong><small>Dal 1° novembre 2026 · {below} giornate sotto 8h</small></article>
        </section>

        <RevenueEstimate records={records} person={selectedPerson} group={group} groupMembers={people} monthPrefix={monthPrefix} todayKey={todayKey} />

        <section className="activity-report">
          <header><div><h2>Report settimanale</h2><p>{selectedPerson} · {monthName} · consuntivi dei giorni conclusi; piani successivi a oggi</p></div><span>Obiettivo giornaliero: 8h</span></header>
          {weeklyRows.length === 0 ? <p className="activity-report-empty">Nessun giorno lavorativo trascorso nel periodo selezionato.</p> :
            <div className="activity-table-wrap"><table>
              <thead><tr><th>Settimana</th><th>Giorni conclusi</th><th>Giornate ≥ 8h</th><th>Ore loggate / attese</th><th>Ore confermate</th><th>Ore pianificate</th><th>Tasso conferma</th><th>Alert</th></tr></thead>
              <tbody>{weeklyRows.map(([week, kpi]) => {
                const weekAlerts = alerts.filter((alert) => alert.date >= week && alert.date <= addDays(week, 6)).length;
                const expectedHours = kpi.workdays * DAILY_TARGET;
                const weekConfirmationRate = kpi.logged ? kpi.confirmed / kpi.logged * 100 : 0;
                return <tr key={week} className={weekAlerts ? "weekly-alert" : ""}>
                  <td>{formatDay(week)} – {formatDay(addDays(week, 4))}</td>
                  <td>{kpi.workdays || "—"}</td>
                  <td>{kpi.workdays ? `${kpi.completeDays} / ${kpi.workdays} (${(kpi.completeDays / kpi.workdays * 100).toLocaleString("it-IT", { maximumFractionDigits: 0 })}%)` : "—"}</td>
                  <td>{kpi.workdays ? `${formatHours(kpi.logged)} / ${formatHours(expectedHours)}h` : "—"}</td>
                  <td>{kpi.workdays ? `${formatHours(kpi.confirmed)}h` : "—"}</td>
                  <td>{kpi.planned ? `${formatHours(kpi.planned)}h · ${kpi.plannedDays} gg` : "—"}</td>
                  <td>{kpi.logged ? `${weekConfirmationRate.toLocaleString("it-IT", { maximumFractionDigits: 0 })}%` : "—"}</td>
                  <td>{weekAlerts || "—"}</td>
                </tr>;
              })}</tbody>
            </table></div>}
        </section>

        <section className="activity-report activity-job-report">
          <header><div><h2>Dove si concentrano le attività</h2><p>{selectedPerson} · {monthName} · ore confermate fino a oggi e pianificate da domani</p></div><span>{jobDetails.length} voci di dettaglio</span></header>
          <div className="activity-analysis">
            <div className="activity-balance-card">
              <div className="activity-balance-heading"><div><strong>Confermate e pianificate</strong><small>{balanceLabel}</small></div><span>{formatHours(totalReportHours)} h totali</span></div>
              <div className="activity-balance-rows" aria-label={`Ore confermate e pianificate: COIG ${formatHours(coigConfirmedHours)} confermate e ${formatHours(coigPlannedHours)} pianificate; non COIG ${formatHours(otherConfirmedHours)} confermate e ${formatHours(otherPlannedHours)} pianificate`}>
                <div className="activity-balance-row">
                  <div className="activity-balance-row-heading"><strong>Interne · COIG</strong><b>{formatHours(coigConfirmedHours + coigPlannedHours)} h totali</b></div>
                  <div className="activity-balance-track activity-balance-pair" role="img" aria-label={`COIG: ${formatHours(coigConfirmedHours)} h confermate e ${formatHours(coigPlannedHours)} h pianificate`}>
                    <span className="activity-balance-coig" title={`Confermate: ${formatHours(coigConfirmedHours)} h`} style={{ width: `${coigConfirmedHours / totalizerScale * 100}%` }} />
                    <span className="activity-balance-planned-coig" title={`Pianificate: ${formatHours(coigPlannedHours)} h`} style={{ width: `${coigPlannedHours / totalizerScale * 100}%` }} />
                  </div>
                  <div className="activity-balance-values"><span><i className="activity-swatch confirmed-coig" />Confermate <strong>{formatHours(coigConfirmedHours)} h</strong></span><span><i className="activity-swatch planned-coig" />Pianificate <strong>{formatHours(coigPlannedHours)} h</strong></span></div>
                </div>
                <div className="activity-balance-row">
                  <div className="activity-balance-row-heading"><strong>Non COIG</strong><b>{formatHours(otherConfirmedHours + otherPlannedHours)} h totali</b></div>
                  <div className="activity-balance-track activity-balance-pair" role="img" aria-label={`Non COIG: ${formatHours(otherConfirmedHours)} h confermate e ${formatHours(otherPlannedHours)} h pianificate`}>
                    <span className="activity-balance-external" title={`Confermate: ${formatHours(otherConfirmedHours)} h`} style={{ width: `${otherConfirmedHours / totalizerScale * 100}%` }} />
                    <span className="activity-balance-planned-external" title={`Pianificate: ${formatHours(otherPlannedHours)} h`} style={{ width: `${otherPlannedHours / totalizerScale * 100}%` }} />
                  </div>
                  <div className="activity-balance-values"><span><i className="activity-swatch confirmed-external" />Confermate <strong>{formatHours(otherConfirmedHours)} h</strong></span><span><i className="activity-swatch planned-external" />Pianificate <strong>{formatHours(otherPlannedHours)} h</strong></span></div>
                </div>
              </div>
            </div>
            <div className="activity-concentration-grid">
              <section className="activity-chart-card">
                <header><div><h3>Attività interne · COIG</h3><p>Ripartizione per attività</p></div><span>{internalActivitySummary.length} attività</span></header>
                {internalActivitySummary.length === 0 ? <p className="activity-chart-empty">Nessuna attività interna nel periodo.</p> : <ol>{internalActivitySummary.slice(0, 7).map((item) => <li key={item.label}>
                  <div className="activity-chart-label"><span title={item.label}>{item.label}</span><strong>{formatHours(item.confirmed)} h confermate · {formatHours(item.planned)} h pianificate</strong></div>
                  <div className="activity-chart-track activity-chart-combined"><i className="coig" style={{ width: `${item.confirmed / internalChartMax * 100}%` }} /><i className="coig-planned" style={{ width: `${item.planned / internalChartMax * 100}%` }} /></div>
                </li>)}</ol>}
                {internalLead && <p className="activity-chart-note">Maggiore attività effettiva: <strong>{internalLead.label}</strong> · {formatHours(internalLead.confirmed)} h confermate</p>}
                {plannedInternalLead && <p className="activity-chart-note">Più ore pianificate: <strong>{plannedInternalLead.label}</strong> · {formatHours(plannedInternalLead.planned)} h</p>}
              </section>
              <section className="activity-chart-card">
                <header><div><h3>Attività non COIG</h3><p>Raggruppate per cliente</p></div><span>{clientSummary.length} clienti</span></header>
                {clientSummary.length === 0 ? <p className="activity-chart-empty">Nessuna attività non COIG nel periodo.</p> : <ol>{clientSummary.slice(0, 7).map((item) => <li key={item.label}>
                  <div className="activity-chart-label"><span title={item.label}>{item.label}</span><strong>{formatHours(item.confirmed)} h confermate · {formatHours(item.planned)} h pianificate</strong></div>
                  <div className="activity-chart-track activity-chart-combined"><i className="external" style={{ width: `${item.confirmed / clientChartMax * 100}%` }} /><i className="external-planned" style={{ width: `${item.planned / clientChartMax * 100}%` }} /></div>
                </li>)}</ol>}
                {clientLead && <p className="activity-chart-note">Cliente con più ore effettive: <strong>{clientLead.label}</strong> · {formatHours(clientLead.confirmed)} h confermate su {clientLead.codes.size} commesse</p>}
                {plannedClientLead && <p className="activity-chart-note">Cliente con più ore pianificate: <strong>{plannedClientLead.label}</strong> · {formatHours(plannedClientLead.planned)} h</p>}
              </section>
            </div>
          </div>
          <details className="activity-job-details">
            <summary>Mostra dettaglio per commessa e attività ({jobDetails.length})</summary>
            {jobDetails.length === 0 ? <p className="activity-report-empty">Nessuna commessa disponibile per il periodo selezionato.</p> :
              <div className="activity-table-wrap"><table>
                <thead><tr><th>Tipo</th><th>Cliente</th><th>Codice commessa</th><th>Commessa / attività</th><th>Ore loggate</th><th>Ore confermate</th></tr></thead>
                <tbody>{jobDetails.map((item, index) => <tr key={`${item.kind}|${item.code}|${item.name}|${item.activity}|${index}`}>
                  <td><span className={item.kind === "COIG" ? "activity-job-badge coig" : "activity-job-badge"}>{item.kind === "COIG" ? "Interna · COIG" : "Non COIG"}</span></td>
                  <td>{item.kind === "COIG" ? "Interna" : item.customer || "Cliente non disponibile"}</td>
                  <td>{item.code || "—"}</td>
                  <td>{[item.name, item.activity].filter(Boolean).join(" · ") || "Descrizione non disponibile"}</td>
                  <td>{formatHours(item.logged)} h</td>
                  <td>{formatHours(item.confirmed)} h</td>
                </tr>)}</tbody>
              </table></div>}
          </details>
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
            const hasDetails = workingDay && key <= todayKey && value !== undefined;
            const state = !workingDay ? "activity-nonworking" : dayAlerts.length ? "activity-anomaly" : key > todayKey ? (value && value.logged > 0 ? "activity-planned" : "activity-no-data") : value === undefined ? "activity-no-data" : value.confirmed >= DAILY_TARGET ? "activity-good" : value.logged >= DAILY_TARGET ? "activity-logged" : "activity-low";
            return <article key={key} className={`activity-day ${state}${hasDetails ? " activity-day-clickable" : ""}`}
              title={holiday || (!workingDay ? "Fine settimana — escluso dal conteggio" : hasDetails ? "Clicca per vedere commesse e clienti" : "")}
              role={hasDetails ? "button" : undefined} tabIndex={hasDetails ? 0 : undefined}
              aria-haspopup={hasDetails ? "dialog" : undefined}
              aria-label={hasDetails ? `${formatDay(key)}: ${formatHours(value!.logged)} ore loggate, clicca per i dettagli` : undefined}
              onClick={hasDetails ? () => setSelectedCalendarDay(key) : undefined}
              onKeyDown={hasDetails ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedCalendarDay(key); } } : undefined}>
              <span>{day}</span>
              {!workingDay ? <small>{holiday || "Weekend · escluso"}</small> : value === undefined || (key > todayKey && value.logged <= 0) ? <><small>{dayAlerts.some((alert) => alert.kind === "hours") ? "Nessun dato · 0h loggate" : key > todayKey ? "Nessun piano" : "Nessun dato"}</small>{dayAlerts.length > 0 && <small className="activity-day-alert-label">Anomalia da verificare</small>}</> :
                key > todayKey ? <><strong>{formatHours(value.logged)} h pianificate</strong><small>Giornata futura lavorativa</small></> :
                  <><strong>{formatHours(value.logged)} h loggate</strong><small>{formatHours(value.confirmed)} h confermate</small><small>{formatHours(value.unconfirmed)} h non confermate</small>{dayAlerts.length > 0 && <small className="activity-day-alert-label">Anomalia da verificare</small>}</>}
            </article>;
          })}</div>
          <footer className="activity-legend"><span><i className="legend-good" /> Almeno 8 ore confermate</span><span><i className="legend-logged" /> Almeno 8 ore loggate, meno di 8 confermate</span><span><i className="legend-planned" /> Ore pianificate dopo oggi</span><span><i className="legend-low" /> Meno di 8 ore loggate</span><span><i className="legend-anomaly" /> Anomalia / conferma scaduta</span><span><i className="legend-none" /> Weekend o festività esclusi</span></footer>
        </section>
        {selectedCalendarDay && <div className="activity-day-modal-backdrop" role="presentation" onClick={() => setSelectedCalendarDay(null)}>
          <section className="activity-day-modal" role="dialog" aria-modal="true" aria-labelledby="activity-day-modal-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><p>{selectedPerson}</p><h2 id="activity-day-modal-title">Commesse del {formatDay(selectedCalendarDay)}</h2><small>{formatHours(selectedDayTotals.logged)} h loggate · {formatHours(selectedDayTotals.confirmed)} h confermate</small></div>
              <button type="button" className="activity-day-modal-close" aria-label="Chiudi dettagli giornata" onClick={() => setSelectedCalendarDay(null)}>×</button>
            </header>
            {selectedDayGroups.length === 0 ? <p className="activity-day-modal-empty">Non risultano commesse associate a questa giornata.</p> :
              <div className="activity-day-modal-groups">{selectedDayGroups.map((group) => <section key={group.customer}>
                <header><h3>{group.customer}</h3><strong>{formatHours(group.logged)} h</strong></header>
                <ul>{group.jobs.map((job, index) => <li key={`${job.kind}|${job.code}|${job.name}|${job.activity}|${index}`}>
                  <div className="activity-day-modal-job-name"><strong>{job.code || job.name || "Commessa senza codice"}</strong><span>{[job.name, job.activity].filter(Boolean).join(" · ") || "Descrizione non disponibile"}</span></div>
                  <div className="activity-day-modal-job-hours"><strong>{formatHours(job.logged)} h</strong><small>{formatHours(job.confirmed)} h confermate</small></div>
                </li>)}</ul>
              </section>)}</div>}
            <footer><span>Componente: {selectedPerson}</span><button type="button" onClick={() => setSelectedCalendarDay(null)}>Chiudi</button></footer>
          </section>
        </div>}
      </>}
    </main>
  );
}
