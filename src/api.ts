import type { Member, Task, TodoItem } from "./types";
import { mockJobs } from "./mockJobs";
import { supabase } from "./supabaseClient";

const RAW_API_BASE = (((import.meta as any)?.env?.VITE_API_BASE || "/api") as string).trim();
const API_BASE = RAW_API_BASE.endsWith("/") ? RAW_API_BASE.slice(0, -1) : RAW_API_BASE;
// Usa localStorage solo se esplicitamente richiesto da configurazione.
const USE_LOCAL_STORAGE = (import.meta as any)?.env?.VITE_USE_LOCAL_STORAGE === "true";
// Usa Supabase se configurato.
const USE_SUPABASE = !!supabase;
const IS_GITHUB_PAGES = typeof window !== "undefined" && window.location.hostname.endsWith("github.io");
// Su GitHub Pages i job CRM vengono letti dallo snapshot pubblicato generato da Azure durante il deploy.
const USE_MOCK_JOBS = USE_LOCAL_STORAGE || IS_GITHUB_PAGES;
const ALLOW_STATIC_JOBS_FALLBACK =
  USE_LOCAL_STORAGE ||
  (import.meta as any)?.env?.VITE_ALLOW_STATIC_JOBS_FALLBACK === "true";
const JOBS_REMOTE_URL = ((import.meta as any)?.env?.VITE_JOBS_URL || "").trim();
const BASE_URL = ((import.meta as any)?.env?.BASE_URL || "/") as string;
let jobsCache: any[] | null = null;

