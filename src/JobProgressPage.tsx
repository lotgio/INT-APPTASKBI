import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { dispatchSyncJobsWorkflowWithToken, getJobProgressLineNotes, getJobs, getJobsDataLastUpdate, saveJobProgressLineNote, syncJobsFromPrimarySource } from "./api";
import type { Task } from "./types";

interface Props {
  tasks: Task[];
  onSwitchPage: (page: "manage" | "jobs" | "stats" | "database") => void;
  onCreateTaskFromJob?: (job: PlanningJob) => void;
}

interface JobLine {
  jobNo: string;
  jobPlanNo: string;
  customerName: string;
  division: string;
  mainDescription: string;
  planDescription: string;
  soldHours: number;
  loggedHours: number;
  plannedHours: number;
}

interface JobAggregate {
  jobNo: string;
  customerName: string;
  division: string;
  mainDescription: string;
  soldHours: number;
  loggedHours: number;
  lineCount: number;
}

interface PlannedHoursByJob {
  total: number;
  open: number;
}

interface PlanningJob {
  jobNo: string;
  jobPlanNo: string;
  planDescription: string;
  division: string;
  customerName: string;
  parentChainName?: string;
  quantity: number;
  ogreLoggate: number;
  orePianificate: number;
  orePianificateAperte: number;
  oreResidueUfficiali: number;
  orePianificabili: number;
}

const HOURS_PER_DAY = 8;
const PAGE_SIZE = 1000;
type DivisionScope = "owned" | "all";

const STORAGE_KEYS = {
  syncToken: "apptaskbi_sync_github_token"
} as const;

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getProgressPercent(loggedHours: number, soldHours: number): number {
  if (soldHours <= 0) {
    return 0;
  }
  return (loggedHours / soldHours) * 100;
}

function formatHours(value: number): string {
  return `${value.toFixed(1)}h`;
}

function formatDays(value: number): string {
  return `${value.toFixed(1)} gg`;
}

