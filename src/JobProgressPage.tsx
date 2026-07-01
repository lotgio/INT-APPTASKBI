import { useEffect, useMemo, useState } from "react";
import { getJobs, getJobsDataLastUpdate } from "./api";
import type { Task } from "./types";

interface Props {
  tasks: Task[];
  onSwitchPage: (page: "manage" | "jobs" | "stats" | "database") => void;
}

interface JobLine {
  jobNo: string;
  jobPlanNo: string;
  customerName: string;
  division: string;
  planDescription: string;
  soldHours: number;
  loggedHours: number;
  plannedHours: number;
}

interface JobAggregate {
  jobNo: string;
  customerName: string;
  division: string;
  soldHours: number;
  loggedHours: number;
  lineCount: number;
}

const HOURS_PER_DAY = 8;
const PAGE_SIZE = 1000;

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

export default function JobProgressPage({ tasks, onSwitchPage }: Props) {
  const [jobLines, setJobLines] = useState<JobLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");

  const plannedHoursByJob = useMemo(() => {
    const map: Record<string, number> = {};
    tasks.forEach((task) => {
      if (!task.commessa) return;
      map[task.commessa] = (map[task.commessa] || 0) + toNumber(task.hours);
    });
    return map;
  }, [tasks]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const rows: any[] = [];
        let offset = 0;

        while (true) {
          const chunk = await getJobs({
            limit: PAGE_SIZE,
            offset,
            resourceNo: "CGSSWPOW"
          });

          rows.push(...chunk);

          if (chunk.length < PAGE_SIZE) {
            break;
          }

          offset += PAGE_SIZE;
        }

        const mapped = rows.map((row): JobLine => {
          const jobNo = String(row.JobNo || "");
          return {
            jobNo,
            jobPlanNo: String(row.JobPlanNo || ""),
            customerName: String(row["Customer Name"] || ""),
            division: String(row.Division || ""),
            planDescription: String(row["Plan Description"] || ""),
            soldHours: toNumber(row.Quantity),
            loggedHours: toNumber(row["Ore Loggate"]),
            plannedHours: plannedHoursByJob[jobNo] || 0
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
    };

    load();
  }, [plannedHoursByJob]);

  const filteredLines = useMemo(() => {
    const term = filterText.trim().toLowerCase();
    if (!term) return jobLines;

    return jobLines.filter((line) =>
      line.jobNo.toLowerCase().includes(term) ||
      line.jobPlanNo.toLowerCase().includes(term) ||
      line.customerName.toLowerCase().includes(term) ||
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
          soldHours: line.soldHours,
          loggedHours: line.loggedHours,
          lineCount: 1
        });
        return;
      }

      existing.soldHours += line.soldHours;
      existing.loggedHours += line.loggedHours;
      existing.lineCount += 1;
    });

    return Array.from(map.values()).sort((a, b) => b.jobNo.localeCompare(a.jobNo));
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

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Commesse</p>
          <h1>Avanzamento commessa e righe</h1>
          <p className="subtitle">
            Ultimo aggiornamento dati: <strong>{formatLastUpdate(lastUpdate)}</strong>
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
            <strong>{formatDays(Math.max(totals.remainingDays, 0))}</strong>
            <span>Giorni rimanenti totali (8h)</span>
          </div>
        </div>

        <div className="database-controls">
          <div className="sort-controls">
            <label>
              Filtra commessa / cliente / descrizione
              <input
                type="text"
                placeholder="Es: COAS260820, cliente, descrizione..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </label>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
            Caricamento avanzamento...
          </div>
        ) : (
          <>
            <section className="job-progress-section">
              <h3>Avanzamento per commessa</h3>
              <div className="database-table">
                <table>
                  <thead>
                    <tr>
                      <th>Commessa</th>
                      <th>Cliente</th>
                      <th>Division</th>
                      <th className="number-col">Venduto</th>
                      <th className="number-col">Loggato</th>
                      <th>Avanzamento</th>
                      <th className="number-col">Ore rimanenti</th>
                      <th className="number-col">Giorni rimanenti</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregates.map((job) => {
                      const remainingHours = job.soldHours - job.loggedHours;
                      const remainingDays = remainingHours / HOURS_PER_DAY;

                      return (
                        <tr key={job.jobNo}>
                          <td>
                            <strong>{job.jobNo}</strong>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{job.lineCount} righe</div>
                          </td>
                          <td>{job.customerName || "-"}</td>
                          <td>{job.division || "-"}</td>
                          <td className="number-col">{formatHours(job.soldHours)}</td>
                          <td className="number-col">{formatHours(job.loggedHours)}</td>
                          <td>
                            <ProgressBarCell loggedHours={job.loggedHours} soldHours={job.soldHours} />
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="job-progress-section">
              <h3>Avanzamento per singola riga commessa</h3>
              <div className="database-table">
                <table>
                  <thead>
                    <tr>
                      <th>Commessa</th>
                      <th>Riga</th>
                      <th>Cliente</th>
                      <th>Descrizione riga</th>
                      <th className="number-col">Venduto</th>
                      <th className="number-col">Loggato</th>
                      <th>Avanzamento</th>
                      <th className="number-col">Ore rimanenti</th>
                      <th className="number-col">Giorni rimanenti</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLines
                      .slice()
                      .sort((a, b) => b.jobNo.localeCompare(a.jobNo) || a.jobPlanNo.localeCompare(b.jobPlanNo))
                      .map((line, index) => {
                        const remainingHours = line.soldHours - line.loggedHours;
                        const remainingDays = remainingHours / HOURS_PER_DAY;

                        return (
                          <tr key={`${line.jobNo}-${line.jobPlanNo}-${index}`}>
                            <td><strong>{line.jobNo || "-"}</strong></td>
                            <td>{line.jobPlanNo || "-"}</td>
                            <td>{line.customerName || "-"}</td>
                            <td>{line.planDescription || "-"}</td>
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
                          </tr>
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