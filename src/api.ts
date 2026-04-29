import type { Member, Task, TodoItem } from "./types";
import { mockJobs } from "./mockJobs";
import { supabase } from "./supabaseClient";

const RAW_API_BASE = (((import.meta as any)?.env?.VITE_API_BASE || "/api") as string).trim();
const API_BASE = RAW_API_BASE.endsWith("/") ? RAW_API_BASE.slice(0, -1) : RAW_API_BASE;
// Usa localStorage SOLO se esplicitamente richiesto (es. GitHub Pages)
const USE_LOCAL_STORAGE = (import.meta as any)?.env?.VITE_USE_LOCAL_STORAGE === "true";
// Usa Supabase se configurato (nuovo default)
const USE_SUPABASE = !!supabase;
const IS_GITHUB_PAGES = typeof window !== "undefined" && window.location.hostname.endsWith("github.io");
const USE_MOCK_JOBS = USE_LOCAL_STORAGE || IS_GITHUB_PAGES;
const ALLOW_STATIC_JOBS_FALLBACK =
  USE_LOCAL_STORAGE ||
  (import.meta as any)?.env?.VITE_ALLOW_STATIC_JOBS_FALLBACK === "true";
const JOBS_REMOTE_URL = ((import.meta as any)?.env?.VITE_JOBS_URL || "").trim();
const BASE_URL = ((import.meta as any)?.env?.BASE_URL || "/") as string;
let jobsCache: any[] | null = null;

