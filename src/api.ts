import type { Member, Task } from "./types";
import { mockJobs } from "./mockJobs";

const API_BASE = "/api";
const USE_LOCAL_STORAGE = (import.meta as any)?.env?.VITE_USE_LOCAL_STORAGE !== "false";
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
  if (USE_LOCAL_STORAGE) {
    return loadLocal<Member[]>(STORAGE_KEYS.members, []);
  }
  return request<Member[]>("/members");
}

export async function createMember(payload: Omit<Member, "id"> & { id?: string }): Promise<Member> {
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
  if (USE_LOCAL_STORAGE) {
    return loadLocal<Task[]>(STORAGE_KEYS.tasks, []);
  }
  return request<Task[]>("/tasks");
}

export async function createTask(payload: Partial<Task> & Pick<Task, "commessa" | "description" | "client" | "hours" | "startDate" | "endDate">): Promise<Task> {
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
  try {
    const params = new URLSearchParams({
      limit: String(options?.limit || 50),
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
    throw err;
  }
}

export async function getJobsStats(): Promise<{ total: number; divisions: string[] }> {
  try {
    const response = await fetch("/api/jobs/stats");
    if (!response.ok) throw new Error("Errore stats");
    return response.json();
  } catch (err) {
    console.error("❌ Errore stats:", err);
    return { total: 0, divisions: [] };
  }
}

export async function syncJobsFromAzure(): Promise<{ ok: boolean; message: string }> {
  console.log("🔄 Sincronizzazione commesse da Azure richiesta...");
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
