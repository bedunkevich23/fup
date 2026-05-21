type ApiOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export const USE_BACKEND =
  String(import.meta.env.VITE_USE_BACKEND ?? import.meta.env.NEXT_PUBLIC_USE_BACKEND ?? "false") === "true";

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Ошибка API" }));
    throw new Error(error.error || "Ошибка API");
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  authTelegramMiniApp: (input: { initData: string; inviteCode?: string; eventSlug?: string }) =>
    api("/api/auth/telegram-miniapp", { method: "POST", body: input }),
  logout: () => api("/api/auth/logout", { method: "POST" }),
  getMe: () => api("/api/me"),
  updateProfile: (profile: Record<string, unknown>) => api("/api/profile", { method: "POST", body: profile }),
  joinEvent: (inviteCode: string) => api("/api/events/join", { method: "POST", body: { inviteCode } }),
  getEventHome: (eventId: string) => api(`/api/events/${eventId}/home`),
  getEventMembers: (eventId: string) => api(`/api/events/${eventId}/members`),
  getRecommendations: (eventId: string) => api(`/api/events/${eventId}/recommendations`),
  createContact: (eventId: string, input: Record<string, unknown>) =>
    api(`/api/events/${eventId}/contacts`, { method: "POST", body: input }),
  getContacts: (eventId: string) => api(`/api/events/${eventId}/contacts`),
  getFollowups: (eventId: string) => api(`/api/events/${eventId}/followups`),
  updateFollowupAction: (followupId: string, input: { action: string; snoozeUntil?: string }) =>
    api(`/api/followups/${followupId}/action`, { method: "POST", body: input }),
  getPublicEventByInvite: (inviteCode: string) => api(`/api/events/public/by-invite/${encodeURIComponent(inviteCode)}`),
  getOrgMe: () => api("/api/org/me"),
  createOrganization: (input: Record<string, unknown>) => api("/api/org/organizations", { method: "POST", body: input }),
  getOrganizerEvents: () => api("/api/org/events"),
  createOrgEvent: (input: Record<string, unknown>) => api("/api/org/events", { method: "POST", body: input }),
  getOrganizerEvent: (eventId: string) => api(`/api/org/events/${eventId}`),
  updateOrganizerEvent: (eventId: string, input: Record<string, unknown>) =>
    api(`/api/org/events/${eventId}`, { method: "PATCH", body: input }),
  archiveOrganizerEvent: (eventId: string) => api(`/api/org/events/${eventId}`, { method: "DELETE" }),
  getOrganizerInvite: (eventId: string) => api(`/api/org/events/${eventId}/invite`),
  getOrganizerLive: (eventId: string) => api(`/api/org/events/${eventId}/live`),
  getOrganizerDashboard: (eventId: string) => api(`/api/org/events/${eventId}/dashboard`),
  getOrganizerReport: (eventId: string) => api(`/api/org/events/${eventId}/report`),
};