function formatLastUpdate(lastUpdate: string | null): string {
  if (!lastUpdate) {
    return "non disponibile";
  }

  const parsed = new Date(lastUpdate);
  if (Number.isNaN(parsed.getTime())) {
    return "non disponibile";
  }

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function ProgressBarCell({ loggedHours, soldHours }: { loggedHours: number; soldHours: number }) {
  const percent = getProgressPercent(loggedHours, soldHours);
  const width = Math.min(percent, 100);
  const overrun = percent > 100;

  return (
    <div className="job-progress-cell">
      <div className="job-progress-track">
        <div
          className={`job-progress-fill ${overrun ? "overrun" : "normal"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`job-progress-text ${overrun ? "overrun" : ""}`}>{percent.toFixed(1)}%</span>
    </div>
  );
}

function fileTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function getLineStorageKey(line: JobLine): string {
  return [line.jobNo, line.jobPlanNo, line.planDescription].map((part) => (part || "").trim()).join("::");
}

function getJobStorageKey(jobNo: string): string {
  return `JOB::${(jobNo || "").trim()}`;
}

function readStoredToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.syncToken) || "";
  } catch {
    return "";
  }
}

export default function JobProgressPage({ tasks, onSwitchPage, onCreateTaskFromJob }: Props) {
  const [jobLines, setJobLines] = useState<JobLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [divisionScope, setDivisionScope] = useState<DivisionScope>("all");
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const noteSaveTimersRef = useRef<Record<string, number>>({});
  const [isNotesLoading, setIsNotesLoading] = useState(true);

  useEffect(() => {
    setGithubToken(readStoredToken());
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      setIsNotesLoading(true);
      const notes = await getJobProgressLineNotes();
      setLineNotes(notes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore caricamento note";
      setError(msg);
    } finally {
      setIsNotesLoading(false);
    }
  }, []);

  const plannedHoursByJob = useMemo(() => {
    const map: Record<string, PlannedHoursByJob> = {};
    tasks.forEach((task) => {
      if (!task.commessa) return;
      const current = map[task.commessa] || { total: 0, open: 0 };
      current.total += toNumber(task.hours);
      if (task.status !== "done") {
        current.open += toNumber(task.hours);
      }
      map[task.commessa] = current;
    });
    return map;
  }, [tasks]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const rows: any[] = [];
      let offset = 0;

      while (true) {
        const loadAllDivisions = divisionScope === "all";
        const chunk = await getJobs({
          limit: PAGE_SIZE,
          offset,
          ...(loadAllDivisions ? {} : { resourceNo: "CGSSWPOW" })
        });

        rows.push(...chunk);

        if (chunk.length < PAGE_SIZE) {
          break;
        }

        offset += PAGE_SIZE;
      }

      const mapped = rows.map((row): JobLine => {
        const jobNo = String(row.JobNo || "");
        const planned = plannedHoursByJob[jobNo] || { total: 0, open: 0 };
        return {
          jobNo,
          jobPlanNo: String(row.JobPlanNo || ""),
          customerName: String(row["Customer Name"] || ""),
          division: String(row.Division || ""),
          mainDescription: String(row.job_description || ""),
          planDescription: String(row["Plan Description"] || ""),
          soldHours: toNumber(row.Quantity),
          loggedHours: toNumber(row["Ore Loggate"]),
          plannedHours: planned.total
        };
      });

      setJobLines(mapped);
      const lastUpdateValue = await getJobsDataLastUpdate();
      setLastUpdate(lastUpdateValue);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore caricamento avanzamento commesse";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [plannedHoursByJob, divisionScope]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    return () => {
      Object.values(noteSaveTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
    };
  }, []);

  const persistLineNote = useCallback(async (lineKey: string, note: string) => {
    try {
      await saveJobProgressLineNote(lineKey, note);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore salvataggio nota";
      setError(msg);
    }
  }, []);

  const handleLineNoteChange = (lineKey: string, value: string) => {
    const nextValue = value.slice(0, 500);
    setLineNotes((prev) => ({ ...prev, [lineKey]: nextValue }));

    const currentTimer = noteSaveTimersRef.current[lineKey];
    if (currentTimer) {
      window.clearTimeout(currentTimer);
    }

    noteSaveTimersRef.current[lineKey] = window.setTimeout(() => {
      void persistLineNote(lineKey, nextValue);
      delete noteSaveTimersRef.current[lineKey];
    }, 700);
  };

  const handleSaveToken = () => {
    const token = githubToken.trim();
    if (!token) {
      setNotice("Inserisci un token valido prima di salvarlo.");
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEYS.syncToken, token);
      setNotice("Token salvato in locale su questo browser.");
    } catch {
      setError("Impossibile salvare il token in locale.");
    }
  };

  const handleClearToken = () => {
    try {
      localStorage.removeItem(STORAGE_KEYS.syncToken);
    } catch {
      // Ignora errori storage.
    }
    setGithubToken("");
    setNotice("Token locale rimosso.");
  };

  const handleDispatchStaticSync = async (): Promise<boolean> => {
    const token = githubToken.trim();
    if (!token) {
      setNotice("Modalita statica: inserisci il token GitHub nel campo 'Token sync'.");
      return false;
    }

    const dispatchResult = await dispatchSyncJobsWorkflowWithToken(token);
    try {
      localStorage.setItem(STORAGE_KEYS.syncToken, token);
    } catch {
      // Ignora errori storage.
    }
    setNotice(dispatchResult.message);
    return true;
  };

  const handleManualRefresh = async () => {
    try {
      setIsRefreshing(true);
      setNotice(null);
      setError(null);

      try {
        const result = await syncJobsFromPrimarySource();
        const message = result.message || "Aggiornamento dati completato";
        const staticModeMessage = message.toLowerCase().includes("modalità statica") || message.toLowerCase().includes("modalita statica");

        if (staticModeMessage) {
          await handleDispatchStaticSync();
          return;
        }

        setNotice(message);
        await loadData();
      } catch (syncErr) {
        const syncMessage = syncErr instanceof Error ? syncErr.message : "";
        const isStaticMode = syncMessage.toLowerCase().includes("modalità statica") || syncMessage.toLowerCase().includes("modalita statica");

        if (!isStaticMode) {
          throw syncErr;
        }

        await handleDispatchStaticSync();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore aggiornamento dati da CRM";
      setError(msg);
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredLines = useMemo(() => {
    const term = filterText.trim().toLowerCase();
    const base = jobLines.filter((line) => !line.jobNo.toUpperCase().startsWith("COIG"));

    if (!term) return base;

    return base.filter((line) =>
      line.jobNo.toLowerCase().includes(term) ||
      line.jobPlanNo.toLowerCase().includes(term) ||
      line.customerName.toLowerCase().includes(term) ||
      line.division.toLowerCase().includes(term) ||
      line.mainDescription.toLowerCase().includes(term) ||
      line.planDescription.toLowerCase().includes(term)
    );
  }, [jobLines, filterText]);

  const aggregates = useMemo(() => {
    const map = new Map<string, JobAggregate>();

    filteredLines.forEach((line) => {
      const key = line.jobNo;
      const existing = map.get(key);

      if (!existing) {
        map.set(key, {
          jobNo: line.jobNo,
          customerName: line.customerName,
          division: line.division,
          mainDescription: line.mainDescription,
          soldHours: line.soldHours,
          loggedHours: line.loggedHours,
          lineCount: 1
        });
        return;
      }

      if (!existing.mainDescription && line.mainDescription) {
        existing.mainDescription = line.mainDescription;
      }
      existing.soldHours += line.soldHours;
      existing.loggedHours += line.loggedHours;
      existing.lineCount += 1;
    });

    return Array.from(map.values()).sort((a, b) => b.jobNo.localeCompare(a.jobNo));
  }, [filteredLines]);

  const linesByJob = useMemo(() => {
    const map = new Map<string, JobLine[]>();

    filteredLines.forEach((line) => {
      if (!map.has(line.jobNo)) {
        map.set(line.jobNo, []);
      }
      map.get(line.jobNo)?.push(line);
    });

    map.forEach((lines) => {
      lines.sort((a, b) => a.jobPlanNo.localeCompare(b.jobPlanNo));
    });

    return map;
  }, [filteredLines]);

  const totals = useMemo(() => {
    const soldHours = filteredLines.reduce((sum, line) => sum + line.soldHours, 0);
    const loggedHours = filteredLines.reduce((sum, line) => sum + line.loggedHours, 0);
    const remainingHours = soldHours - loggedHours;

    return {
      soldHours,
      loggedHours,
      remainingHours,
      remainingDays: remainingHours / HOURS_PER_DAY
    };
  }, [filteredLines]);

  useEffect(() => {
    setExpandedJobs((prev) => {
      const next: Record<string, boolean> = {};
      aggregates.forEach((aggregate) => {
        if (prev[aggregate.jobNo]) {
          next[aggregate.jobNo] = true;
        }
      });
      return next;
    });
  }, [aggregates]);

  const handleToggleJob = (jobNo: string) => {
    setExpandedJobs((prev) => ({
      ...prev,
      [jobNo]: !prev[jobNo]
    }));
  };

  const handleExpandAll = () => {
    const next: Record<string, boolean> = {};
    aggregates.forEach((aggregate) => {
      next[aggregate.jobNo] = true;
    });
    setExpandedJobs(next);
  };

  const handleCollapseAll = () => {
    setExpandedJobs({});
  };

  const handleExportExcel = () => {
    try {
      setIsExporting(true);
      setError(null);
      setNotice(null);

      const nowIso = new Date().toISOString();
      const summaryData: Array<Array<string | number>> = [
        ["Avanzamento Commesse"],
        [`Generato il: ${nowIso}`],
        [`Filtro testo: ${filterText || "(nessuno)"}`],
        [`Ambito divisioni: ${divisionScope === "all" ? "Tutte le divisioni (PM)" : "Divisione standard"}`],
        [`Ultimo aggiornamento sorgente: ${formatLastUpdate(lastUpdate)}`],
        [
          `Totale commesse: ${aggregates.length}`,
          `Totale righe: ${filteredLines.length}`,
          `Ore vendute: ${totals.soldHours.toFixed(1)}`,
          `Ore loggate: ${totals.loggedHours.toFixed(1)}`,
          `Ore rimanenti: ${totals.remainingHours.toFixed(1)}`,
          `Giorni rimanenti: ${totals.remainingDays.toFixed(1)}`
        ],
        ["Commessa", "Cliente", "Descrizione principale", "Division", "Venduto", "Loggato", "Avanzamento %", "Ore rimanenti", "Giorni rimanenti", "Note commessa"],
        ...aggregates.map((job) => {
          const remainingHours = job.soldHours - job.loggedHours;
          const remainingDays = remainingHours / HOURS_PER_DAY;
          const progress = getProgressPercent(job.loggedHours, job.soldHours);
          const jobKey = getJobStorageKey(job.jobNo);
          return [
            job.jobNo || "-",
            job.customerName || "-",
            job.mainDescription || "-",
            job.division || "-",
            job.soldHours,
            job.loggedHours,
            progress,
            remainingHours,
            remainingDays,
            lineNotes[jobKey] || ""
          ];
        })
      ];

      const detailData: Array<Array<string | number>> = [
        ["Dettaglio righe commessa"],
        ["Commessa", "Riga", "Cliente", "Division", "Descrizione principale", "Descrizione riga", "Venduto", "Loggato", "Avanzamento %", "Ore rimanenti", "Giorni rimanenti", "Note"],
        ...filteredLines.map((line) => {
          const remainingHours = line.soldHours - line.loggedHours;
          const remainingDays = remainingHours / HOURS_PER_DAY;
          const progress = getProgressPercent(line.loggedHours, line.soldHours);
          const lineKey = getLineStorageKey(line);
          return [
            line.jobNo || "-",
            line.jobPlanNo || "-",
            line.customerName || "-",
            line.division || "-",
            line.mainDescription || "-",
            line.planDescription || "-",
            line.soldHours,
            line.loggedHours,
            progress,
            remainingHours,
            remainingDays,
            lineNotes[lineKey] || ""
          ];
        })
      ];

      const wb = XLSX.utils.book_new();
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      const wsDetail = XLSX.utils.aoa_to_sheet(detailData);

      wsSummary["!cols"] = [
        { wch: 14 },
        { wch: 28 },
        { wch: 38 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 16 },
        { wch: 18 },
        { wch: 42 }
      ];

      wsDetail["!cols"] = [
        { wch: 14 },
        { wch: 10 },
        { wch: 28 },
        { wch: 12 },
        { wch: 32 },
        { wch: 36 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 16 },
        { wch: 18 },
        { wch: 42 }
      ];

      const baseStyle = {
        font: { name: "Segoe UI", sz: 10, color: { rgb: "0F172A" } },
        alignment: { vertical: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "E2E8F0" } },
          bottom: { style: "thin", color: { rgb: "E2E8F0" } },
          left: { style: "thin", color: { rgb: "E2E8F0" } },
          right: { style: "thin", color: { rgb: "E2E8F0" } }
        }
      };

      const titleStyle = {
        ...baseStyle,
        font: { name: "Segoe UI", sz: 14, bold: true, color: { rgb: "0F172A" } },
        fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } }
      };

      const headerStyle = {
        ...baseStyle,
        font: { name: "Segoe UI", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "1E293B" } },
        alignment: { vertical: "center", horizontal: "center", wrapText: true }
      };

      const numberStyle = {
        ...baseStyle,
        numFmt: "0.0",
        alignment: { vertical: "center", horizontal: "right" }
      };

      const negativeNumberStyle = {
        ...numberStyle,
        font: { name: "Segoe UI", sz: 10, color: { rgb: "B91C1C" } }
      };

      const applyStyle = (ws: XLSX.WorkSheet, row: number, col: number, style: any) => {
        const addr = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[addr]) return;
        ws[addr].s = style;
      };

      for (let c = 0; c < 10; c += 1) {
        applyStyle(wsSummary, 0, c, titleStyle);
        applyStyle(wsSummary, 6, c, headerStyle);
      }

      for (let r = 1; r < summaryData.length; r += 1) {
        for (let c = 0; c < 10; c += 1) {
          applyStyle(wsSummary, r, c, baseStyle);
        }
      }

      for (let i = 0; i < aggregates.length; i += 1) {
        const row = 7 + i;
        const job = aggregates[i];
        const remainingHours = job.soldHours - job.loggedHours;
        const remainingDays = remainingHours / HOURS_PER_DAY;
        const progress = getProgressPercent(job.loggedHours, job.soldHours);

        [4, 5, 6, 7, 8].forEach((col) => applyStyle(wsSummary, row, col, numberStyle));
        if (progress > 100) applyStyle(wsSummary, row, 6, negativeNumberStyle);
        if (remainingHours < 0) applyStyle(wsSummary, row, 7, negativeNumberStyle);
        if (remainingDays < 0) applyStyle(wsSummary, row, 8, negativeNumberStyle);
      }

      for (let c = 0; c < 12; c += 1) {
        applyStyle(wsDetail, 0, c, titleStyle);
        applyStyle(wsDetail, 1, c, headerStyle);
      }

      for (let r = 2; r < detailData.length; r += 1) {
        for (let c = 0; c < 12; c += 1) {
          applyStyle(wsDetail, r, c, baseStyle);
        }
      }

      for (let i = 0; i < filteredLines.length; i += 1) {
        const row = 2 + i;
        const line = filteredLines[i];
        const remainingHours = line.soldHours - line.loggedHours;
        const remainingDays = remainingHours / HOURS_PER_DAY;
        const progress = getProgressPercent(line.loggedHours, line.soldHours);

        [6, 7, 8, 9, 10].forEach((col) => applyStyle(wsDetail, row, col, numberStyle));
        if (progress > 100) applyStyle(wsDetail, row, 8, negativeNumberStyle);
        if (remainingHours < 0) applyStyle(wsDetail, row, 9, negativeNumberStyle);
        if (remainingDays < 0) applyStyle(wsDetail, row, 10, negativeNumberStyle);
      }

      XLSX.utils.book_append_sheet(wb, wsSummary, "Riepilogo");
      XLSX.utils.book_append_sheet(wb, wsDetail, "Dettaglio Righe");
      XLSX.writeFile(wb, `avanzamento_commesse_${fileTimestamp()}.xlsx`, { compression: true });

      setNotice("Export Excel completato: file .xlsx scaricato.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore durante export Excel";
      setError(msg);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Commesse</p>
          <h1>Avanzamento commessa e righe</h1>
          <p className="subtitle">
            Ultimo aggiornamento dati: <strong>{formatLastUpdate(lastUpdate)}</strong>
          </p>
          <p className="subtitle" style={{ marginTop: "4px" }}>
            Ambito righe: <strong>{divisionScope === "all" ? "Tutte le divisioni (modalita PM)" : "Divisione standard"}</strong>
          </p>
        </div>
        <div className="stats">
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Ore vendute</span>
              <span className="kpi-value">{totals.soldHours.toFixed(1)}</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Ore loggate</span>
              <span className="kpi-value">{totals.loggedHours.toFixed(1)}</span>
            </div>
          </div>
        </div>
        <div className="hero-buttons">
          <button className="secondary" onClick={() => onSwitchPage("jobs")}>
            Vai a Commesse
          </button>
          <button className="secondary" onClick={() => onSwitchPage("manage")}>
            Torna al calendario
          </button>
        </div>
      </header>

      <main className="panel job-progress-layout">
        {error && <div className="alert">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <div className="job-progress-summary-row">
          <div className="stat">
            <strong>{filteredLines.length}</strong>
            <span>Righe commessa</span>
          </div>
          <div className="stat">
            <strong>{aggregates.length}</strong>
            <span>Commesse</span>
          </div>
          <div className="stat">
            <strong>{formatHours(Math.max(totals.remainingHours, 0))}</strong>
            <span>Ore rimanenti totali</span>
          </div>
          <div className="stat">
            <strong>{isNotesLoading ? "..." : Object.keys(lineNotes).length}</strong>
            <span>Note salvate</span>
          </div>
          <div className="stat">
            <strong>{formatDays(Math.max(totals.remainingDays, 0))}</strong>
            <span>Giorni rimanenti totali (8h)</span>
          </div>
        </div>

        <div className="database-controls">
          <div className="sort-controls">
            <label>
              Ambito divisioni
              <select
                value={divisionScope}
                onChange={(e) => setDivisionScope(e.target.value as DivisionScope)}
              >
                <option value="owned">Solo divisione standard</option>
                <option value="all">Tutte le divisioni (PM)</option>
              </select>
            </label>
            <label>
              Cerca commessa / cliente / descrizione / divisione
              <input
                type="text"
                placeholder="Es: COAS260820, Minerva, Commessa Assistenza..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </label>
            <label>
              Token sync (GitHub PAT)
              <input
                type="password"
                placeholder="github_pat_..."
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="job-progress-actions">
            <button className="secondary" onClick={handleSaveToken}>
              Salva token
            </button>
            <button className="secondary" onClick={handleClearToken}>
              Rimuovi token
            </button>
            <button className="secondary" onClick={handleManualRefresh} disabled={isRefreshing}>
              {isRefreshing ? "Aggiornamento..." : "Aggiorna da CRM"}
            </button>
            <button className="secondary" onClick={handleExportExcel} disabled={isExporting || loading}>
              {isExporting ? "Export..." : "Esporta Excel"}
            </button>
            <button className="secondary" onClick={handleExpandAll}>Espandi tutte</button>
            <button className="secondary" onClick={handleCollapseAll}>Chiudi tutte</button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
            Caricamento avanzamento...
          </div>
        ) : (
          <>
            <section className="job-progress-section">
              <h3>Avanzamento commesse ({aggregates.length} commesse, {filteredLines.length} righe)</h3>
              <div className="database-table">
                <table>
                  <thead>
                    <tr>
                      <th>Commessa / Riga</th>
                      <th>Cliente</th>
                      <th>Descrizione</th>
                      <th>Division</th>
                      <th className="number-col">Venduto</th>
                      <th className="number-col">Loggato</th>
                      <th>Avanzamento</th>
                      <th className="number-col">Ore rimanenti</th>
                      <th className="number-col">Giorni rimanenti</th>
                      <th>Note</th>
                      <th className="actions-col">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregates.length === 0 && (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", color: "#64748b" }}>
                          Nessuna commessa trovata con i filtri correnti.
                        </td>
                      </tr>
                    )}
                    {aggregates.map((job) => {
                      const jobRemainingHours = job.soldHours - job.loggedHours;
                      const jobRemainingDays = jobRemainingHours / HOURS_PER_DAY;
                      const jobKey = getJobStorageKey(job.jobNo);
                      const planned = plannedHoursByJob[job.jobNo] || { total: 0, open: 0 };
                      const oreResidueUfficiali = Math.max(0, jobRemainingHours);
                      const orePianificabili = Math.max(0, jobRemainingHours - planned.open);
                      const macroJob: PlanningJob = {
                        jobNo: job.jobNo,
                        jobPlanNo: "",
                        planDescription: job.mainDescription || `Task per ${job.jobNo}`,
                        division: job.division,
                        customerName: job.customerName,
                        quantity: job.soldHours,
                        ogreLoggate: job.loggedHours,
                        orePianificate: planned.total,
                        orePianificateAperte: planned.open,
                        oreResidueUfficiali,
                        orePianificabili
                      };
                      const detailLines = linesByJob.get(job.jobNo) || [];
                      const isExpanded = !!expandedJobs[job.jobNo];

                      return (
                        <Fragment key={job.jobNo}>
                          {/* Riga macro commessa */}
                          <tr style={{ backgroundColor: "#f1f5f9", borderTop: "2px solid #cbd5e1" }}>
                            <td>
                              <button className="job-expand-button" onClick={() => handleToggleJob(job.jobNo)}>
                                <span>{isExpanded ? "▼" : "▶"}</span>
                                <strong style={{ fontSize: "13px" }}>{job.jobNo}</strong>
                              </button>
                              <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "8px" }}>{job.lineCount} {job.lineCount === 1 ? "riga" : "righe"}</span>
                            </td>
                            <td><strong>{job.customerName || "-"}</strong></td>
                            <td style={{ maxWidth: "240px" }}>{job.mainDescription || "-"}</td>
                            <td style={{ fontSize: "11px", color: "#64748b" }}>{job.division || "-"}</td>
                            <td className="number-col"><strong>{formatHours(job.soldHours)}</strong></td>
                            <td className="number-col"><strong>{formatHours(job.loggedHours)}</strong></td>
                            <td>
                              <ProgressBarCell loggedHours={job.loggedHours} soldHours={job.soldHours} />
                            </td>
                            <td className="number-col">
                              <strong className={jobRemainingHours < 0 ? "job-progress-negative" : ""}>
                                {formatHours(jobRemainingHours)}
                              </strong>
                            </td>
                            <td className="number-col">
                              <strong className={jobRemainingDays < 0 ? "job-progress-negative" : ""}>
                                {formatDays(jobRemainingDays)}
                              </strong>
                            </td>
                            <td>
                              <textarea
                                className="job-progress-note-input"
                                value={lineNotes[jobKey] || ""}
                                onChange={(e) => handleLineNoteChange(jobKey, e.target.value)}
                                placeholder="Nota commessa..."
                                rows={2}
                              />
                            </td>
                            <td className="actions-col">
                              <button
                                className="primary-small"
                                onClick={() => onCreateTaskFromJob?.(macroJob)}
                                title={orePianificabili > 0 ? `Pianifica su commessa (${orePianificabili.toFixed(1)}h pianificabili)` : "Commessa già coperta — puoi comunque aggiungere"}
                              >
                                +
                              </button>
                            </td>
                          </tr>
                          {/* Righe di dettaglio — visibili solo se espanse */}
                          {isExpanded && detailLines.map((line, index) => {
                            const remainingHours = line.soldHours - line.loggedHours;
                            const remainingDays = remainingHours / HOURS_PER_DAY;
                            const lineKey = getLineStorageKey(line);
                            const lineOrePianificabili = Math.max(0, remainingHours);
                            const linePlanningJob: PlanningJob = {
                              jobNo: line.jobNo,
                              jobPlanNo: line.jobPlanNo,
                              planDescription: line.planDescription || `Riga ${line.jobPlanNo} — ${line.jobNo}`,
                              division: line.division,
                              customerName: line.customerName,
                              quantity: line.soldHours,
                              ogreLoggate: line.loggedHours,
                              orePianificate: line.plannedHours,
                              orePianificateAperte: 0,
                              oreResidueUfficiali: Math.max(0, remainingHours),
                              orePianificabili: lineOrePianificabili
                            };

                            return (
                              <tr key={`${job.jobNo}-${line.jobPlanNo}-${index}`} style={{ backgroundColor: "#fff" }}>
                                <td style={{ paddingLeft: "28px" }}>
                                  <span style={{ fontSize: "11px", color: "#475569" }}>↳ {line.jobPlanNo || "-"}</span>
                                </td>
                                <td style={{ fontSize: "13px", color: "#475569" }}>{line.customerName || "-"}</td>
                                <td style={{ maxWidth: "240px", fontSize: "13px" }}>{line.planDescription || "-"}</td>
                                <td style={{ fontSize: "11px", color: "#64748b" }}>{line.division || "-"}</td>
                                <td className="number-col">{formatHours(line.soldHours)}</td>
                                <td className="number-col">{formatHours(line.loggedHours)}</td>
                                <td>
                                  <ProgressBarCell loggedHours={line.loggedHours} soldHours={line.soldHours} />
                                </td>
                                <td className="number-col">
                                  <span className={remainingHours < 0 ? "job-progress-negative" : ""}>
                                    {formatHours(remainingHours)}
                                  </span>
                                </td>
                                <td className="number-col">
                                  <span className={remainingDays < 0 ? "job-progress-negative" : ""}>
                                    {formatDays(remainingDays)}
                                  </span>
                                </td>
                                <td>
                                  <textarea
                                    className="job-progress-note-input"
                                    value={lineNotes[lineKey] || ""}
                                    onChange={(e) => handleLineNoteChange(lineKey, e.target.value)}
                                    placeholder="Nota riga..."
                                    rows={2}
                                  />
                                </td>
                                <td className="actions-col">
                                  <button
                                    className="primary-small"
                                    onClick={() => onCreateTaskFromJob?.(linePlanningJob)}
                                    title={lineOrePianificabili > 0 ? `Pianifica riga (${lineOrePianificabili.toFixed(1)}h residue)` : "Riga già coperta — puoi comunque aggiungere"}
                                  >
                                    +
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}