import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

// Se mancano le credenziali, crea un client vuoto (fallback a localStorage)
let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  console.log("✅ Supabase configurato:", supabaseUrl);
} else {
  console.warn("⚠️ Supabase non configurato - usando fallback localStorage");
}

export { supabase };
