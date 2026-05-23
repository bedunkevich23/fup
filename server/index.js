import "./lib/env.js";
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { clearSessionCookie, readSessionCookie, sessionCookie } from "./lib/session.js";
import { validateTelegramMiniAppInitData } from "./lib/telegramAuth.js";
import {
  clearTelegramLoginStateCookie,
  createTelegramLoginStart,
  exchangeTelegramCodeForToken,
  readTelegramLoginState,
  telegramUserFromOidcClaims,
  validateTelegramOidcIdToken,
} from "./lib/telegramOidc.js";
import {
  answerTelegramCallbackQuery,
  sendLifecycleNotification,
  sendTelegramReminder,
  sendTelegramWelcome,
} from "./lib/telegramBot.js";
import {
  applyFollowupAction,
  archiveOrganizerEvent,
  archiveContact,
  cancelFollowup,
  createAppOpenedEvent,
  createAppSession,
  createContactWithFollowup,
  createAnalyticsEvent,
  createOrganizationForOwner,
  createOrganizerEvent,
  enqueueLifecycleNotifications,
  getCurrentUserFromSessionToken,
  getContacts,
  getCurrentUserDev,
  getDemoEvent,
  getEventHome,
  getEventMembers,
  getFollowups,
  getPendingBotNotifications,
  getPendingReminders,
  getMe,
  getOrgMe,
  getOrganizerDashboard,
  getOrganizerEvent,
  getOrganizerEventInvite,
  getOrganizerEvents,
  getOrganizerLive,
  getRecommendations,
  getPublicEventByInvite,
  getReport,
  getUserByTelegramId,
  grantOrganizerAccessDev,
  isProfileCompleted,
  joinEvent,
  markBotNotificationFailed,
  markBotNotificationSent,
  markReminderFailed,
  markReminderSent,
  requireOrganizerAccess,
  revokeSession,
  supabaseHealthCheck,
  updateProfile,
  updateOrganizerEvent,
  upsertTelegramLoginUser,
  upsertTelegramUser,
  upsertTelegramMiniAppUser,
} from "./lib/repository.js";

const port = Number(process.env.API_PORT || 8787);
const isDev = process.env.NODE_ENV !== "production";
const maxJsonBodyBytes = 1024 * 1024;

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.WEBAPP_URL || "http://localhost:3000",
  "Access-Control-Allow-Credentials": "true",
  "Vary": "Origin",
});

const securityHeaders = () => ({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
  ...(String(process.env.WEBAPP_URL || "").startsWith("https://")
    ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
    : {}),
});

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(),
    ...securityHeaders(),
    ...headers,
  });
  res.end(JSON.stringify(body));
};

const apiError = (message, status = 500) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const parseJsonBody = (raw) => {
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw apiError("Некорректный JSON в запросе", 400);
  }
};

const readJson = async (req) => {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      if (Buffer.byteLength(req.body, "utf8") > maxJsonBodyBytes) throw apiError("Слишком большой запрос", 413);
      return parseJsonBody(Buffer.from(req.body));
    }
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > maxJsonBodyBytes) throw apiError("Слишком большой запрос", 413);
      return parseJsonBody(req.body);
    }
    return req.body || {};
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxJsonBodyBytes) throw apiError("Слишком большой запрос", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return parseJsonBody(Buffer.concat(chunks));
};

const redirect = (res, location, headers = {}) => {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
};

const route = (method, pattern, handler) => ({ method, pattern, handler });
const matchRoute = (method, pathname, routes) => {
  for (const item of routes) {
    if (item.method !== method) continue;
    const match = pathname.match(item.pattern);
    if (match) return { handler: item.handler, params: match.groups || {} };
  }
  return null;
};

async function requireUser(req) {
  const token = readSessionCookie(req);
  const user = await getCurrentUserFromSessionToken(token);
  if (user) return user;
  const error = new Error("Unauthorized");
  error.status = 401;
  throw error;
}