const STORAGE_KEYS = {
  members: "apptaskbi_members",
  tasks: "apptaskbi_tasks"
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

function filterAndPaginateJobs(jobs: any[], options?: { limit?: number; offset?: number; search?: string; division?: string; resourceNo?: string; excludeTrasferta?: boolean; excludeMatching?: boolean }) {
  let filtered = jobs;

  if (options?.resourceNo) {
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

  const url = JOBS_REMOTE_URL || "./jobs.json";
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
      status: payload.status || "pending",
      teamid: payload.teamId || "default",
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

export async function getJobs(options?: { limit?: number; offset?: number; search?: string; division?: string; resourceNo?: string; excludeTrasferta?: boolean; excludeMatching?: boolean }): Promise<any[]> {
  console.log("🔍 getJobs() chiamato con opzioni:", options);
  
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
      excludeTrasferta: String(options?.excludeTrasferta !== false),
      excludeMatching: String(options?.excludeMatching !== false)
    });
    
    const url = `/api/jobs?${params.toString()}`;
    console.log("📡 Fetching", url);
    
    const response = await fetch(url, { cache: "no-store" });
    console.log("📡 Response status:", response.status);
    
    if (!response.ok) {
      throw new Error(`Errore API: ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`✓ Caricati ${result.data?.length || 0} job (totale: ${result.total || 0})`);
    
    return result.data || [];
  } catch (err) {
    console.error("❌ Errore caricamento jobs:", err);
    if (ALLOW_STATIC_JOBS_FALLBACK) {
      console.warn("⚠️ Fallback a jobs.json statico abilitato");
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
    console.error("❌ Errore stats:", err);
    if (ALLOW_STATIC_JOBS_FALLBACK) {
      const jobs = await loadPublishedJobs();
      const divisions = Array.from(new Set(jobs.map((j: any) => j.Division).filter(Boolean)));
      return { total: jobs.length, divisions };
    }
    throw err;
  }
}

export async function syncJobsFromAzure(): Promise<{ ok: boolean; message: string }> {
  console.log("🔄 Sincronizzazione commesse da Azure richiesta...");
  
  if (USE_MOCK_JOBS) {
    console.log("📦 Modalità localStorage: sincronizzazione non disponibile");
    return { ok: true, message: "Sincronizzazione non disponibile in modalità statica. Usando dati mock." };
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
    console.log("✅ Sincronizzazione completata:", result.message);
    
    // Ricarica i dati dopo la sincronizzazione
    return { ok: true, message: result.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    console.error("❌ Errore sincronizzazione:", msg);
    throw err;
  }
}

const STORAGE_KEYS_TODO = {
  todos: "apptaskbi_todos"
} as const;

export async function getTodos(): Promise<TodoItem[]> {
  if (USE_SUPABASE && supabase) {
    const { data, error } = await supabase
      .from("todos")
      .select("*")
      .order("createdat", { ascending: false });
    if (error) throw error;
    return (data || []).map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      client: t.client,
      commessa: t.commessa,
      businessUnit: t.businessunit,
      resourceId: t.resourceid,
      completed: t.completed,
      createdAt: t.createdat,
      dueDate: t.duedate
    })) as TodoItem[];
  }
  if (USE_LOCAL_STORAGE) {
    return loadLocal<TodoItem[]>(STORAGE_KEYS_TODO.todos, []);
  }
  return request<TodoItem[]>("/todos");
}

export async function createTodo(payload: Omit<TodoItem, "id" | "createdAt"> & { id?: string }): Promise<TodoItem> {
  if (USE_SUPABASE && supabase) {
    const dbTodo = {
      id: ensureId(payload.id),
      title: payload.title,
      description: payload.description || null,
      client: payload.client || null,
      commessa: payload.commessa || null,
      businessunit: payload.businessUnit || null,
      resourceid: payload.resourceId || null,
      completed: payload.completed || false,
      createdat: payload.createdAt || new Date().toISOString(),
      duedate: payload.dueDate || null
    };
    const { error } = await supabase.from("todos").insert([dbTodo]);
    if (error) throw error;
    return { ...payload, id: dbTodo.id, createdAt: dbTodo.createdat } as TodoItem;
  }
  if (USE_LOCAL_STORAGE) {
    const todos = loadLocal<TodoItem[]>(STORAGE_KEYS_TODO.todos, []);
    const created: TodoItem = {
      ...payload,
      id: ensureId(payload.id),
      createdAt: payload.createdAt || new Date().toISOString()
    } as TodoItem;
    const updated = [created, ...todos];
    saveLocal(STORAGE_KEYS_TODO.todos, updated);
    return created;
  }
  return request<TodoItem>("/todos", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateTodo(id: string, payload: Partial<TodoItem>): Promise<TodoItem> {
  if (USE_SUPABASE && supabase) {
    const dbPayload: any = {};
    if (payload.title !== undefined) dbPayload.title = payload.title;
    if (payload.description !== undefined) dbPayload.description = payload.description;
    if (payload.client !== undefined) dbPayload.client = payload.client;
    if (payload.commessa !== undefined) dbPayload.commessa = payload.commessa;
    if (payload.businessUnit !== undefined) dbPayload.businessunit = payload.businessUnit;
    if (payload.resourceId !== undefined) dbPayload.resourceid = payload.resourceId;
    if (payload.completed !== undefined) dbPayload.completed = payload.completed;
    if (payload.dueDate !== undefined) dbPayload.duedate = payload.dueDate;

    const { data, error } = await supabase
      .from("todos")
      .update(dbPayload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      client: data.client,
      commessa: data.commessa,
      businessUnit: data.businessunit,
      resourceId: data.resourceid,
      completed: data.completed,
      createdAt: data.createdat,
      dueDate: data.duedate
    } as TodoItem;
  }
  if (USE_LOCAL_STORAGE) {
    const todos = loadLocal<TodoItem[]>(STORAGE_KEYS_TODO.todos, []);
    let updated: TodoItem | null = null;
    const result = todos.map((t) => {
      if (t.id !== id) return t;
      updated = { ...t, ...payload, id } as TodoItem;
      return updated;
    });
    saveLocal(STORAGE_KEYS_TODO.todos, result);
    if (!updated) throw new Error("Todo non trovato");
    return updated;
  }
  return request<TodoItem>(`/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteTodo(id: string): Promise<{ ok: true } | { ok: false }> {
  if (USE_SUPABASE && supabase) {
    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  }
  if (USE_LOCAL_STORAGE) {
    const todos = loadLocal<TodoItem[]>(STORAGE_KEYS_TODO.todos, []);
    const updated = todos.filter((t) => t.id !== id);
    saveLocal(STORAGE_KEYS_TODO.todos, updated);
    return { ok: true };
  }
  return request<{ ok: true } | { ok: false }>(`/todos/${id}`, {
    method: "DELETE"
  });
}