export async function getActivityLogs(): Promise<Record<string, unknown>[]> {
  let response = await fetch(`${BASE_URL}activity-logs.json`, { cache: "no-store" });
  if (!response.ok) {
    response = await fetch("https://raw.githubusercontent.com/lotgio/INT-APPTASKBI/gh-pages/activity-logs.json", { cache: "no-store" });
  }
  if (!response.ok) throw new Error(`Consuntivazioni non disponibili (${response.status})`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function getJobsSourceUrl(): string {
  return JOBS_REMOTE_URL || "./jobs.json";
}

const STORAGE_KEYS = {
  members: "apptaskbi_members",
  tasks: "apptaskbi_tasks",
  jobProgressLineNotes: "apptaskbi_job_progress_line_notes"
} as const;

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveLocal<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureId(id?: string) {
  return id || (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
}

function filterAndPaginateJobs(jobs: any[], options?: { limit?: number; offset?: number; search?: string; division?: string; resourceNo?: string; resourceNos?: string[]; excludeTrasferta?: boolean; excludeMatching?: boolean }) {
  let filtered = jobs;

  if (options?.resourceNos && options.resourceNos.length > 0) {
    const set = new Set(options.resourceNos);
    filtered = filtered.filter((j) => set.has(j["Resource No"]));
  } else if (options?.resourceNo) {
    filtered = filtered.filter((j) => j["Resource No"] === options.resourceNo);
  }

  if (options?.excludeTrasferta !== false) {
    filtered = filtered.filter((j) => !String(j["Detail Description"] || "").toUpperCase().includes("TRASFERTA"));
  }

  if (options?.excludeMatching !== false) {
    filtered = filtered.filter((j) => Number(j.Quantity || 0) !== Number(j["Ore Loggate"] || 0));
  }

  if (options?.search) {
    const search = options.search.toLowerCase();
    filtered = filtered.filter((j) =>
      String(j.JobNo || "").toLowerCase().includes(search) ||
      String(j["Customer Name"] || "").toLowerCase().includes(search) ||
      String(j["Plan Description"] || "").toLowerCase().includes(search)
    );
  }

  if (options?.division) {
    filtered = filtered.filter((j) => j.Division === options.division);
  }

  const offset = options?.offset || 0;
  const limit = options?.limit ?? 0;
  if (limit <= 0) {
    return filtered.slice(offset);
  }
  return filtered.slice(offset, offset + limit);
}

async function loadPublishedJobs(): Promise<any[]> {
  if (jobsCache) return jobsCache;

  const url = getJobsSourceUrl();
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Errore jobs source: ${response.status}`);
  }

  const data = await response.json();
  jobsCache = Array.isArray(data) ? data : (data?.data || []);
  return jobsCache;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Errore richiesta API");
  }

  return response.json() as Promise<T>;
}

export async function getMembers(): Promise<Member[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("members")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    // Mappa lowercase a camelCase
    return (data || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      avatar: m.avatar,
      group: m.membergroup || undefined,
      annualTarget: m.annualtarget
    })) as Member[];
  }
  if (USE_LOCAL_STORAGE) {
    return loadLocal<Member[]>(STORAGE_KEYS.members, []);
  }
  return request<Member[]>("/members");
}

export async function createMember(payload: Omit<Member, "id"> & { id?: string }): Promise<Member> {
  if (USE_SUPABASE && supabase) {
    const dbMember = {
      id: ensureId(payload.id),
      name: payload.name,
      email: payload.email || null,
      role: payload.role || null,
      avatar: payload.avatar || null,
      membergroup: payload.group || null,
      annualtarget: (payload as any).annualTarget || null
    };
    const { error } = await supabase.from("members").insert([dbMember]);
    if (error) throw error;
    return { ...payload, id: dbMember.id } as Member;
  }
  if (USE_LOCAL_STORAGE) {
    const members = loadLocal<Member[]>(STORAGE_KEYS.members, []);
    const created: Member = { ...payload, id: ensureId(payload.id) } as Member;
    const updated = [created, ...members];
    saveLocal(STORAGE_KEYS.members, updated);
    return created;
  }
  return request<Member>("/members", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateMember(id: string, payload: Partial<Member>): Promise<Member> {
  if (USE_SUPABASE && supabase) {
    const dbPayload: any = {};
    if (payload.name !== undefined) dbPayload.name = payload.name;
    if (payload.email !== undefined) dbPayload.email = payload.email;
    if (payload.role !== undefined) dbPayload.role = payload.role;
    if (payload.avatar !== undefined) dbPayload.avatar = payload.avatar;
    if (payload.group !== undefined) dbPayload.membergroup = payload.group || null;
    if ((payload as any).annualTarget !== undefined) dbPayload.annualtarget = (payload as any).annualTarget;

    const { data, error } = await supabase
      .from("members")
      .update(dbPayload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
      avatar: data.avatar,
      group: data.membergroup || undefined,
      annualTarget: data.annualtarget
    } as Member;
  }
  if (USE_LOCAL_STORAGE) {
    const members = loadLocal<Member[]>(STORAGE_KEYS.members, []);
    let updatedMember: Member | null = null;
    const updated = members.map((m) => {
      if (m.id !== id) return m;
      updatedMember = { ...m, ...payload } as Member;
      return updatedMember;
    });
    saveLocal(STORAGE_KEYS.members, updated);
    if (!updatedMember) throw new Error("Member non trovato");
    return updatedMember;
  }
  return request<Member>(`/members/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteMember(id: string): Promise<{ ok: true } | { ok: false }>{
  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  }
  if (USE_LOCAL_STORAGE) {
    const members = loadLocal<Member[]>(STORAGE_KEYS.members, []);
    const updated = members.filter((m) => m.id !== id);
    saveLocal(STORAGE_KEYS.members, updated);
    return { ok: true };
  }
  return request<{ ok: true } | { ok: false }>(`/members/${id}`, {
    method: "DELETE"
  });
}

export async function getTasks(): Promise<Task[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("createdat", { ascending: false });
    if (error) throw error;
    // Mappa i campi da lowercase a camelCase
    return (data || []).map((t: any) => ({
      id: t.id,
      commessa: t.commessa,
      description: t.description,
      client: t.client,
      hours: t.hours,
      status: t.status,
      startDate: t.startdate,
      endDate: t.enddate,
      teamId: t.teamid,
      assigneeId: t.assigneeid,
      createdAt: t.createdat
    })) as Task[];
  }
  if (USE_LOCAL_STORAGE) {
    return loadLocal<Task[]>(STORAGE_KEYS.tasks, []);
  }
  return request<Task[]>("/tasks");
}

export async function createTask(payload: Partial<Task> & Pick<Task, "commessa" | "description" | "client" | "hours" | "startDate" | "endDate">): Promise<Task> {
  if (USE_SUPABASE && supabase) {
    // Mappa camelCase a lowercase per Supabase
    const dbPayload = {
      id: ensureId(payload.id),
      commessa: payload.commessa,
      description: payload.description,
      client: payload.client,
      hours: payload.hours,
      startdate: payload.startDate,
      enddate: payload.endDate,
      status: payload.status || "todo",
      teamid: payload.teamId || "default",
      assigneeid: payload.assigneeId || null,
      createdat: payload.createdAt || new Date().toISOString()
    };
    const { error } = await supabase.from("tasks").insert([dbPayload]);
    if (error) throw error;
    // Torna camelCase al frontend
    return {
      ...payload,
      id: dbPayload.id,
      createdAt: dbPayload.createdat
    } as Task;
  }
  if (USE_LOCAL_STORAGE) {
    const tasks = loadLocal<Task[]>(STORAGE_KEYS.tasks, []);
    const created: Task = {
      ...payload,
      id: ensureId(payload.id),
      createdAt: payload.createdAt || new Date().toISOString()
    } as Task;
    const updated = [created, ...tasks];
    saveLocal(STORAGE_KEYS.tasks, updated);
    return created;
  }
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateTask(id: string, payload: Partial<Task>): Promise<Task> {
  if (USE_SUPABASE && supabase) {
    // Mappa camelCase a lowercase
    const dbPayload: any = {};
    if (payload.commessa !== undefined) dbPayload.commessa = payload.commessa;
    if (payload.description !== undefined) dbPayload.description = payload.description;
    if (payload.client !== undefined) dbPayload.client = payload.client;
    if (payload.hours !== undefined) dbPayload.hours = payload.hours;
    if (payload.status !== undefined) dbPayload.status = payload.status;
    if (payload.startDate !== undefined) dbPayload.startdate = payload.startDate;
    if (payload.endDate !== undefined) dbPayload.enddate = payload.endDate;
    if (payload.teamId !== undefined) dbPayload.teamid = payload.teamId;
    if (payload.assigneeId !== undefined) dbPayload.assigneeid = payload.assigneeId;

    const { data, error } = await supabase
      .from("tasks")
      .update(dbPayload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    // Mappa lowercase a camelCase per il return
    return {
      id: data.id,
      commessa: data.commessa,
      description: data.description,
      client: data.client,
      hours: data.hours,
      status: data.status,
      startDate: data.startdate,
      endDate: data.enddate,
      teamId: data.teamid,
      assigneeId: data.assigneeid,
      createdAt: data.createdat
    } as Task;
  }
  if (USE_LOCAL_STORAGE) {
    const tasks = loadLocal<Task[]>(STORAGE_KEYS.tasks, []);
    let updatedTask: Task | null = null;
    const updated = tasks.map((t) => {
      if (t.id !== id) return t;
      updatedTask = { ...t, ...payload, id } as Task;
      return updatedTask;
    });
    saveLocal(STORAGE_KEYS.tasks, updated);
    if (!updatedTask) throw new Error("Task non trovato");
    return updatedTask;
  }
  return request<Task>(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteTask(id: string): Promise<{ ok: true } | { ok: false }>{
  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  }
  if (USE_LOCAL_STORAGE) {
    const tasks = loadLocal<Task[]>(STORAGE_KEYS.tasks, []);
    const updated = tasks.filter((t) => t.id !== id);
    saveLocal(STORAGE_KEYS.tasks, updated);
    return { ok: true };
  }
  return request<{ ok: true } | { ok: false }>(`/tasks/${id}`, {
    method: "DELETE"
  });
}

export async function getJobs(options?: { limit?: number; offset?: number; search?: string; division?: string; resourceNo?: string; resourceNos?: string[]; excludeTrasferta?: boolean; excludeMatching?: boolean }): Promise<any[]> {
  console.log("ğŸ” getJobs() chiamato con opzioni:", options);
  
  // In localStorage mode usa jobs.json pubblicato (sincronizzato da Azure Blob)
  if (USE_MOCK_JOBS) {
    const jobs = await loadPublishedJobs();
    return filterAndPaginateJobs(jobs, options);
  }
  
  try {
    const limitParam = options?.limit && options.limit > 0 ? options.limit : 1000;
    const params = new URLSearchParams({
      limit: String(limitParam),
      offset: String(options?.offset || 0),
      ...(options?.search && { search: options.search }),
      ...(options?.division && { division: options.division }),
      ...(options?.resourceNo && { resourceNo: options.resourceNo }),
      ...(options?.resourceNos && options.resourceNos.length > 0 && { resourceNos: options.resourceNos.join(",") }),
      excludeTrasferta: String(options?.excludeTrasferta !== false),
      excludeMatching: String(options?.excludeMatching !== false)
    });
    
    const url = `/api/jobs?${params.toString()}`;
    console.log("ğŸ“¡ Fetching", url);
    
    const response = await fetch(url, { cache: "no-store" });
    console.log("ğŸ“¡ Response status:", response.status);
    
    if (!response.ok) {
      throw new Error(`Errore API: ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`âœ“ Caricati ${result.data?.length || 0} job (totale: ${result.total || 0})`);
    
    return result.data || [];
  } catch (err) {
    console.error("âŒ Errore caricamento jobs:", err);
    if (ALLOW_STATIC_JOBS_FALLBACK) {
      console.warn("âš ï¸ Fallback a jobs.json statico abilitato");
      const jobs = await loadPublishedJobs();
      return filterAndPaginateJobs(jobs, options);
    }
    throw err;
  }
}

export async function getJobsStats(): Promise<{ total: number; divisions: string[] }> {
  if (USE_MOCK_JOBS) {
    const jobs = await loadPublishedJobs();
    const divisions = Array.from(new Set(jobs.map((j: any) => j.Division).filter(Boolean)));
    return { total: jobs.length, divisions };
  }
  
  try {
    const response = await fetch(`${API_BASE}/jobs/stats`);
    if (!response.ok) throw new Error("Errore stats");
    return response.json();
  } catch (err) {
    console.error("âŒ Errore stats:", err);
    if (ALLOW_STATIC_JOBS_FALLBACK) {
      const jobs = await loadPublishedJobs();
      const divisions = Array.from(new Set(jobs.map((j: any) => j.Division).filter(Boolean)));
      return { total: jobs.length, divisions };
    }
    throw err;
  }
}

export async function syncJobsFromAzure(): Promise<{ ok: boolean; message: string }> {
  console.log("ğŸ”„ Sincronizzazione commesse da Azure richiesta...");
  
  if (USE_MOCK_JOBS) {
    console.log("ğŸ“¦ ModalitÃ  localStorage: sincronizzazione non disponibile");
    return { ok: true, message: "Sincronizzazione non disponibile in modalitÃ  statica. Usando dati mock." };
  }
  
  try {
    const response = await fetch(`${API_BASE}/sync-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.details || error.error || `Errore HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log("âœ… Sincronizzazione completata:", result.message);
    
    // Ricarica i dati dopo la sincronizzazione
    return { ok: true, message: result.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    console.error("âŒ Errore sincronizzazione:", msg);
    throw err;
  }
}

export async function syncJobsFromPrimarySource(): Promise<{ ok: boolean; message: string; source?: string }> {
  console.log("ğŸ”„ Sincronizzazione commesse da Azure richiesta...");

  if (USE_MOCK_JOBS) {
    console.log("ğŸ“¦ ModalitÃ  localStorage: sincronizzazione non disponibile");
    return { ok: true, message: "Sincronizzazione non disponibile in modalitÃ  statica. Usando dati mock.", source: "static" };
  }

  try {
    const response = await fetch(`${API_BAÛ~-¢G§²ÚîÆ­yÙHÚ[˜Ü›Ûš^˜^š[Û™H^\™Nˆ‹\ÙÊNÃBˆ›İÈ\œÃBˆCBŸCBƒB™^Ü\Ş[˜È[˜İ[Ûˆ\Ü]ÚŞ[˜Ò›ØœÕÛÜšÙ›İÕÚ]ÚÙ[ŠÚÙ[ˆİš[™ÊNˆ›ÛZ\ÙOÈÚÎˆ›ÛÛX[ÈY\ÜØYÙNˆİš[™ÈOˆÃBˆÛÛœİš[[YYÚÙ[ˆHÚÙ[‹š[J
NÃBˆYˆ
]š[[YYÚÙ[ŠHÃBˆ›İÈ™]È\œ›ÜŠ•ÚÙ[ˆÚ]XˆX[˜Ø[HŠNÃBˆCBƒBˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
šÎ‹ËØ\K™Ú]X‹˜ÛÛKÜ™\ÜËÛİÚ[ËÒS•PTTÒĞ’KØXİ[ÛœËİÛÜšÙ›İÜËÜŞ[˜ËZ›ØœË[[Ù\Ü]Ú\È‹ÃBˆY]Ùˆ”ÔÕ‹BˆXY\œÎˆÃBˆÛÛ[U\Hˆ˜\XØ][Û‹ÚœÛÛˆ‹BˆXØÙ\ˆ˜\XØ][Û‹İ›™™Ú]XŠÚœÛÛˆ‹Bˆ]]Üš^˜][Ûˆˆ™X\™\ˆ	İš[[YYÚÙ[ŸXBˆKBˆ›ÙNˆ”ÓÓ‹œİš[™ÚYJÃBˆ™Yˆ›XZ[ˆƒBˆJCBˆJNÃBƒBˆYˆ
\™\ÜÛœÙK›ÚÊHÃBˆ]]Z[ÈHˆÃBˆHÃBˆ]Z[ÈH]ØZ]™\ÜÛœÙK^

NÃBˆHØ]ÚÃBˆ]Z[ÈHˆÃBˆCBˆ›İÈ™]È\œ›ÜŠ]Z[È\œ›Ü™HšYÙÙ\ˆÛÜšÙ›İÈÚ]Xˆ
	Ü™\ÜÛœÙKœİ]\ßJX
NÃBˆCBƒBˆ™]\›ˆÃBˆÚÎˆYKBˆY\ÜØYÙNˆ”Ş[˜È]šX]HšXHÚ]XˆXİ[ÛœËˆ][™HËMHZ[]Nˆ[[Ø[H[ˆÚ]XˆYÙ\ÈYÙÚ[Ü›˜HH]HÛÛÈÜÈ[ÛÛ\][Y[È[HÛÜšÙ›İÈH[\ŞKˆƒBˆNÃBŸCBƒB™^Ü\Ş[˜È[˜İ[ÛˆÙ]›ØœÑ]S\İ\]J
Nˆ›ÛZ\ÙOİš[™È[ˆÃBˆHÃBˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
Ù]›ØœÔÛİ\˜ÙU\›

KÃBˆY]Ùˆ’PQ‹BˆØXÚNˆ››Ë\İÜ™HƒBˆJNÃBƒBˆYˆ
\™\ÜÛœÙK›ÚÊHÃBˆ™]\›ˆ[ÃBˆCBƒBˆ™]\›ˆ™\ÜÛœÙKšXY\œË™Ù]
›\İ[[ÙYšYYŠNÃBˆHØ]ÚÃBˆ™]\›ˆ[ÃBˆCBŸCBƒB™^Ü\Ş[˜È[˜İ[ÛˆÙ]™\Ûİ\˜Ù\Ê
Nˆ›ÛZ\ÙO™XÛÜ™İš[™Ëİš[™ÏˆÃBˆHÃBˆËÈš\ÛÛ™H™\Ûİ\˜Ù\ËšœÛÛˆ™[]]›È[HYÚ[˜HÛÜœ™[H
[š[Û˜HİH]X[ÚX\ÚHİXœ]
CBˆÛÛœİ\›H™]ÈT“
œ™\Ûİ\˜Ù\ËšœÛÛˆ‹Ú[™İË›ØØ][Û‹š™YŠKš™YÃBˆÛÛœİ™\ÜÛœÙHH]ØZ]™]Ú
\›ÈØXÚNˆ››Ë\İÜ™HˆJNÃBˆYˆ
\™\ÜÛœÙK›ÚÊHÃBˆÛÛœÛÛKØ\›ŠÙÙ]™\Ûİ\˜Ù\×H	İ\›H8¡¤ˆ	Ü™\ÜÛœÙKœİ]\ßX
NÃBˆ™]\›ˆßNÃBˆCBˆÛÛœİ]Nˆ\œ˜^OÈ›Îˆİš[™ÎÈ˜[YNˆİš[™ÈOˆH]ØZ]™\ÜÛœÙKšœÛÛŠ
NÃBˆÛÛœÛÛKš[™›ÊÙÙ]™\Ûİ\˜Ù\×HØ\šXØ]H	Ù]K›[™İHš\ÛÜœÙHH	İ\›X
NÃBˆ™]\›ˆØš™Xİ™œ›ÛQ[šY\Ê]K›X\

ŠHOˆÜ‹“›Ë‹“˜[YWJJNÃBˆHØ]Ú
\œŠHÃBˆÛÛœÛÛKØ\›Š–ÙÙ]™\Ûİ\˜Ù\×H\œ›Ü™Nˆ‹\œŠNÃBˆ™]\›ˆßNÃBˆCBŸCBƒB™^Ü\Ş[˜È[˜İ[ÛˆÙ]›Ø”›ÙÜ™\ÜÓ[™S›İ\Ê
Nˆ›ÛZ\ÙO™XÛÜ™İš[™Ëİš[™ÏˆÃBˆYˆ
TÑWÔÕTPTÑH	‰ˆİ\X˜\ÙJHÃBˆÛÛœİÈ]K\œ›ÜˆHH]ØZ]İ\X˜\ÙCBˆ™œ›ÛJš›Ø—Ü›ÙÜ™\Ü×Û[™WÛ›İ\ÈŠCBˆœÙ[Xİ
›[™ZÙ^K›İHŠNÃBˆYˆ
\œ›ÜŠHÃBˆËÈHX™[H›İHİ™X˜™H›Ûˆ\ÜÙ\™H[˜ÛÜ˜Hİ]HÜ™X]H™[›ÙÙ]Èİ\X˜\ÙKƒBˆYˆ

\œ›Üˆ\È[JK˜ÛÙHOOH”Ô”ÕŒHŠHÃBˆ™]\›ˆßNÃBˆCBˆ›İÈ\œ›ÜÃBˆCBƒBˆÛÛœİX\ˆ™XÛÜ™İš[™Ëİš[™ÏˆHßNÃBˆ
]H×JK™›Ü‘XXÚ

›İÎˆ[JHOˆÃBˆÛÛœİÙ^HHİš[™Ê›İË›[™ZÙ^HˆŠKš[J
NÃBˆYˆ
ZÙ^JH™]\›ÃBˆX\ÚÙ^WHHİš[™Ê›İË››İHˆŠNÃBˆJNÃBƒBˆ™]\›ˆX\ÃBˆCBƒBˆYˆ
TÑWÓĞĞSÔÕÔQÑJHÃBˆ™]\›ˆØYØØ[™XÛÜ™İš[™Ëİš[™ÏŠÕÔQÑWÒÑVTËš›Ø”›ÙÜ™\ÜÓ[™S›İ\ËßJNÃBˆCBƒBˆ™]\›ˆßNÃBŸCBƒB™^Ü\Ş[˜È[˜İ[ÛˆØ]™R›Ø”›ÙÜ™\ÜÓ[™S›İJ[™RÙ^Nˆİš[™Ë›İNˆİš[™ÊNˆ›ÛZ\ÙO›ÚYˆÃBˆÛÛœİÙ^HH[™RÙ^Kš[J
NÃBˆYˆ
ZÙ^JH™]\›ÃBƒBˆÛÛœİ›Ü›X[^™Y›İHH›İKœÛXÙJL
NÃBˆYˆ
TÑWÔÕTPTÑH	‰ˆİ\X˜\ÙJHÃBˆYˆ
[›Ü›X[^™Y›İKš[J
JHÃBˆÛÛœİÈ\œ›ÜˆHH]ØZ]İ\X˜\ÙK™œ›ÛJš›Ø—Ü›ÙÜ™\Ü×Û[™WÛ›İ\ÈŠK™[]J
K™\J›[™ZÙ^H‹Ù^JNÃBˆYˆ
\œ›ÜŠHÃBˆYˆ

\œ›Üˆ\È[JK˜ÛÙHOOH”Ô”ÕŒHŠHÃBˆ›İÈ™]È\œ›ÜŠ•X™[H›İH›ÛˆÛÛ™šYİ\˜]HİHİ\X˜\ÙKˆ\ÙYİZHÈØÜš\İ\X˜\ÙKÚ›Ø‹\›ÙÜ™\ÜË[[™K[›İ\ËœÜ[ˆŠNÃBˆCBˆ›İÈ\œ›ÜÃBˆCBˆ™]\›ÃBˆCBƒBˆÛÛœİ^[ØYHÃBˆ[™ZÙ^NˆÙ^KBˆ›İNˆ›Ü›X[^™Y›İKBˆ\]Y]ˆ™]È]J
KÒTÓÔİš[™Ê
CBˆNÃBˆÛÛœİÈ\œ›ÜˆHH]ØZ]İ\X˜\ÙK™œ›ÛJš›Ø—Ü›ÙÜ™\Ü×Û[™WÛ›İ\ÈŠK\Ù\
^[ØYÈÛÛÛ™›Xİˆ›[™ZÙ^HˆJNÃBˆYˆ
\œ›ÜŠHÃBˆYˆ

\œ›Üˆ\È[JK˜ÛÙHOOH”Ô”ÕŒHŠHÃBˆ›İÈ™]È\œ›ÜŠ•X™[H›İH›ÛˆÛÛ™šYİ\˜]HİHİ\X˜\ÙKˆ\ÙYİZHÈØÜš\İ\X˜\ÙKÚ›Ø‹\›ÙÜ™\ÜË[[™K[›İ\ËœÜ[ˆŠNÃBˆCBˆ›İÈ\œ›ÜÃBˆCBˆ™]\›ÃBˆCBƒBˆYˆ
TÑWÓĞĞSÔÕÔQÑJHÃBˆÛÛœİØØ[HØYØØ[™XÛÜ™İš[™Ëİš[™ÏŠÕÔQÑWÒÑVTËš›Ø”›ÙÜ™\ÜÓ[™S›İ\ËßJNÃBˆYˆ
›Ü›X[^™Y›İKš[J
JHÃBˆØØ[ÚÙ^WHH›Ü›X[^™Y›İNÃBˆH[ÙHÃBˆ[]HØØ[ÚÙ^WNÃBˆCBˆØ]™SØØ[
ÕÔQÑWÒÑVTËš›Ø”›ÙÜ™\ÜÓ[™S›İ\ËØØ[
NÃBˆCBŸCBƒB˜ÛÛœİÕÔQÑWÒÑVT×ÕÑÈHÃBˆÙÜÎˆ˜\\ÚØšWİÙÜÈƒBŸH\ÈÛÛœİÃBƒB™^Ü\Ş[˜È[˜İ[ÛˆÙ]ÙÜÊ
Nˆ›ÛZ\ÙOÙÒ][V×OˆÃBˆYˆ
TÑWÔÕTPTÑH	‰ˆİ\X˜\ÙJHÃBˆÛÛœİÈ]K\œ›ÜˆHH]ØZ]İ\X˜\ÙCBˆ™œ›ÛJÙÜÈŠCBˆœÙ[Xİ
ŠˆŠCBˆ›Ü™\Š˜Ü™X]Y]‹È\ØÙ[™[™Îˆ˜[ÙHJNÃBˆYˆ
\œ›ÜŠH›İÈ\œ›ÜÃBˆ™]\›ˆ
]H×JK›X\

ˆ[JHOˆ
ÃBˆYˆšYBˆ]Nˆ]KBˆ\ØÜš\[Ûˆ™\ØÜš\[Û‹BˆÛY[ˆ˜ÛY[BˆÛÛ[Y\ÜØNˆ˜ÛÛ[Y\ÜØKBˆ\Ú[™\ÜÕ[š]ˆ˜\Ú[™\Üİ[š]Bˆ™\Ûİ\˜ÙRYˆœ™\Ûİ\˜ÙZYBˆÛÛ\]Yˆ˜ÛÛ\]YBˆÜ™X]Y]ˆ˜Ü™X]Y]BˆYQ]Nˆ™YY]CBˆJJH\ÈÙÒ][V×NÃBˆCBˆYˆ
TÑWÓĞĞSÔÕÔQÑJHÃBˆ™]\›ˆØYØØ[ÙÒ][V×OŠÕÔQÑWÒÑVT×ÕÑËÙÜË×JNÃBˆCBˆ™]\›ˆ™\]Y\İÙÒ][V×OŠ‹İÙÜÈŠNÃBŸCBƒB™^Ü\Ş[˜È[˜İ[ÛˆÜ™X]UÙÊ^[ØYˆÛZ]ÙÒ][KšYˆ˜Ü™X]Y]ˆ	ˆÈYÎˆİš[™ÈJNˆ›ÛZ\ÙOÙÒ][OˆÃBˆYˆ
TÑWÔÕTPTÑH	‰ˆİ\X˜\ÙJHÃBˆÛÛœİ•ÙÈHÃBˆYˆ[œİ\™RY
^[ØYšY
KBˆ]Nˆ^[ØY]KBˆ\ØÜš\[Ûˆ^[ØY™\ØÜš\[Ûˆ[BˆÛY[ˆ^[ØY˜ÛY[[BˆÛÛ[Y\ÜØNˆ^[ØY˜ÛÛ[Y\ÜØH[Bˆ\Ú[™\Üİ[š]ˆ^[ØY˜\Ú[™\ÜÕ[š][Bˆ™\Ûİ\˜ÙZYˆ^[ØYœ™\Ûİ\˜ÙRY[BˆÛÛ\]Yˆ^[ØY˜ÛÛ\]Y˜[ÙKBˆÜ™X]Y]ˆ^[ØY˜Ü™X]Y]™]È]J
KÒTÓÔİš[™Ê
KBˆYY]Nˆ^[ØY™YQ]H[BˆNÃBˆÛÛœİÈ\œ›ÜˆHH]ØZ]İ\X˜\ÙK™œ›ÛJÙÜÈŠKš[œÙ\
Ù•Ù×JNÃBˆYˆ
\œ›ÜŠH›İÈ\œ›ÜÃBˆ™]\›ˆÈ‹‹œ^[ØYYˆ•ÙËšYÜ™X]Y]ˆ•ÙË˜Ü™X]Y]H\ÈÙÒ][NÃBˆCBˆYˆ
TÑWÓĞĞSÔÕÔQÑJHÃBˆÛÛœİÙÜÈHØYØØ[ÙÒ][V×OŠÕÔQÑWÒÑVT×ÕÑËÙÜË×JNÃBˆÛÛœİÜ™X]YˆÙÒ][HHÃBˆ‹‹œ^[ØYBˆYˆ[œİ\™RY
^[ØYšY
KBˆÜ™X]Y]ˆ^[ØY˜Ü™X]Y]™]È]J
KÒTÓÔİš[™Ê
CBˆH\ÈÙÒ][NÃBˆÛÛœİ\]YHØÜ™X]Y‹‹ÙÜ×NÃBˆØ]™SØØ[
ÕÔQÑWÒÑVT×ÕÑËÙÜË\]Y
NÃBˆ™]\›ˆÜ™X]YÃBˆCBˆ™]\›ˆ™\]Y\İÙÒ][OŠ‹İÙÜÈ‹ÃBˆY]Ùˆ”ÔÕ‹Bˆ›ÙNˆ”ÓÓ‹œİš[™ÚYJ^[ØY
CBˆJNÃBŸCBƒB™^Ü\Ş[˜È[˜İ[Ûˆ\]UÙÊYˆİš[™Ë^[ØYˆ\X[ÙÒ][OŠNˆ›ÛZ\ÙOÙÒ][OˆÃBˆYˆ
TÑWÔÕTPTÑH	‰ˆİ\X˜\ÙJHÃBˆÛÛœİ”^[ØYˆ[HHßNÃBˆYˆ
^[ØY]HOOH[™Yš[™Y
H”^[ØY]HH^[ØY]NÃBˆYˆ
^[ØY™\ØÜš\[ÛˆOOH[™Yš[™Y
H”^[ØY™\ØÜš\[ÛˆH^[ØY™\ØÜš\[ÛÃBˆYˆ
^[ØY˜ÛY[OOH[™Yš[™Y
H”^[ØY˜ÛY[H^[ØY˜ÛY[ÃBˆYˆ
^[ØY˜ÛÛ[Y\ÜØHOOH[™Yš[™Y
H”^[ØY˜ÛÛ[Y\ÜØHH^[ØY˜ÛÛ[Y\ÜØNÃBˆYˆ
^[ØY˜\Ú[™\ÜÕ[š]OOH[™Yš[™Y
H”^[ØY˜\Ú[™\Üİ[š]H^[ØY˜\Ú[™\ÜÕ[š]ÃBˆYˆ
^[ØYœ™\Ûİ\˜ÙRYOOH[™Yš[™Y
H”^[ØYœ™\Ûİ\˜ÙZYH^[ØYœ™\Ûİ\˜ÙRYÃBˆYˆ
^[ØY˜ÛÛ\]YOOH[™Yš[™Y
H”^[ØY˜ÛÛ\]YH^[ØY˜ÛÛ\]YÃBˆYˆ
^[ØY™YQ]HOOH[™Yš[™Y
H”^[ØY™YY]HH^[ØY™YQ]NÃBƒBˆÛÛœİÈ]K\œ›ÜˆHH]ØZ]İ\X˜\ÙCBˆ™œ›ÛJÙÜÈŠCBˆ\]J”^[ØY
CBˆ™\JšY‹Y
CBˆœÙ[Xİ

CBˆœÚ[™ÛJ
NÃBˆYˆ
\œ›ÜŠH›İÈ\œ›ÜÃBˆ™]\›ˆÃBˆYˆ]KšYBˆ]Nˆ]K]KBˆ\ØÜš\[Ûˆ]K™\ØÜš\[Û‹BˆÛY[ˆ]K˜ÛY[BˆÛÛ[Y\ÜØNˆ]K˜ÛÛ[Y\ÜØKBˆ\Ú[™\ÜÕ[š]ˆ]K˜\Ú[™\Üİ[š]Bˆ™\Ûİ\˜ÙRYˆ]Kœ™\Ûİ\˜ÙZYBˆÛÛ\]Yˆ]K˜ÛÛ\]YBˆÜ™X]Y]ˆ]K˜Ü™X]Y]BˆYQ]Nˆ]K™YY]CBˆH\ÈÙÒ][NÃBˆCBˆYˆ
TÑWÓĞĞSÔÕÔQÑJHÃBˆÛÛœİÙÜÈHØYØØ[ÙÒ][V×OŠÕÔQÑWÒÑVT×ÕÑËÙÜË×JNÃBˆ]\]YˆÙÒ][H[H[ÃBˆÛÛœİ™\İ[HÙÜË›X\


HOˆÃBˆYˆ
šYOOHY
H™]\›ˆÃBˆ\]YHÈ‹‹‹‹œ^[ØYYH\ÈÙÒ][NÃBˆ™]\›ˆ\]YÃBˆJNÃBˆØ]™SØØ[
ÕÔQÑWÒÑVT×ÕÑËÙÜË™\İ[
NÃBˆYˆ
]\]Y
H›İÈ™]È\œ›ÜŠ•ÙÈ›Ûˆ›İ˜]ÈŠNÃBˆ™]\›ˆ\]YÃBˆCBˆ™]\›ˆ™\]Y\İÙÒ][OŠİÙÜËÉÚYXÃBˆY]Ùˆ”UÒ‹Bˆ›ÙNˆ”ÓÓ‹œİš[™ÚYJ^[ØY
CBˆJNÃBŸCBƒB™^Ü\Ş[˜È[˜İ[Ûˆ[]UÙÊYˆİš[™ÊNˆ›ÛZ\ÙOÈÚÎˆYHHÈÚÎˆ˜[ÙHOˆÃBˆYˆ
TÑWÔÕTPTÑH	‰ˆİ\X˜\ÙJHÃBˆÛÛœİÈ\œ›ÜˆHH]ØZ]İ\X˜\ÙK™œ›ÛJÙÜÈŠK™[]J
K™\JšY‹Y
NÃBˆYˆ
\œ›ÜŠH›İÈ\œ›ÜÃBˆ™]\›ˆÈÚÎˆYHNÃBˆCBˆYˆ
TÑWÓĞĞSÔÕÔQÑJHÃBˆÛÛœİÙÜÈHØYØØ[ÙÒ][V×OŠÕÔQÑWÒÑVT×ÕÑËÙÜË×JNÃBˆÛÛœİ\]YHÙÜË™š[\Š

HOˆšYOOHY
NÃBˆØ]™SØØ[
ÕÔQÑWÒÑVT×ÕÑËÙÜË\]Y
NÃBˆ™]\›ˆÈÚÎˆYHNÃBˆCBˆ™]\›ˆ™\]Y\İÈÚÎˆYHHÈÚÎˆ˜[ÙHOŠİÙÜËÉÚYXÃBˆY]Ùˆ‘SUHƒBˆJNÃBŸCB