function requireSharedSecret(req, envName, headerName) {
  const expected = process.env[envName];
  if (!expected) {
    const error = new Error(`${envName} is not configured`);
    error.status = 503;
    throw error;
  }
  const authorization = req.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const provided = String(req.headers[headerName] || bearer || "");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    const error = new Error("Forbidden");
    error.status = 403;
    throw error;
  }
}

const snoozeUntil = () => {
  const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
};

async function processReminderCron(req, res) {
  requireSharedSecret(req, "CRON_SECRET", "x-cron-secret");
  await enqueueLifecycleNotifications().catch((error) => {
    console.warn("Lifecycle notification enqueue skipped:", error.message);
  });
  const pending = await getPendingReminders();
  const pendingBotNotifications = await getPendingBotNotifications().catch((error) => {
    console.warn("Lifecycle notifications fetch skipped:", error.message);
    return [];
  });
  const result = {
    ok: true,
    processed: pending.length + pendingBotNotifications.length,
    reminders: { processed: pending.length, sent: 0, failed: 0 },
    lifecycle: { processed: pendingBotNotifications.length, sent: 0, failed: 0 },
  };

  for (const reminder of pending) {
    const followup = reminder.followups || {};
    const contact = followup.contacts || {};
    const user = reminder.users || {};
    try {
      const telegramId = user.telegram_chat_id || user.telegram_id;
      if (!telegramId) throw new Error("Telegram chat is not available");
      const message = await sendTelegramReminder({
        telegramId,
        followupId: followup.id,
        contactName: contact.contact_name || "контакту",
        context: contact.context || "контекст не указан",
        nextStep: followup.next_step_text || contact.next_step_text || "Написать",
      });
      await markReminderSent({
        reminderId: reminder.id,
        followupId: followup.id,
        telegramMessageId: message.message_id,
      });
      result.reminders.sent += 1;
    } catch (error) {
      await markReminderFailed({
        reminderId: reminder.id,
        followupId: followup.id,
        errorMessage: error.message,
      });
      result.reminders.failed += 1;
    }
  }

  for (const notification of pendingBotNotifications) {
    const user = notification.users || {};
    const event = notification.events || {};
    try {
      const telegramId = notification.telegram_chat_id || user.telegram_chat_id || user.telegram_id;
      if (!telegramId) throw new Error("Telegram chat is not available");
      const message = await sendLifecycleNotification({
        telegramId,
        type: notification.notification_type,
        cadenceKey: notification.cadence_key,
        user,
        event,
        metadata: notification.metadata || {},
      });
      await markBotNotificationSent({
        notificationId: notification.id,
        telegramMessageId: message.message_id,
      });
      result.lifecycle.sent += 1;
    } catch (error) {
      await markBotNotificationFailed({
        notificationId: notification.id,
        errorMessage: error.message,
      });
      result.lifecycle.failed += 1;
    }
  }

  return json(res, 200, result);
}

