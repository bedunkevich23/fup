type ApiOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
};

export const USE_BACKEND =
  String(import.meta.env.VITE_USE_BACKEND ?? import.meta.env.NEXT_PUBLIC_USE_BACKEND ?? "false") === "true";

const DEFAULT_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 350;
const inFlightGets = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

class ApiRequestError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.retryable = retryable;
  }
}

async function fetchOnce<T>(path: string, options: Required<Pick<ApiOptions, "method">> & ApiOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      method: options.method,
      credentials: "include",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Ошибка API" }));
      throw new ApiRequestError(error.error || "Ошибка API", response.status, response.status >= 500);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError("Сеть отвечает слишком долго. Попробуйте еще раз.", undefined, true);
    }
    throw new ApiRequestError(error instanceof Error ? error.message : "Нет соединения с FUP", undefined, true);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestWithRetry<T>(path: string, options: Required<Pick<ApiOptions, "method">> & ApiOptions): Promise<T> {
  const canRetry = options.method === "GET";
  try {
    return await fetchOnce<T>(path, options);
  } catch (error) {
    if (!canRetry || !(error instanceof ApiRequestError) || !error.retryable) throw error;
    await sleep(RETRY_DELAY_MS);
    return fetchOnce<T>(path, options);
  }
}

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const normalizedOptions = { ...options, method };
  const canDedupe = method === "GET" && !options.body;
  const key = `${method}:${path}`;

  if (canDedupe && inFlightGets.has(key)) {
    return inFlightGets.get(key) as Promise<T>;
  }

  const request = requestWithRetry<T>(path, normalizedOptions);
  if (!canDedupe) return request;

  inFlightGets.set(key, request);
  void request.then(
    () => inFlightGets.delete(key),
    () => inFlightGets.delete(key),
  );
  return request;
}

export const apiClient = {
  authTelegramMiniApp: (input: { initData: string; inviteCode?: string; eventSlug?: string }) =>
    api("/api/auth/telegram-miniapp", { method: "POST", body: input }),
  authLocalDevParticipant: () => api("/api/dev/login-participant", { method: "POST" }),
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
  updateFollowupAction: (followupId: string, input: { action: string; snoozeUntil?: string; nextReminderAt?: string }) =>
    api(`/api/followups/${followupId}/action`, { method: "POST", body: input }),
  deleteFollowup: (followupId: string) => api(`/api/followups/${followupId}`, { method: "DELETE" }),
  deleteContact: (contactId: string) => api(`/api/contacts/${contactId}`, { method: "DELETE" }),
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
