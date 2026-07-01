import { Fragment, useEffect, useMemo, useState } from "react";
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
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});

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
            mainDescription: String(row.job_description || ""),
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
              Cerca commessa / cliente / descrizione / divisione
              <input
                type="text"
                placeholder="Es: COAS260820, Minerva, Commessa Assistenza..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </label>
          </div>
          <div className="job-progress-actions">
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
              <h3>Avanzamento per commessa (espandi per vedere le righe)</h3>
              <div className="database-table">
                <table>
                  <thead>
                    <tr>
                      <th>Commessa</th>
                      <th>Cliente</th>
                      <th>Descrizione principale</th>
                      <th>Division</th>
                      <th className="number-col">Venduto</th>
                      <th className="number-col">Loggato</th>
                      <th>Avanzamento</th>
                      <th className="number-col">Ore rimanenti</th>
                      <th className="number-col">Giorni rimanenti</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregates.length === 0 && (
                      <tr>
                        <td colSpan={9} style={{ textAlign: "center", color: "#64748b" }}>
                          Nessuna commessa trovata con il codice cercato.
                        </td>
                      </tr>
                    )}
                    {aggregates.map((job) => {
                      const remainingHours = job.soldHours - job.loggedHours;
                      const remainingDays = remainingHours / HOURS_PER_DAY;
                      const isExpanded = !!expandedJobs[job.jobNo];
                      const detailLines = linesByJob.get(job.jobNo) || [];

                      return (
                        <Fragment key={job.jobNo}>
                          <tr>
                            <td>
                              <button className="job-expand-button" onClick={() => handleToggleJob(job.jobNo)}>
                                <span>{isExpanded ? "▼" : "▶"}</span>
                                <strong>{job.jobNo}</strong>
                              </button>
                              <div style={{ fontSize: "11px", color: "#64748b", marginLeft: "22px" }}>{job.lineCount} righe</div>
                            </td>
                            <td>{job.customerName || "-"}</td>
                            <td>{job.mainDescription || "-"}</td>
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
                          {isExpanded && (
                            <tr className="job-progress-detail-row">
                              <td colSpan={9}>
                                <div className="job-progress-detail-wrap">
                                  <table className="job-progress-detail-table">
                                    <thead>
                                      <tr>
                                        <th>Riga</th>
                                        <th>Descrizione riga</th>
                                        <th className="number-col">Venduto</th>
                                        <th className="number-col">Loggato</th>
                                        <th>Avanzamento</th>
                                        <th className="number-col">Ore rimanenti</th>
                                        <th className="number-col">Giorni rimanenti</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detailLines.map((line, index) => {
                                        const detailRemainingHours = line.soldHours - line.loggedHours;
                                        const detailRemainingDays = detailRemainingHours / HOURS_PER_DAY;

                                        return (
                                          <tr key={`${job.jobNo}-${line.jobPlanNo}-${index}`}>
                                            <td>{line.jobPlanNo || "-"}</td>
                                            <td>{line.planDescription || "-"}</td>
                                            <td className="number-col">{formatHours(line.soldHours)}</td>
                                            <td className="number-col">{formatHours(line.loggedHours)}</td>
                                            <td>
                                              <ProgressBarCell loggedHours={line.loggedHours} soldHours={line.soldHours} />
                                            </td>
                                            <td className="number-col">
                                              <span className={detailRemainingHours < 0 ? "job-progress-negative" : ""}>
                                                {formatHours(detailRemainingHours)}
                                              </span>
                                            </td>
                                            <td className="number-col">
                                              <span className={detailRemainingDays < 0 ? "job-progress-negative" : ""}>
                                                {formatDays(detailRemainingDays)}
                                              </span>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
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