const routes = [
  route("GET", /^\/api\/auth\/telegram-login\/start$/, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { authUrl, stateCookie } = createTelegramLoginStart(url.searchParams.get("returnTo"));
    return redirect(res, authUrl, { "Set-Cookie": stateCookie });
  }),

  route("GET", /^\/api\/auth\/telegram-login\/callback$/, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const state = readTelegramLoginState(req);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const returnTo = state?.returnTo || "/organizer";
    try {
      if (!state || !returnedState || returnedState !== state.state) throw new Error("Telegram login state is invalid");
      if (!code) throw new Error(url.searchParams.get("error_description") || url.searchParams.get("error") || "Telegram login code is missing");
      const token = await exchangeTelegramCodeForToken({ code, codeVerifier: state.codeVerifier });
      const claims = await validateTelegramOidcIdToken(token.id_token, state.nonce);
      const user = await upsertTelegramLoginUser(telegramUserFromOidcClaims(claims));
      const { rawToken } = await createAppSession({ userId: user.id, authMethod: "telegram_login_widget" });
      return redirect(res, returnTo, {
        "Set-Cookie": [sessionCookie(rawToken), clearTelegramLoginStateCookie()],
      });
    } catch (error) {
      const message = encodeURIComponent(error.message || "Telegram login failed");
      return redirect(res, `/organizer?auth_error=${message}`, { "Set-Cookie": clearTelegramLoginStateCookie() });
    }
  }),

  route("POST", /^\/api\/auth\/telegram-miniapp$/, async (req, res) => {
    const body = await readJson(req);
    if (!body.initData) return json(res, 401, { error: "Откройте FUP через Telegram Mini App" });
    try {
      const telegramUser = validateTelegramMiniAppInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN);
      const user = await upsertTelegramMiniAppUser(telegramUser);
      const startParam = new URLSearchParams(body.initData).get("start_param");
      const inviteCode = body.inviteCode || startParam;
      const eventSlug = body.eventSlug;
      let join = { event: null, memberStatus: null };
      if (inviteCode || eventSlug) {
        join = await joinEvent({ userId: user.id, inviteCode, eventSlug });
      }
      const { rawToken } = await createAppSession({ userId: user.id, authMethod: "telegram_miniapp" });
      await createAppOpenedEvent({ userId: user.id, eventId: join.event?.id });
      const me = await getMe(user.id);
      return json(
        res,
        200,
        {
          ok: true,
          user,
          activeEvent: join.event,
          profileCompleted: isProfileCompleted(user),
          memberStatus: join.memberStatus,
          isOrganizer: me.isOrganizer,
          organizerAccess: me.organizerAccess,
        },
        { "Set-Cookie": sessionCookie(rawToken) },
      );
    } catch (error) {
      return json(res, 401, { error: error.message || "Telegram авторизация не прошла" });
    }
  }),

  route("POST", /^\/api\/auth\/logout$/, async (req, res) => {
    await revokeSession(readSessionCookie(req));
    return json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
  }),

  route("GET", /^\/api\/me$/, async (req, res) => {
    const user = await requireUser(req);
    return json(res, 200, await getMe(user.id));
  }),

  route("POST", /^\/api\/profile$/, async (req, res) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    return json(res, 200, { user: await updateProfile(user.id, body) });
  }),

  route("POST", /^\/api\/events\/join$/, async (req, res) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    return json(res, 200, await joinEvent({ userId: user.id, inviteCode: body.inviteCode }));
  }),

  route("GET", /^\/api\/events\/(?<eventId>[^/]+)\/home$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    return json(res, 200, await getEventHome({ eventId, userId: user.id }));
  }),

  route("GET", /^\/api\/events\/(?<eventId>[^/]+)\/members$/, async (req, res, { eventId }) => {
    await requireUser(req);
    return json(res, 200, { members: await getEventMembers(eventId) });
  }),

  route("GET", /^\/api\/events\/(?<eventId>[^/]+)\/recommendations$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    const recommendations = await getRecommendations({ eventId, userId: user.id });
    return json(res, 200, { recommendations });
  }),

  route("POST", /^\/api\/events\/(?<eventId>[^/]+)\/contacts$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    const input = await readJson(req);
    return json(res, 201, await createContactWithFollowup({ eventId, userId: user.id, input }));
  }),

  route("GET", /^\/api\/events\/(?<eventId>[^/]+)\/contacts$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    return json(res, 200, { contacts: await getContacts({ eventId, userId: user.id }) });
  }),

  route("GET", /^\/api\/events\/(?<eventId>[^/]+)\/followups$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    return json(res, 200, await getFollowups({ eventId, userId: user.id }));
  }),

  route("POST", /^\/api\/followups\/(?<followupId>[^/]+)\/action$/, async (req, res, { followupId }) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    return json(
      res,
      200,
      await applyFollowupAction({
        followupId,
        userId: user.id,
        action: body.action,
        snoozeUntil: body.snoozeUntil,
        nextReminderAt: body.nextReminderAt,
      }),
    );
  }),

  route("DELETE", /^\/api\/contacts\/(?<contactId>[^/]+)$/, async (req, res, { contactId }) => {
    const user = await requireUser(req);
    return json(res, 200, { contact: await archiveContact({ contactId, userId: user.id }) });
  }),

  route("DELETE", /^\/api\/followups\/(?<followupId>[^/]+)$/, async (req, res, { followupId }) => {
    const user = await requireUser(req);
    return json(res, 200, { followup: await cancelFollowup({ followupId, userId: user.id }) });
  }),

  route("GET", /^\/api\/cron\/reminders$/, processReminderCron),
  route("POST", /^\/api\/cron\/reminders$/, processReminderCron),

  route("POST", /^\/api\/telegram\/webhook$/, async (req, res) => {
    requireSharedSecret(req, "TELEGRAM_WEBHOOK_SECRET", "x-telegram-bot-api-secret-token");
    const body = await readJson(req);
    const message = body.message;
    const text = String(message?.text || "");
    if (message?.from?.id && text.startsWith("/start")) {
      const user = await upsertTelegramUser({
        telegram_id: message.from.id,
        username: message.from.username,
        first_name: message.from.first_name,
        last_name: message.from.last_name,
      });
      await createAnalyticsEvent({ event_id: null, user_id: user.id, action: "bot_started", entity_id: user.id }).catch(() => undefined);
      const sent = await sendTelegramWelcome({
        telegramId: message.chat?.id || message.from.id,
        firstName: message.from.first_name,
      });
      return json(res, 200, { ok: true, messageId: sent.message_id });
    }

    const callback = body.callback_query;
    if (!callback?.data?.startsWith("fup:")) return json(res, 200, { ok: true });

    const [, followupId, callbackAction] = callback.data.split(":");
    const action = {
      sent: "message_sent",
      meeting: "meeting_booked",
      intro: "person_introduced",
      snooze: "snoozed",
    }[callbackAction];
    if (!followupId || !action) {
      await answerTelegramCallbackQuery({ callbackQueryId: callback.id, text: "Не удалось распознать действие" });
      return json(res, 200, { ok: false });
    }

    const user = await getUserByTelegramId(callback.from?.id);
    if (!user) {
      await answerTelegramCallbackQuery({ callbackQueryId: callback.id, text: "Откройте FUP еще раз, чтобы обновить сессию" });
      return json(res, 200, { ok: false });
    }

    await applyFollowupAction({
      followupId,
      userId: user.id,
      action,
      snoozeUntil: action === "snoozed" ? snoozeUntil() : undefined,
    });
    await answerTelegramCallbackQuery({
      callbackQueryId: callback.id,
      text: action === "snoozed" ? "Напоминание отложено" : "Готово, FUP обновил статус",
    });
    return json(res, 200, { ok: true });
  }),

  route("GET", /^\/api\/org\/events$/, async (req, res) => {
    const user = await requireUser(req);
    return json(res, 200, { events: await getOrganizerEvents(user.id) });
  }),

  route("GET", /^\/api\/org\/me$/, async (req, res) => {
    const user = await requireUser(req);
    return json(res, 200, await getOrgMe(user.id));
  }),

  route("POST", /^\/api\/org\/organizations$/, async (req, res) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    return json(res, 201, await createOrganizationForOwner({ userId: user.id, input: body }));
  }),

  route("POST", /^\/api\/org\/events$/, async (req, res) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    return json(res, 201, await createOrganizerEvent({ userId: user.id, input: body }));
  }),

  route("GET", /^\/api\/org\/events\/(?<eventId>[^/]+)$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    return json(res, 200, await getOrganizerEvent(user.id, eventId));
  }),

  route("PATCH", /^\/api\/org\/events\/(?<eventId>[^/]+)$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    return json(res, 200, { event: await updateOrganizerEvent(user.id, eventId, body) });
  }),

  route("DELETE", /^\/api\/org\/events\/(?<eventId>[^/]+)$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    return json(res, 200, { event: await archiveOrganizerEvent(user.id, eventId) });
  }),

  route("GET", /^\/api\/org\/events\/(?<eventId>[^/]+)\/invite$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    return json(res, 200, await getOrganizerEventInvite(user.id, eventId));
  }),

  route("GET", /^\/api\/org\/events\/(?<eventId>[^/]+)\/live$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    return json(res, 200, await getOrganizerLive(user.id, eventId));
  }),

  route("GET", /^\/api\/org\/events\/(?<eventId>[^/]+)\/dashboard$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    await requireOrganizerAccess(user.id, { eventId });
    return json(res, 200, await getOrganizerDashboard(eventId));
  }),

  route("GET", /^\/api\/org\/events\/(?<eventId>[^/]+)\/report$/, async (req, res, { eventId }) => {
    const user = await requireUser(req);
    await requireOrganizerAccess(user.id, { eventId });
    return json(res, 200, await getReport(eventId));
  }),

  route("GET", /^\/api\/events\/public\/by-invite\/(?<inviteCode>[^/]+)$/, async (_req, res, { inviteCode }) => {
    const event = await getPublicEventByInvite(decodeURIComponent(inviteCode));
    if (!event) return json(res, 404, { error: "Мероприятие не найдено" });
    return json(res, 200, event);
  }),

  route("GET", /^\/api\/health$/, async (_req, res) =>
    json(res, 200, { ok: true, app: "FUP", env: process.env.NODE_ENV || "development" }),
  ),

  route("GET", /^\/api\/supabase\/health$/, async (_req, res) => {
    try {
      const demo = await supabaseHealthCheck();
      return json(res, 200, { ok: true, supabase: "connected", demoEventFound: Boolean(demo) });
    } catch (error) {
      return json(res, 500, { ok: false, supabase: "error", message: error.message });
    }
  }),

  route("GET", /^\/api\/dev\/demo-event$/, async (_req, res) => {
    if (!isDev) return json(res, 404, { error: "Not found" });
    return json(res, 200, await getDemoEvent());
  }),

  route("POST", /^\/api\/dev\/login-participant$/, async (_req, res) => {
    if (!isDev) return json(res, 404, { error: "Not found" });
    const user = await getCurrentUserDev();
    const join = await joinEvent({ userId: user.id, inviteCode: "demo2026" });
    const { rawToken } = await createAppSession({ userId: user.id, authMethod: "dev_local" });
    await createAppOpenedEvent({ userId: user.id, eventId: join.event?.id });
    return json(
      res,
      200,
      {
        ok: true,
        activeEvent: join.event,
        me: await getMe(user.id),
      },
      { "Set-Cookie": sessionCookie(rawToken) },
    );
  }),

  route("GET", /^\/api\/dev\/dashboard$/, async (_req, res) => {
    if (!isDev) return json(res, 404, { error: "Not found" });
    const demo = await getDemoEvent();
    if (!demo?.event) return json(res, 404, { error: "Demo event not found" });
    return json(res, 200, await getOrganizerDashboard(demo.event.id));
  }),

  route("POST", /^\/api\/dev\/grant-organizer-access$/, async (req, res) => {
    if (!isDev) return json(res, 404, { error: "Not found" });
    const body = await readJson(req);
    return json(res, 200, await grantOrganizerAccessDev(body));
  }),
];

export const handleApiRequest = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...corsHeaders(),
        ...securityHeaders(),
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Cron-Secret, X-Telegram-Bot-Api-Secret-Token",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      });
      return res.end();
    }
    const matched = matchRoute(req.method, url.pathname, routes);
    if (!matched) return json(res, 404, { error: "Not found" });
    return await matched.handler(req, res, matched.params);
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    const message = status >= 500 && !isDev ? "Internal Server Error" : error.message || "Internal Server Error";
    return json(res, status, { error: message });
  }
};

const server = http.createServer(handleApiRequest);

if (!process.env.VERCEL) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`FUP API server listening on http://localhost:${port}`);
  });
}
