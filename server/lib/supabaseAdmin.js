import "./env.js";
import { createClient } from "@supabase/supabase-js";

export const hasSupabaseEnv = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const supabaseAdmin = hasSupabaseEnv
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

export function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin can be used only on the backend");
  }
}
