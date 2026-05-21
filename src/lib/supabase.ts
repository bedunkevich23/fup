export type SupabaseClientPlaceholder = {
  status: "not_configured";
  message: string;
};

export const supabase: SupabaseClientPlaceholder = {
  status: "not_configured",
  message: "Frontend-first MVP использует mock-db. Здесь позже подключается Supabase client.",
};
