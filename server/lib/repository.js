import { dev, id, timestamp } from "./devStore.js";
import { buildRecommendations } from "./recommendations.js";
import { hasSupabaseEnv, supabaseAdmin } from "./supabaseAdmin.js";
import { createRawSessionToken, hashSessionToken } from "./session.js";

const from = (table) => supabaseAdmin.from(table);
const profileText = (value) => String(value || "").trim();
const hasRequiredProfileFields = (profile) =>
  Boolean(
    profileText(profile?.first_name) &&
      profileText(profile?.role) &&
      profileText(profile?.company) &&
      profileText(profile?.looking_for) &&
      profileText(profile?.can_help_with),
  );
const profileCompleted = (user) => Boolean(user?.profile_completed_at || hasRequiredProfileFields(user));
const nameFromTelegram = (tg = {}) =>
  [tg.first_name || tg.telegram_first_name, tg.last_name || tg.telegram_last_name].filter(Boolean).join(" ") ||
  tg.telegram_username ||
  tg.username ||
  `tg_${tg.telegram_id || ""}`;
const actionOf = (event) => event?.action || event?.type;
const dueAtOf = (followup) => followup?.due_at || followup?.remind_at;
const roleMap = {
  Основатель: "founder",
  Студент: "student",
  Ментор: "mentor",
  Инвестор: "investor",
  Эксперт: "expert",
  Организатор: "organizer",
};
const nextStepMap = {
  Написать: "write_message",
  "Отправить материалы": "send_materials",
  "Назначить звонок": "book_meeting",
  "Сделать intro": "introduce_person",
  "Вернуться позже": "return_later",
  "Свой вариант": "custom",
  message: "write_message",
  sent_message: "write_message",
  meeting_booked: "book_meeting",
  intro_made: "introduce_person",
  person_introduced: "introduce_person",
};
const allowedNextStepTypes = new Set([
  "write_message",
  "send_materials",
  "book_meeting",
  "introduce_person",
  "return_later",
  "custom",
]);
const toDbRole = (role) => roleMap[role] || role || "other";
const toDbNextStepType = (value) => {
  const normalized = nextStepMap[value] || value || "write_message";
  return allowedNextStepTypes.has(normalized) ? normalized : "custom";
};
const tagsFrom = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
const sameText = (left, right) => profileText(left).toLowerCase() === profileText(right).toLowerCase();
const recentTimestamp = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
const INVITE_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const inviteCodeFrom = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const eventSettings = (event = {}) => event.settings && typeof event.settings === "object" && !Array.isArray(event.settings) ? event.settings : {};
const TELEGRAM_BOT_USERNAME = "fupfupfup_bot";
const inviteExpiresAt = (fromTime = Date.now()) => new Date(fromTime + INVITE_CODE_TTL_MS).toISOString();
const inviteExpiresAtOf = (event = {}) => {
  const configured = eventSettings(event).invite_code_expires_at;
  const createdAt = Date.parse(event.created_at || "");
  return configured || inviteExpiresAt(Number.isNaN(createdAt) ? Date.now() : createdAt);
};
const inviteExpired = (event = {}) => Date.parse(inviteExpiresAtOf(event)) <= Date.now();
const organizationTypes = new Set([
  "accelerator",
  "founder_community",
  "business_club",
  "university_program",
  "event_agency",
  "company",
  "other",
]);
const toDbOrganizationType = (value) => (organizationTypes.has(value) ? value : "other");
const slugFrom = (value, fallback = "org") => {
  const base = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-|-$/g, "");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || fallback}-${suffix}`;
};
const verifyOrganizerAccessCode = (value) => {
  const expected = process.env.ORGANIZER_ACCESS_CODE;
  if (!expected) {
    const error = new Error("Ключ доступа организатора не настроен");
    error.status = 503;
    throw error;
  }
  if (!value || String(value).trim() !== expected) {
    const error = new Error("Неверный ключ доступа");
    error.status = 403;
    throw error;
  }
};

function devEventByInvite({ inviteCode, eventSlug }) {
  return dev.events.find((event) => event.invite_code === inviteCode || event.slug === eventSlug);
}

export const isProfileCompleted = profileCompleted;

export async function getCurrentUserDev() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Dev auth is disabled in production");
  }

  if (hasSupabaseEnv) {
    const payload = {
      telegram_id: "100001",
      telegram_username: "demo_fup_user",
      first_name: "Демо",
      last_name: "Участник",
      role: "founder",
      looking_for: "Партнерства, пилотные клиенты, B2B продажи",
      can_help_with: "MVP, продукт, запуск пилотов",
      looking_for_tags: ["партнерства", "пилоты", "b2b"],
      can_help_with_tags: ["mvp", "продукт", "пилоты"],
      company: "FUP Demo",
      field: "SaaS",
      is_visible: true,
      updated_at: timestamp(),
    };
    const { data, error } = await from("users")
      .upsert(payload, { onConflict: "telegram_id" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  return dev.users.find((user) => user.telegram_id === "100001");
}

export async function upsertTelegramMiniAppUser(tg) {
  const now = timestamp();
  if (hasSupabaseEnv) {
    const payload = {
      telegram_id: String(tg.telegram_id),
      telegram_username: tg.username,
      telegram_chat_id: String(tg.telegram_id),
      telegram_first_name: tg.first_name,
      telegram_last_name: tg.last_name,
      telegram_photo_url: tg.photo_url,
      avatar_url: tg.photo_url,
      last_auth_method: "telegram_miniapp",
      last_login_at: now,
      last_seen_at: now,
      updated_at: now,
    };
    const { data: existing, error: existingError } = await from("users")
      .select("id, first_name, last_name, miniapp_first_seen_at")
      .eq("telegram_id", String(tg.telegram_id))
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing?.miniapp_first_seen_at) payload.miniapp_first_seen_at = now;
    if (!existing?.first_name) payload.first_name = tg.first_name;
    if (!existing?.last_name) payload.last_name = tg.last_name;
    const { data, error } = await from("users")
      .upsert(payload, { onConflict: "telegram_id" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  let user = dev.users.find((item) => item.telegram_id === String(tg.telegram_id));
  if (!user) {
    user = { id: id("usr"), telegram_id: String(tg.telegram_id), created_at: now, is_visible: false };
    dev.users.push(user);
  }
  Object.assign(user, {
    telegram_username: tg.username,
    telegram_chat_id: String(tg.telegram_id),
    telegram_first_name: tg.first_name,
    telegram_last_name: tg.last_name,
    telegram_photo_url: tg.photo_url,
    first_name: user.first_name || tg.first_name,
    last_name: user.last_name || tg.last_name,
    avatar_url: tg.photo_url,
    miniapp_first_seen_at: user.miniapp_first_seen_at || now,
    last_auth_method: "telegram_miniapp",
    last_login_at: now,
    last_seen_at: now,
    updated_at: now,
  });
  return user;
}

export async function upsertTelegramLoginUser(tg) {
  const now = timestamp();
  if (hasSupabaseEnv) {
    const payload = {
      telegram_id: String(tg.telegram_id),
      telegram_username: tg.username,
      telegram_chat_id: String(tg.telegram_id),
      telegram_first_name: tg.first_name,
      telegram_last_name: tg.last_name,
      telegram_photo_url: tg.photo_url,
      avatar_url: tg.photo_url,
      last_auth_method: "telegram_login_widget",
      last_login_at: now,
      last_seen_at: now,
      updated_at: now,
    };
    const { data: existing, error: existingError } = await from("users")
      .select("id, first_name, last_name, web_first_seen_at")
      .eq("telegram_id", String(tg.telegram_id))
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing?.web_first_seen_at) payload.web_first_seen_at = now;
    if (!existing?.first_name) payload.first_name = tg.first_name;
    if (!existing?.last_name) payload.last_name = tg.last_name;
    const { data, error } = await from("users")
      .upsert(payload, { onConflict: "telegram_id" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  let user = dev.users.find((item) => item.telegram_id === String(tg.telegram_id));
  if (!user) {
    user = { id: id("usr"), telegram_id: String(tg.telegram_id), created_at: now, is_visible: false };
    dev.users.push(user);
  }
  Object.assign(user, {
    telegram_username: tg.username,
    telegram_chat_id: String(tg.telegram_id),
    telegram_first_name: tg.first_name,
    telegram_last_name: tg.last_name,
    telegram_photo_url: tg.photo_url,
    first_name: user.first_name || tg.first_name,
    last_name: user.last_name || tg.last_name,
    avatar_url: tg.photo_url,
    web_first_seen_at: user.web_first_seen_at || now,
    last_auth_method: "telegram_login_widget",
    last_login_at: now,
    last_seen_at: now,
    updated_at: now,
  });
  return user;
}

export async function createAppSession({ userId, authMethod = "telegram_miniapp" }) {
  const rawToken = createRawSessionToken();
  const session_token_hash = hashSessionToken(rawToken);
  const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    id: id("ses"),
    user_id: userId,
    session_token_hash,
    auth_method: authMethod,
    expires_at,
    created_at: timestamp(),
  };

  if (hasSupabaseEnv) {
    const { id: _id, ...dbPayload } = payload;
    const { error } = await from("app_sessions").insert(dbPayload);
    if (error) throw error;
  } else {
    dev.app_sessions ||= [];
    dev.app_sessions.push(payload);
  }
  return { rawToken, session: payload };
}

export async function getCurrentUserFromSessionToken(rawToken) {
  if (!rawToken) return null;
  const session_token_hash = hashSessionToken(rawToken);
  const now = timestamp();

  if (hasSupabaseEnv) {
    const { data: session, error } = await from("app_sessions")
      .select("*")
      .eq("session_token_hash", session_token_hash)
      .gt("expires_at", now)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!session) return null;
    const { data: user, error: userError } = await from("users").select("*").eq("id", session.user_id).single();
    if (userError) throw userError;
    await from("users").update({ last_seen_at: now }).eq("id", session.user_id);
    return user;
  }

  const session = (dev.app_sessions || []).find(
    (item) => item.session_token_hash === session_token_hash && item.expires_at > now && !item.revoked_at,
  );
  if (!session) return null;
  const user = dev.users.find((item) => item.id === session.user_id);
  if (user) user.last_seen_at = now;
  return user || null;
}

export async function revokeSession(rawToken) {
  if (!rawToken) return;
  const session_token_hash = hashSessionToken(rawToken);
  if (hasSupabaseEnv) {
    await from("app_sessions")
      .update({ revoked_at: timestamp() })
      .eq("session_token_hash", session_token_hash)
      .is("revoked_at", null);
    return;
  }
  const session = (dev.app_sessions || []).find((item) => item.session_token_hash === session_token_hash);
  if (session) session.revoked_at = timestamp();
}

export async function createAppOpenedEvent({ userId, eventId }) {
  return createAnalyticsEvent({ event_id: eventId, user_id: userId, action: "app_opened", entity_id: userId });
}

export async function getOrganizerAccess(userId) {
  if (hasSupabaseEnv) {
    const { data, error } = await from("organization_members")
      .select("*")
      .eq("user_id", userId);
    if (error) throw error;
    const memberships = data || [];
    const organizationIds = memberships.map((member) => member.organization_id).filter(Boolean);
    const organizations = organizationIds.length
      ? (await from("organizations").select("*").in("id", organizationIds)).data || []
      : [];
    const events = organizationIds.length
      ? (await from("events").select("*").in("organization_id", organizationIds)).data || []
      : [];
    return memberships.map((member) => ({
      ...member,
      organizations: organizations.find((org) => org.id === member.organization_id),
      events: events.filter((event) => event.organization_id === member.organization_id),
    }));
  }
  return (dev.organization_members || [])
    .filter((member) => member.user_id === userId)
    .map((member) => ({
      ...member,
      organizations: dev.organizations.find((org) => org.id === member.organization_id),
      events: dev.events.filter((event) => event.organization_id === member.organization_id),
    }));
}

export async function requireOrganizerAccess(userId, { organizationId, eventId, allowedRoles = ["owner", "admin", "manager", "viewer"] } = {}) {
  let resolvedOrganizationId = organizationId;
  let event = null;
  if (eventId) {
    event = await findEvent({ eventId });
    resolvedOrganizationId = event?.organization_id;
  }
  if (!resolvedOrganizationId) {
    const access = await getOrganizerAccess(userId);
    const member = access.find((item) => allowedRoles.includes(item.role));
    if (member) return { organizationMember: member, event };
  }

  if (hasSupabaseEnv) {
    const { data, error } = await from("organization_members")
      .select("*")
      .eq("organization_id", resolvedOrganizationId)
      .eq("user_id", userId)
      .in("role", allowedRoles)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const denied = new Error("Нет доступа к кабинету организатора");
      denied.status = 403;
      throw denied;
    }
    return { organizationMember: data, event };
  }

  const member = (dev.organization_members || []).find(
    (item) => item.organization_id === resolvedOrganizationId && item.user_id === userId && allowedRoles.includes(item.role),
  );
  if (!member) {
    const denied = new Error("Нет доступа к кабинету организатора");
    denied.status = 403;
    throw denied;
  }
  return { organizationMember: member, event };
}

export async function grantOrganizerAccessDev({ telegramId, telegramUsername, organizationSlug = "demo-startup-community", role = "owner" }) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Dev endpoint is disabled in production");
  }
  const lookupId = telegramId ? String(telegramId) : undefined;
  let user;
  if (hasSupabaseEnv) {
    let query = from("users").select("*").limit(1);
    if (lookupId) query = query.eq("telegram_id", lookupId);
    else query = query.eq("telegram_username", telegramUsername);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    user = data;
    if (!user) throw new Error("Пользователь не найден. Сначала откройте Mini App через Telegram.");

    let { data: organization, error: orgError } = await from("organizations")
      .select("*")
      .eq("slug", organizationSlug)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!organization) {
      const inserted = await from("organizations")
        .insert({ name: "Demo Startup Community", slug: organizationSlug, created_at: timestamp() })
        .select("*")
        .single();
      if (inserted.error) throw inserted.error;
      organization = inserted.data;
    }
    const { data: membership, error: memberError } = await from("organization_members")
      .upsert(
        { organization_id: organization.id, user_id: user.id, role },
        { onConflict: "organization_id,user_id" },
      )
      .select("*")
      .single();
    if (memberError) throw memberError;
    return { ok: true, user, organization, role: membership.role };
  }

  user = dev.users.find(
    (item) => (lookupId && item.telegram_id === lookupId) || item.username === telegramUsername || item.telegram_username === telegramUsername,
  );
  if (!user) throw new Error("Пользователь не найден. Сначала откройте Mini App через Telegram.");
  let organization = dev.organizations.find((org) => org.slug === organizationSlug);
  if (!organization) {
    organization = { id: id("org"), name: "Demo Startup Community", slug: organizationSlug, created_at: timestamp() };
    dev.organizations.push(organization);
  }
  let membership = dev.organization_members.find(
    (item) => item.organization_id === organization.id && item.user_id === user.id,
  );
  if (!membership) {
    membership = { id: id("om"), organization_id: organization.id, user_id: user.id, role, created_at: timestamp() };
    dev.organization_members.push(membership);
  }
  membership.role = role;
  return { ok: true, user, organization, role };
}

export async function createOrganizationForOwner({ userId, input }) {
  verifyOrganizerAccessCode(input.accessCode || input.access_code);
  const name = String(input.name || "").trim();
  if (!name) {
    const error = new Error("Укажите название организации");
    error.status = 400;
    throw error;
  }

  const organization = {
    id: id("org"),
    name,
    slug: input.slug || slugFrom(name),
    type: toDbOrganizationType(input.type),
    description: input.description || null,
    created_by_user_id: userId,
    metadata: input.metadata || {},
    created_at: timestamp(),
    updated_at: timestamp(),
  };

  if (hasSupabaseEnv) {
    const { id: _id, ...organizationPayload } = organization;
    const { data: organizationData, error: organizationError } = await from("organizations")
      .insert(organizationPayload)
      .select("*")
      .single();
    if (organizationError) throw organizationError;

    const { data: membership, error: membershipError } = await from("organization_members")
      .upsert(
        {
          organization_id: organizationData.id,
          user_id: userId,
          role: "owner",
          created_at: timestamp(),
        },
        { onConflict: "organization_id,user_id" },
      )
      .select("*")
      .single();
    if (membershipError) throw membershipError;
    return { ok: true, organization: organizationData, membership };
  }

  dev.organizations.push(organization);
  const membership = {
    id: id("om"),
    organization_id: organization.id,
    user_id: userId,
    role: "owner",
    created_at: timestamp(),
  };
  dev.organization_members.push(membership);
  return { ok: true, organization, membership };
}

export async function getDemoEvent() {
  const event = await findEvent({ inviteCode: "demo2026", eventSlug: "demo-fup-event" });
  if (!event) return null;
  if (hasSupabaseEnv) {
    const [{ data: goals }, { count }] = await Promise.all([
      from("event_goals").select("*").eq("event_id", event.id),
      from("event_members").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    ]);
    return { event, goals: goals || [], participantsCount: count || 0 };
  }
  return {
    event,
    goals: event.goals || [],
    participantsCount: dev.event_members.filter((member) => member.event_id === event.id).length,
  };
}

export async function supabaseHealthCheck() {
  if (!hasSupabaseEnv) {
    throw new Error("Supabase env is not configured");
  }
  const { data, error } = await from("events")
    .select("id, name, slug, invite_code")
    .or("slug.eq.demo-fup-event,invite_code.eq.demo2026")
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function upsertTelegramUser(tg) {
  if (hasSupabaseEnv) {
    const existing = await from("users")
      .select("id, bot_started_at")
      .eq("telegram_id", String(tg.telegram_id))
      .maybeSingle();
    if (existing.error) throw existing.error;
    const payload = {
      telegram_id: String(tg.telegram_id),
      telegram_username: tg.username,
      telegram_chat_id: String(tg.telegram_id),
      first_name: tg.first_name,
      last_name: tg.last_name,
      avatar_url: tg.photo_url,
      bot_started_at: existing.data?.bot_started_at || timestamp(),
      bot_last_seen_at: timestamp(),
      updated_at: timestamp(),
    };
    const { data, error } = await from("users")
      .upsert(payload, { onConflict: "telegram_id" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  let user = dev.users.find((item) => item.telegram_id === String(tg.telegram_id));
  if (!user) {
    user = {
      id: id("usr"),
      telegram_id: String(tg.telegram_id),
      telegram_username: tg.username,
      first_name: tg.first_name,
      last_name: tg.last_name,
      is_visible: false,
      created_at: timestamp(),
    };
    dev.users.push(user);
  }
  Object.assign(user, {
    telegram_username: tg.username,
    telegram_chat_id: String(tg.telegram_id),
    first_name: tg.first_name,
    last_name: tg.last_name,
    avatar_url: tg.photo_url,
    bot_started_at: user.bot_started_at || timestamp(),
    bot_last_seen_at: timestamp(),
    updated_at: timestamp(),
  });
  return user;
}

export async function getUserById(userId) {
  if (hasSupabaseEnv) {
    const { data, error } = await from("users").select("*").eq("id", userId).single();
    if (error) throw error;
    return data;
  }
  return dev.users.find((user) => user.id === userId);
}

export async function getUserByTelegramId(telegramId) {
  const value = String(telegramId);
  if (hasSupabaseEnv) {
    const { data, error } = await from("users").select("*").eq("telegram_id", value).maybeSingle();
    if (error) throw error;
    return data;
  }
  return dev.users.find((user) => String(user.telegram_id) === value) || null;
}

export async function findEvent({ inviteCode, eventSlug, eventId }) {
  if (hasSupabaseEnv) {
    let query = from("events").select("*").limit(1);
    if (eventId) query = query.eq("id", eventId);
    else if (inviteCode) query = query.eq("invite_code", inviteCode);
    else if (eventSlug) query = query.eq("slug", eventSlug);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }
  return eventId ? dev.events.find((event) => event.id === eventId) : devEventByInvite({ inviteCode, eventSlug });
}

export async function joinEvent({ userId, inviteCode, eventSlug, eventId }) {
  const event = await findEvent({ inviteCode, eventSlug, eventId });
  if (!event) return { event: null, memberStatus: "event_not_found" };
  if (inviteCode && inviteExpired(event)) return { event: null, memberStatus: "invite_expired" };

  if (hasSupabaseEnv) {
    const { data: existing } = await from("event_members")
      .select("id")
      .eq("event_id", event.id)
      .eq("user_id", userId)
      .maybeSingle();
    const { data, error } = await from("event_members")
      .upsert(
        { event_id: event.id, user_id: userId, status: "joined", joined_at: existing ? undefined : timestamp(), last_activity_at: timestamp() },
        { onConflict: "event_id,user_id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    if (!existing) {
      await createAnalyticsEvent({ event_id: event.id, user_id: userId, action: "event_joined", entity_id: event.id });
    }
    return { event, memberStatus: data.status || "active" };
  }

  let member = dev.event_members.find((item) => item.event_id === event.id && item.user_id === userId);
  if (!member) {
    member = { id: id("em"), event_id: event.id, user_id: userId, status: "joined", joined_at: timestamp() };
    dev.event_members.push(member);
    dev.analytics_events.push({ id: id("evt"), event_id: event.id, user_id: userId, type: "event_joined", action: "event_joined", entity_id: event.id, created_at: timestamp() });
  }
  member.last_activity_at = timestamp();
  return { event, memberStatus: member.status };
}

export async function getMe(userId) {
  const user = await getUserById(userId);
  const organizerAccess = await getOrganizerAccess(userId);
  if (hasSupabaseEnv) {
    const { data, error } = await from("event_members")
      .select("*, events(*)")
      .eq("user_id", userId)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .order("joined_at", { ascending: false });
    if (error) throw error;
    return {
      user,
      profileCompleted: profileCompleted(user),
      activeEvents: data.map((item) => item.events),
      isOrganizer: organizerAccess.length > 0,
      organizerAccess,
    };
  }
  const activeEvents = dev.event_members
    .filter((member) => member.user_id === userId)
    .sort((left, right) => (right.last_activity_at || right.joined_at || "").localeCompare(left.last_activity_at || left.joined_at || ""))
    .map((member) => dev.events.find((event) => event.id === member.event_id));
  return { user, profileCompleted: profileCompleted(user), activeEvents, isOrganizer: organizerAccess.length > 0, organizerAccess };
}

export async function updateProfile(userId, input) {
  const normalized = {
    ...input,
    first_name: profileText(input.first_name),
    last_name: profileText(input.last_name),
    role: profileText(input.role),
    company: profileText(input.company),
    looking_for: profileText(input.looking_for),
    can_help_with: profileText(input.can_help_with),
  };
  if (!hasRequiredProfileFields(normalized)) {
    const error = new Error("Ошибка: необходимо заполнить все поля");
    error.status = 400;
    throw error;
  }
  const completedAt = timestamp();
  const payload = {
    first_name: normalized.first_name,
    last_name: normalized.last_name,
    role: toDbRole(normalized.role),
    looking_for: normalized.looking_for,
    can_help_with: normalized.can_help_with,
    company: normalized.company,
    education: normalized.education,
    field: normalized.field,
    city: normalized.city,
    is_visible: normalized.is_visible,
    looking_for_tags: normalized.tags || tagsFrom(normalized.looking_for),
    can_help_with_tags: normalized.tags || tagsFrom(normalized.can_help_with),
    profile_completed_at: completedAt,
    updated_at: timestamp(),
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  if (hasSupabaseEnv) {
    const { data, error } = await from("users").update(payload).eq("id", userId).select("*").single();
    if (error) throw error;
    const { data: memberships } = await from("event_members").select("event_id").eq("user_id", userId);
    if (memberships?.length) {
      const memberUpdates = {
        last_activity_at: timestamp(),
        is_visible: input.is_visible,
        profile_snapshot: {
          first_name: data.first_name,
          last_name: data.last_name,
          role: data.role,
          looking_for: data.looking_for,
          can_help_with: data.can_help_with,
          company: data.company,
          field: data.field,
          avatar_url: data.avatar_url,
        },
      };
      if (completedAt) memberUpdates.profile_completed_at = completedAt;
      await from("event_members")
        .update(memberUpdates)
        .in(
          "event_id",
          memberships.map((item) => item.event_id),
        )
        .eq("user_id", userId);
    }
    await createAnalyticsEvent({
      event_id: memberships?.[0]?.event_id,
      user_id: userId,
      action: completedAt ? "profile_completed" : "profile_updated",
      entity_id: userId,
    });
    return data;
  }
  const user = dev.users.find((item) => item.id === userId);
  Object.assign(user, payload);
  dev.event_members
    .filter((member) => member.user_id === userId)
    .forEach((member) => {
      if (completedAt) member.profile_completed_at = completedAt;
      dev.analytics_events.push({
        id: id("evt"),
        event_id: member.event_id,
        user_id: userId,
        type: completedAt ? "profile_completed" : "profile_updated",
        action: completedAt ? "profile_completed" : "profile_updated",
        entity_id: userId,
        created_at: timestamp(),
      });
    });
  return user;
}

export async function getEventMembers(eventId) {
  if (hasSupabaseEnv) {
    const { data, error } = await from("event_members").select("*, users(*)").eq("event_id", eventId);
    if (error) throw error;
    return data
      .filter((item) => item.status !== "blocked" && item.is_visible !== false && item.users?.is_visible)
      .map((item) => item.users);
  }
  return dev.event_members
    .filter((member) => member.event_id === eventId)
    .map((member) => dev.users.find((user) => user.id === member.user_id))
    .filter((user) => user?.is_visible);
}

export async function getRecommendations({ eventId, userId }) {
  const currentUser = await getUserById(userId);
  const members = await getEventMembers(eventId);
  const contacts = await getContacts({ eventId, userId });
  const recommendations = buildRecommendations({ currentUser, candidates: members, contacts });
  return recommendations.map((item) => ({
    user: item.user,
    score: item.score,
    reason: item.reason,
  }));
}

export async function createContactWithFollowup({ eventId, userId, input }) {
  const nextStepType = toDbNextStepType(input.nextStepType || input.next_step_type || input.next_step);
  const nextStepText = input.nextStepText || input.next_step_text || input.next_step || nextStepType;
  const remindAt = input.remindAt || input.remind_at || input.due_at;
  const contact = {
    id: id("cnt"),
    event_id: eventId,
    owner_user_id: userId,
    target_user_id: input.targetUserId,
    contact_name: input.contactName,
    contact_username: input.contactUsername,
    source: input.source || "manual",
    connection_type: input.source === "manual" ? "manual" : "internal",
    where_met: input.whereMet,
    context: input.context,
    next_step_type: nextStepType,
    next_step_text: nextStepText,
    created_at: timestamp(),
  };
  const followup = {
    id: id("fup"),
    event_id: eventId,
    contact_id: contact.id,
    owner_user_id: userId,
    status: "scheduled",
    next_step_type: nextStepType,
    next_step_text: nextStepText,
    due_at: remindAt,
    created_at: timestamp(),
  };
  const reminder = {
    id: id("rem"),
    event_id: eventId,
    user_id: userId,
    followup_id: followup.id,
    scheduled_at: remindAt,
    status: "pending",
    created_at: timestamp(),
  };

  if (hasSupabaseEnv) {
    if (contact.target_user_id) {
      const { data: existingContact, error: existingContactError } = await from("contacts")
        .select("id")
        .eq("event_id", eventId)
        .eq("owner_user_id", userId)
        .eq("target_user_id", contact.target_user_id)
        .eq("is_archived", false)
        .maybeSingle();
      if (existingContactError) throw existingContactError;
      if (existingContact) {
        const error = new Error("Это знакомство уже сохранено");
        error.status = 409;
        throw error;
      }
    }
    if (contact.source === "manual") {
      const { data: recentContacts, error: recentContactsError } = await from("contacts")
        .select("id, contact_name, contact_username, context, next_step_text, source, created_at")
        .eq("event_id", eventId)
        .eq("owner_user_id", userId)
        .eq("source", "manual")
        .gte("created_at", recentTimestamp(2))
        .order("created_at", { ascending: false })
        .limit(8);
      if (recentContactsError) throw recentContactsError;
      const duplicate = recentContacts?.find((item) =>
        sameText(item.contact_name, contact.contact_name) &&
        sameText(item.contact_username, contact.contact_username) &&
        sameText(item.context, contact.context) &&
        sameText(item.next_step_text, contact.next_step_text),
      );
      if (duplicate) {
        const error = new Error("Это знакомство уже сохранено");
        error.status = 409;
        throw error;
      }
    }
    const { id: _contactId, ...contactPayload } = contact;
    const { data: contactData, error: contactError } = await from("contacts").insert(contactPayload).select("*").single();
    if (contactError) throw contactError;
    const { id: _followupId, ...followupPayload } = {
      ...followup,
      contact_id: contactData.id,
    };
    const { data: followupData, error: followupError } = await from("followups").insert(followupPayload).select("*").single();
    if (followupError) throw followupError;
    const { id: _reminderId, ...reminderPayload } = {
      ...reminder,
      followup_id: followupData.id,
    };
    const { data: reminderData, error: reminderError } = await from("reminders").insert(reminderPayload).select("*").single();
    if (reminderError) throw reminderError;
    await createAnalyticsEvent({ event_id: eventId, user_id: userId, action: "contact_saved", entity_id: contactData.id });
    await createAnalyticsEvent({ event_id: eventId, user_id: userId, action: "followup_created", entity_id: followupData.id });
    await createAnalyticsEvent({ event_id: eventId, user_id: userId, action: "reminder_created", entity_id: reminderData.id });
    if (input.source === "recommendation" && input.targetUserId) {
      await from("recommendations")
        .update({ status: "saved", saved_at: timestamp() })
        .eq("event_id", eventId)
        .eq("user_id", userId)
        .eq("target_user_id", input.targetUserId);
    }
    return { contact: contactData, followup: followupData, reminder: reminderData };
  }

  const duplicateManual = contact.source === "manual" && dev.contacts.find((item) =>
    item.event_id === eventId &&
    item.owner_user_id === userId &&
    item.source === "manual" &&
    item.created_at >= recentTimestamp(2) &&
    sameText(item.contact_name, contact.contact_name) &&
    sameText(item.contact_username, contact.contact_username) &&
    sameText(item.context, contact.context) &&
    sameText(item.next_step_text, contact.next_step_text),
  );
  if (duplicateManual) {
    const error = new Error("Это знакомство уже сохранено");
    error.status = 409;
    throw error;
  }
  dev.contacts.push(contact);
  dev.followups.push(followup);
  dev.reminders.push(reminder);
  dev.analytics_events.push(
    { id: id("evt"), event_id: eventId, user_id: userId, type: "contact_saved", action: "contact_saved", entity_id: contact.id, created_at: timestamp() },
    { id: id("evt"), event_id: eventId, user_id: userId, type: "followup_created", action: "followup_created", entity_id: followup.id, created_at: timestamp() },
    { id: id("evt"), event_id: eventId, user_id: userId, type: "reminder_created", action: "reminder_created", entity_id: reminder.id, created_at: timestamp() },
  );
  return { contact, followup, reminder };
}

export async function getContacts({ eventId, userId }) {
  if (hasSupabaseEnv) {
    const { data, error } = await from("contacts")
      .select("*")
      .eq("event_id", eventId)
      .eq("owner_user_id", userId)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return withTargetUsers(data);
  }
  return dev.contacts
    .filter((contact) => contact.event_id === eventId && contact.owner_user_id === userId && !contact.is_archived)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((contact) => ({ ...contact, target_user: dev.users.find((user) => user.id === contact.target_user_id) }));
}

export async function archiveContact({ contactId, userId }) {
  if (hasSupabaseEnv) {
    const { data: contact, error } = await from("contacts")
      .update({ is_archived: true, updated_at: timestamp() })
      .eq("id", contactId)
      .eq("owner_user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!contact) {
      const notFound = new Error("Контакт не найден");
      notFound.status = 404;
      throw notFound;
    }
    const { data: followups } = await from("followups").select("id").eq("contact_id", contactId).eq("owner_user_id", userId);
    const followupIds = (followups || []).map((item) => item.id);
    await from("followups")
      .update({ status: "cancelled", updated_at: timestamp() })
      .eq("contact_id", contactId)
      .eq("owner_user_id", userId)
      .in("status", ["scheduled", "reminder_sent", "snoozed"]);
    if (followupIds.length) {
      await from("reminders")
        .update({ status: "cancelled", cancelled_at: timestamp(), updated_at: timestamp() })
        .eq("user_id", userId)
        .eq("status", "pending")
        .in("followup_id", followupIds);
    }
    await createNonCriticalAnalyticsEvent({ event_id: contact.event_id, user_id: userId, action: "contact_archived", entity_id: contactId });
    return contact;
  }
  const contact = dev.contacts.find((item) => item.id === contactId && item.owner_user_id === userId);
  if (!contact) throw new Error("Контакт не найден");
  Object.assign(contact, { is_archived: true, updated_at: timestamp() });
  dev.followups
    .filter((followup) => followup.contact_id === contactId && followup.owner_user_id === userId && ["scheduled", "reminder_sent", "snoozed"].includes(followup.status))
    .forEach((followup) => {
      followup.status = "cancelled";
      followup.updated_at = timestamp();
    });
  return contact;
}

async function withTargetUsers(contacts) {
  const targetIds = Array.from(new Set((contacts || []).map((contact) => contact.target_user_id).filter(Boolean)));
  if (!targetIds.length) return contacts || [];
  const { data: users, error } = await from("users").select("*").in("id", targetIds);
  if (error) throw error;
  const userById = new Map((users || []).map((user) => [user.id, user]));
  return (contacts || []).map((contact) => ({ ...contact, target_user: userById.get(contact.target_user_id) }));
}

export async function getFollowups({ eventId, userId }) {
  const rows = hasSupabaseEnv
    ? await (async () => {
        const { data, error } = await from("followups")
          .select("*, contacts(*)")
          .eq("event_id", eventId)
          .eq("owner_user_id", userId)
          .order("due_at", { ascending: true });
        if (error) throw error;
        const contacts = await withTargetUsers(data.map((item) => item.contacts).filter(Boolean));
        const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
        return data.map((item) => ({ ...item, remind_at: item.due_at, contact: contactById.get(item.contact_id) || item.contacts }));
      })()
    : dev.followups
        .filter((followup) => followup.event_id === eventId && followup.owner_user_id === userId)
        .map((followup) => ({
          ...followup,
          contact: (() => {
            const contact = dev.contacts.find((item) => item.id === followup.contact_id);
            return contact ? { ...contact, target_user: dev.users.find((user) => user.id === contact.target_user_id) } : contact;
          })(),
        }));
  const today = new Date().toDateString();
  return {
    today: rows.filter((item) => new Date(dueAtOf(item)).toDateString() === today && !["completed", "result", "cancelled"].includes(item.status)),
    upcoming: rows.filter((item) => new Date(dueAtOf(item)).toDateString() !== today && !["completed", "result", "cancelled"].includes(item.status)),
    completed: rows.filter((item) => ["completed", "result"].includes(item.status)),
  };
}

export async function getEventHome({ eventId, userId }) {
  const event = await findEvent({ eventId });
  const contacts = await getContacts({ eventId, userId });
  const followups = await getFollowups({ eventId, userId });
  const recommendations = await getRecommendations({ eventId, userId });
  const flatFollowups = [...followups.today, ...followups.upcoming, ...followups.completed];
  const stats = {
    saved_contacts: contacts.length,
    upcoming_reminders: followups.today.length + followups.upcoming.length,
    completed_followups: flatFollowups.filter((item) => ["completed", "result"].includes(item.status)).length,
    results: flatFollowups.filter((item) => item.status === "result").length,
  };
  return {
    event,
    stats,
    upcomingReminders: [...followups.today, ...followups.upcoming].slice(0, 5),
    latestContacts: contacts.slice(0, 5),
    recommendedPeople: recommendations,
  };
}

export async function createAnalyticsEvent(event) {
  const payload = { id: id("evt"), created_at: timestamp(), ...event };
  if (hasSupabaseEnv) {
    const { id: _id, type, ...dbPayload } = payload;
    dbPayload.action = payload.action || type;
    const { data, error } = await from("analytics_events").insert(dbPayload).select("*").single();
    if (error) throw error;
    return data;
  }
  dev.analytics_events.push(payload);
  return payload;
}

async function createNonCriticalAnalyticsEvent(event) {
  try {
    return await createAnalyticsEvent(event);
  } catch (error) {
    console.warn("Analytics event skipped", event.action, error?.message || error);
    return null;
  }
}

export async function applyFollowupAction({ followupId, userId, action, snoozeUntil, nextReminderAt }) {
  if (action === "sent") action = "message_sent";
  if (action === "meeting") action = "meeting_booked";
  if (action === "intro") action = "person_introduced";
  const statusByAction = {
    message_sent: "completed",
    meeting_booked: "result",
    person_introduced: "result",
    snoozed: "snoozed",
    not_relevant: "cancelled",
  };
  const outcomeByAction = {
    message_sent: "message_sent",
    meeting_booked: "meeting_booked",
    person_introduced: "person_introduced",
  };
  if (action !== "telegram_opened" && !statusByAction[action]) {
    const error = new Error("Неизвестное действие follow-up");
    error.status = 400;
    throw error;
  }

  if (hasSupabaseEnv) {
    const { data: followup, error } = await from("followups")
      .select("*")
      .eq("id", followupId)
      .eq("owner_user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!followup) {
      const denied = new Error("Follow-up не найден");
      denied.status = 404;
      throw denied;
    }
    if (action === "telegram_opened") {
      await createAnalyticsEvent({ event_id: followup.event_id, user_id: userId, action: "telegram_opened", entity_id: followupId });
      return { followup, outcome: null };
    }
    const updates = {
      status: statusByAction[action],
      completed_at: ["message_sent", "meeting_booked", "person_introduced", "not_relevant"].includes(action)
        ? timestamp()
        : null,
      result_at: ["meeting_booked", "person_introduced"].includes(action) ? timestamp() : null,
      snoozed_until: action === "snoozed" ? snoozeUntil : null,
      due_at: action === "snoozed" ? snoozeUntil : followup.due_at,
      updated_at: timestamp(),
    };
    const { data: updated, error: updateError } = await from("followups").update(updates).eq("id", followupId).select("*").single();
    if (updateError) throw updateError;
    let createdOutcome = null;
    if (outcomeByAction[action]) {
      const { data: outcomeData, error: outcomeError } = await from("outcomes").insert({
        event_id: followup.event_id,
        followup_id: followupId,
        contact_id: followup.contact_id,
        owner_user_id: followup.owner_user_id,
        type: outcomeByAction[action],
        verification: "self_reported",
        created_at: timestamp(),
      }).select("*").single();
      if (outcomeError) throw outcomeError;
      createdOutcome = outcomeData;
    }
    if (action === "snoozed") {
      const { data: existingReminder } = await from("reminders")
        .select("id")
        .eq("followup_id", followupId)
        .eq("status", "pending")
        .maybeSingle();
      if (existingReminder) {
        await from("reminders").update({
          scheduled_at: snoozeUntil,
          status: "pending",
          updated_at: timestamp(),
        }).eq("id", existingReminder.id);
      } else {
        await from("reminders").insert({
          event_id: followup.event_id,
          user_id: followup.owner_user_id,
          followup_id: followupId,
          scheduled_at: snoozeUntil,
          status: "pending",
          created_at: timestamp(),
        });
      }
    } else if (["message_sent", "meeting_booked", "person_introduced", "not_relevant"].includes(action)) {
      await from("reminders")
        .update({ status: "cancelled", cancelled_at: timestamp(), updated_at: timestamp() })
        .eq("followup_id", followupId)
        .eq("status", "pending");
    }
    let nextFollowup = null;
    let nextReminder = null;
    if (nextReminderAt && ["message_sent", "meeting_booked"].includes(action)) {
      const nextDueAt = new Date(nextReminderAt);
      if (Number.isNaN(nextDueAt.getTime())) {
        const invalid = new Error("Дата следующего напоминания не распознана");
        invalid.status = 400;
        throw invalid;
      }
      const { data: followupData, error: nextFollowupError } = await from("followups").insert({
        event_id: followup.event_id,
        contact_id: followup.contact_id,
        owner_user_id: followup.owner_user_id,
        status: "scheduled",
        next_step_type: followup.next_step_type || "write_message",
        next_step_text: followup.next_step_text || "Вернуться к контакту",
        due_at: nextDueAt.toISOString(),
        created_at: timestamp(),
      }).select("*").single();
      if (nextFollowupError) throw nextFollowupError;
      const { data: reminderData, error: nextReminderError } = await from("reminders").insert({
        event_id: followup.event_id,
        user_id: followup.owner_user_id,
        followup_id: followupData.id,
        scheduled_at: nextDueAt.toISOString(),
        status: "pending",
        created_at: timestamp(),
      }).select("*").single();
      if (nextReminderError) throw nextReminderError;
      nextFollowup = followupData;
      nextReminder = reminderData;
      await createAnalyticsEvent({ event_id: followup.event_id, user_id: userId, action: "followup_created", entity_id: followupData.id });
      await createAnalyticsEvent({ event_id: followup.event_id, user_id: userId, action: "reminder_created", entity_id: reminderData.id });
    }
    const analyticsType = {
      message_sent: "followup_completed",
      meeting_booked: "result_meeting_booked",
      person_introduced: "result_person_introduced",
      snoozed: "followup_snoozed",
      not_relevant: "followup_missed",
    }[action];
    await createAnalyticsEvent({ event_id: followup.event_id, user_id: userId, action: analyticsType, entity_id: followupId });
    return { followup: updated, outcome: createdOutcome, nextFollowup, nextReminder };
  }

  const followup = dev.followups.find((item) => item.id === followupId && item.owner_user_id === userId);
  if (!followup) throw new Error("Follow-up not found");
  if (action === "telegram_opened") {
    dev.analytics_events.push({ id: id("evt"), event_id: followup.event_id, user_id: userId, type: "telegram_opened", action: "telegram_opened", entity_id: followupId, created_at: timestamp() });
    return { followup, outcome: null };
  }
  followup.status = statusByAction[action];
  if (action === "snoozed") followup.remind_at = snoozeUntil || new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  if (["message_sent", "meeting_booked", "person_introduced", "not_relevant"].includes(action)) followup.completed_at = timestamp();
  if (["meeting_booked", "person_introduced"].includes(action)) followup.result_at = timestamp();
  if (action === "snoozed") {
    followup.snoozed_until = followup.remind_at;
    let reminder = dev.reminders.find((item) => item.followup_id === followup.id);
    if (!reminder) {
      reminder = { id: id("rem"), event_id: followup.event_id, user_id: followup.owner_user_id, followup_id: followup.id };
      dev.reminders.push(reminder);
    }
    Object.assign(reminder, { scheduled_at: followup.remind_at, status: "pending", updated_at: timestamp() });
  } else if (["message_sent", "meeting_booked", "person_introduced", "not_relevant"].includes(action)) {
    dev.reminders
      .filter((item) => item.followup_id === followup.id && item.status === "pending")
      .forEach((item) => {
        item.status = "cancelled";
        item.cancelled_at = timestamp();
        item.updated_at = timestamp();
      });
  }
  if (outcomeByAction[action]) {
    dev.outcomes.push({
      id: id("out"),
      event_id: followup.event_id,
      followup_id: followup.id,
      contact_id: followup.contact_id,
      owner_user_id: followup.owner_user_id,
      type: outcomeByAction[action],
      created_at: timestamp(),
    });
  }
  let nextFollowup = null;
  let nextReminder = null;
  if (nextReminderAt && ["message_sent", "meeting_booked"].includes(action)) {
    nextFollowup = {
      id: id("fup"),
      event_id: followup.event_id,
      contact_id: followup.contact_id,
      owner_user_id: followup.owner_user_id,
      status: "scheduled",
      next_step_type: followup.next_step_type || "write_message",
      next_step_text: followup.next_step_text || "Вернуться к контакту",
      due_at: nextReminderAt,
      remind_at: nextReminderAt,
      created_at: timestamp(),
    };
    nextReminder = {
      id: id("rem"),
      event_id: followup.event_id,
      user_id: followup.owner_user_id,
      followup_id: nextFollowup.id,
      scheduled_at: nextReminderAt,
      status: "pending",
      created_at: timestamp(),
    };
    dev.followups.push(nextFollowup);
    dev.reminders.push(nextReminder);
  }
  const analyticsType = {
    message_sent: "followup_completed",
    meeting_booked: "result_meeting_booked",
    person_introduced: "result_person_introduced",
    snoozed: "followup_snoozed",
    not_relevant: "followup_missed",
  }[action];
  dev.analytics_events.push({ id: id("evt"), event_id: followup.event_id, user_id: userId, type: analyticsType, action: analyticsType, entity_id: followupId, created_at: timestamp() });
  return { followup, outcome: outcomeByAction[action] ? dev.outcomes.at(-1) : null, nextFollowup, nextReminder };
}

export async function cancelFollowup({ followupId, userId }) {
  if (hasSupabaseEnv) {
    const { data: followup, error } = await from("followups")
      .update({ status: "cancelled", updated_at: timestamp() })
      .eq("id", followupId)
      .eq("owner_user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!followup) {
      const notFound = new Error("Задача не найдена");
      notFound.status = 404;
      throw notFound;
    }
    await from("reminders")
      .update({ status: "cancelled", cancelled_at: timestamp(), updated_at: timestamp() })
      .eq("followup_id", followupId)
      .eq("status", "pending");
    await createNonCriticalAnalyticsEvent({ event_id: followup.event_id, user_id: userId, action: "followup_cancelled", entity_id: followupId });
    return followup;
  }
  const followup = dev.followups.find((item) => item.id === followupId && item.owner_user_id === userId);
  if (!followup) throw new Error("Задача не найдена");
  Object.assign(followup, { status: "cancelled", updated_at: timestamp() });
  dev.reminders
    .filter((item) => item.followup_id === followupId && item.status === "pending")
    .forEach((item) => {
      item.status = "cancelled";
      item.cancelled_at = timestamp();
      item.updated_at = timestamp();
    });
  return followup;
}

export async function getPendingReminders(nowIso = timestamp()) {
  if (hasSupabaseEnv) {
    const { data, error } = await from("reminders")
      .select("*, followups(*, contacts(*)), users(*)")
      .eq("status", "pending")
      .lte("scheduled_at", nowIso);
    if (error) throw error;
    return data;
  }
  return dev.reminders
    .filter((reminder) => reminder.status === "pending" && reminder.scheduled_at <= nowIso)
    .map((reminder) => ({
      ...reminder,
      followups: {
        ...dev.followups.find((followup) => followup.id === reminder.followup_id),
        contacts: dev.contacts.find((contact) => contact.id === dev.followups.find((followup) => followup.id === reminder.followup_id)?.contact_id),
      },
      users: dev.users.find((user) => user.id === reminder.user_id),
    }));
}

export async function enqueueLifecycleNotifications() {
  if (hasSupabaseEnv) {
    const { error } = await supabaseAdmin.rpc("fup_enqueue_lifecycle_notifications");
    if (error) throw error;
    return { ok: true };
  }
  return { ok: true };
}

export async function getPendingBotNotifications(nowIso = timestamp()) {
  if (hasSupabaseEnv) {
    const { data, error } = await from("bot_notifications")
      .select("*, users(*), events(*)")
      .eq("status", "pending")
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    return data || [];
  }
  return dev.bot_notifications
    .filter((notification) => notification.status === "pending" && notification.scheduled_at <= nowIso)
    .map((notification) => ({
      ...notification,
      users: dev.users.find((user) => user.id === notification.user_id),
      events: dev.events.find((event) => event.id === notification.event_id),
    }));
}

export async function markBotNotificationSent({ notificationId, telegramMessageId }) {
  if (hasSupabaseEnv) {
    const { data, error } = await from("bot_notifications")
      .update({ status: "sent", sent_at: timestamp(), telegram_message_id: telegramMessageId, updated_at: timestamp() })
      .eq("id", notificationId)
      .select("*")
      .single();
    if (error) throw error;
    await from("bot_messages").insert({
      event_id: data.event_id,
      user_id: data.user_id,
      telegram_message_id: telegramMessageId,
      message_type: data.notification_type,
      status: "sent",
      sent_at: timestamp(),
      created_at: timestamp(),
    });
    await createAnalyticsEvent({ event_id: data.event_id, user_id: data.user_id, action: `bot_${data.notification_type}_sent`, entity_id: notificationId });
    return data;
  }
  const notification = dev.bot_notifications.find((item) => item.id === notificationId);
  if (notification) Object.assign(notification, { status: "sent", sent_at: timestamp(), telegram_message_id: telegramMessageId });
  return notification;
}

export async function markBotNotificationFailed({ notificationId, errorMessage }) {
  if (hasSupabaseEnv) {
    const { data, error } = await from("bot_notifications")
      .update({
        status: "failed",
        failed_at: timestamp(),
        error_message: String(errorMessage || "Telegram delivery failed"),
        updated_at: timestamp(),
      })
      .eq("id", notificationId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (data) {
      await from("bot_messages").insert({
        event_id: data.event_id,
        user_id: data.user_id,
        message_type: data.notification_type,
        status: "failed",
        error_message: String(errorMessage || "Telegram delivery failed"),
        failed_at: timestamp(),
        created_at: timestamp(),
      });
      await createAnalyticsEvent({ event_id: data.event_id, user_id: data.user_id, action: `bot_${data.notification_type}_failed`, entity_id: notificationId });
    }
    return data;
  }
  const notification = dev.bot_notifications.find((item) => item.id === notificationId);
  if (notification) Object.assign(notification, { status: "failed", failed_at: timestamp(), error_message: String(errorMessage || "Telegram delivery failed") });
  return notification;
}

export async function markReminderSent({ reminderId, followupId, telegramMessageId }) {
  if (hasSupabaseEnv) {
    await from("reminders").update({ status: "sent", sent_at: timestamp(), telegram_message_id: telegramMessageId }).eq("id", reminderId);
    const { data, error } = await from("followups").update({ status: "reminder_sent" }).eq("id", followupId).select("*").single();
    if (error) throw error;
    await from("bot_messages").insert({
      event_id: data.event_id,
      user_id: data.owner_user_id,
      followup_id: followupId,
      telegram_message_id: telegramMessageId,
      message_type: "reminder",
      status: "sent",
      sent_at: timestamp(),
      created_at: timestamp(),
    });
    await createAnalyticsEvent({ event_id: data.event_id, user_id: data.owner_user_id, action: "reminder_sent", entity_id: followupId });
    return data;
  }
  const reminder = dev.reminders.find((item) => item.id === reminderId);
  const followup = dev.followups.find((item) => item.id === followupId);
  Object.assign(reminder, { status: "sent", sent_at: timestamp(), telegram_message_id: telegramMessageId });
  Object.assign(followup, { status: "reminder_sent" });
  dev.bot_messages.push({ id: id("bot"), followup_id: followupId, telegram_message_id: telegramMessageId, created_at: timestamp() });
  dev.analytics_events.push({ id: id("evt"), event_id: followup.event_id, user_id: followup.owner_user_id, type: "reminder_sent", action: "reminder_sent", entity_id: followupId, created_at: timestamp() });
  return followup;
}

export async function markReminderFailed({ reminderId, followupId, errorMessage }) {
  if (hasSupabaseEnv) {
    await from("reminders")
      .update({ status: "failed", failed_at: timestamp(), error_message: String(errorMessage || "Telegram delivery failed"), updated_at: timestamp() })
      .eq("id", reminderId);
    const { data: followup } = await from("followups").select("*").eq("id", followupId).maybeSingle();
    if (followup) {
      await from("bot_messages").insert({
        event_id: followup.event_id,
        user_id: followup.owner_user_id,
        followup_id: followupId,
        message_type: "reminder",
        status: "failed",
        error_message: String(errorMessage || "Telegram delivery failed"),
        failed_at: timestamp(),
        created_at: timestamp(),
      });
      await createAnalyticsEvent({ event_id: followup.event_id, user_id: followup.owner_user_id, action: "reminder_failed", entity_id: followupId });
    }
    return followup;
  }
  const reminder = dev.reminders.find((item) => item.id === reminderId);
  const followup = dev.followups.find((item) => item.id === followupId);
  if (reminder) Object.assign(reminder, { status: "failed", failed_at: timestamp(), error_message: String(errorMessage || "Telegram delivery failed") });
  if (followup) {
    dev.analytics_events.push({ id: id("evt"), event_id: followup.event_id, user_id: followup.owner_user_id, type: "reminder_failed", action: "reminder_failed", entity_id: followupId, created_at: timestamp() });
  }
  return followup;
}

export async function getOrganizerEvents(userId) {
  if (hasSupabaseEnv) {
    const access = await getOrganizerAccess(userId);
    const organizationIds = access.map((item) => item.organization_id).filter(Boolean);
    if (!organizationIds.length) return [];
    const { data, error } = await from("events").select("*").in("organization_id", organizationIds).order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  const organizationIds = (dev.organization_members || [])
    .filter((member) => member.user_id === userId)
    .map((member) => member.organization_id);
  return dev.events.filter((event) => organizationIds.includes(event.organization_id));
}

export async function createOrganizerEvent({ userId, input }) {
  await requireOrganizerAccess(userId, {
    organizationId: input.organizationId || input.organization_id,
    allowedRoles: ["owner", "admin", "manager"],
  });
  const inviteCode = input.inviteCode || inviteCodeFrom();
  const slug = input.slug || `${input.name}-${inviteCode}`.toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-").replace(/^-|-$/g, "");
  const event = {
    id: id("ev"),
    organization_id: input.organizationId || input.organization_id || "org-1",
    created_by_user_id: userId,
    name: input.name,
    description: input.description,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    timezone: input.timezone,
    privacy: input.privacy || "invite_only",
    location_name: input.locationName,
    location_address: input.locationAddress,
    goal_contacts_per_user: input.goalContactsPerUser,
    goal_messages_per_user: input.goalMessagesPerUser,
    goal_results_per_user: input.goalResultsPerUser,
    settings: {
      ...(input.settings || {}),
      invite_code_expires_at: inviteExpiresAt(),
    },
    status: "draft",
    goals: input.goals || [],
    slug,
    invite_code: inviteCode,
    created_at: timestamp(),
  };
  if (hasSupabaseEnv) {
    const { id: _eventId, goals: _goals, ...eventPayload } = event;
    const { data, error } = await from("events").insert(eventPayload).select("*").single();
    if (error) throw error;
    const goals = [
      {
        title: `Сохранить ${input.goalContactsPerUser || 3} полезных знакомств`,
        goal_type: "contacts_saved",
        target_count: input.goalContactsPerUser || 3,
        sort_order: 1,
      },
      {
        title: `Написать ${input.goalMessagesPerUser || 2} людям после события`,
        goal_type: "messages_sent",
        target_count: input.goalMessagesPerUser || 2,
        sort_order: 2,
      },
      {
        title: `Получить ${input.goalResultsPerUser || 1} результат`,
        goal_type: "results_created",
        target_count: input.goalResultsPerUser || 1,
        sort_order: 3,
      },
    ];
    if (goals.length) {
      await from("event_goals").insert(
        goals.map((goal) => ({
          event_id: data.id,
          ...goal,
          created_at: timestamp(),
        })),
      );
    }
    return { ...eventResponse(data), goals };
  }
  dev.events.push(event);
  event.goals = [
    `Сохранить ${input.goalContactsPerUser || 3} полезных знакомств`,
    `Написать ${input.goalMessagesPerUser || 2} людям после события`,
    `Получить ${input.goalResultsPerUser || 1} результат`,
  ];
  return { ...eventResponse(event), goals: event.goals };
}

function eventResponse(event) {
  const webappUrl = process.env.WEBAPP_URL || "http://localhost:3000";
  return {
    event,
    invite_link: `${webappUrl}/join/${encodeURIComponent(event.invite_code)}`,
    invite_qr_payload: `${webappUrl}/join/${encodeURIComponent(event.invite_code)}`,
    invite: getInvitePayload(event),
  };
}

async function refreshExpiredInvite(event) {
  if (!event || !inviteExpired(event)) return event;
  const updates = {
    invite_code: inviteCodeFrom(),
    settings: {
      ...eventSettings(event),
      invite_code_expires_at: inviteExpiresAt(),
    },
    updated_at: timestamp(),
  };
  if (hasSupabaseEnv) {
    const { data, error } = await from("events").update(updates).eq("id", event.id).select("*").single();
    if (error) throw error;
    return data;
  }
  Object.assign(event, updates);
  return event;
}

export function getInvitePayload(event) {
  const webappUrl = process.env.WEBAPP_URL || "http://localhost:3000";
  const bot = process.env.TELEGRAM_BOT_USERNAME || TELEGRAM_BOT_USERNAME;
  const webJoinUrl = `${webappUrl}/join/${encodeURIComponent(event.invite_code)}`;
  const telegramMiniAppUrl = bot
    ? `https://t.me/${bot.replace("@", "")}?startapp=${encodeURIComponent(event.invite_code)}`
    : null;
  return {
    inviteCode: event.invite_code,
    webJoinUrl,
    telegramMiniAppUrl,
    qrPayload: telegramMiniAppUrl || webJoinUrl,
    eventName: event.name,
    expiresAt: inviteExpiresAtOf(event),
  };
}

export async function getPublicEventByInvite(inviteCode) {
  const event = await findEvent({ inviteCode });
  if (!event) return null;
  const organization = hasSupabaseEnv
    ? (await from("organizations").select("id, name, slug").eq("id", event.organization_id).maybeSingle()).data
    : dev.organizations.find((org) => org.id === event.organization_id);
  return {
    event: {
      id: event.id,
      name: event.name,
      description: event.description,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      privacy: event.privacy,
    },
    organization,
    ...getInvitePayload(event),
  };
}

export async function getOrgMe(userId) {
  const access = await getOrganizerAccess(userId);
  const organizations = access.map((item) => ({
    organization: item.organizations,
    role: item.role,
    events: item.events || [],
  }));
  return { user: await getUserById(userId), organizations };
}

export async function getOrganizerEvent(userId, eventId) {
  await requireOrganizerAccess(userId, { eventId, allowedRoles: ["owner", "admin", "manager", "viewer"] });
  const event = await refreshExpiredInvite(await findEvent({ eventId }));
  const organization = hasSupabaseEnv
    ? (await from("organizations").select("*").eq("id", event.organization_id).single()).data
    : dev.organizations.find((org) => org.id === event.organization_id);
  const goals = hasSupabaseEnv
    ? (await from("event_goals").select("*").eq("event_id", eventId)).data || []
    : event.goals || [];
  return {
    event,
    organization,
    goals,
    invite: getInvitePayload(event),
    overview: (await getOrganizerDashboard(eventId)).overview,
  };
}

export async function updateOrganizerEvent(userId, eventId, input) {
  await requireOrganizerAccess(userId, { eventId, allowedRoles: ["owner", "admin", "manager"] });
  const updates = {
    name: input.name,
    description: input.description,
    starts_at: input.starts_at || input.startsAt,
    ends_at: input.ends_at || input.endsAt,
    status: input.status,
    privacy: input.privacy,
    location_name: input.location_name || input.locationName,
    location_address: input.location_address || input.locationAddress,
    goal_contacts_per_user: input.goal_contacts_per_user || input.goalContactsPerUser,
    goal_messages_per_user: input.goal_messages_per_user || input.goalMessagesPerUser,
    goal_results_per_user: input.goal_results_per_user || input.goalResultsPerUser,
    settings: input.settings,
    updated_at: timestamp(),
  };
  Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
  if (hasSupabaseEnv) {
    const { data, error } = await from("events").update(updates).eq("id", eventId).select("*").single();
    if (error) throw error;
    return data;
  }
  const event = dev.events.find((item) => item.id === eventId);
  Object.assign(event, updates);
  return event;
}

export async function archiveOrganizerEvent(userId, eventId) {
  await requireOrganizerAccess(userId, { eventId, allowedRoles: ["owner", "admin"] });
  if (hasSupabaseEnv) {
    const { data, error } = await from("events").update({ status: "archived", updated_at: timestamp() }).eq("id", eventId).select("*").single();
    if (error) throw error;
    return data;
  }
  const event = dev.events.find((item) => item.id === eventId);
  event.status = "archived";
  return event;
}

export async function getOrganizerEventInvite(userId, eventId) {
  await requireOrganizerAccess(userId, { eventId, allowedRoles: ["owner", "admin", "manager", "viewer"] });
  const event = await refreshExpiredInvite(await findEvent({ eventId }));
  return getInvitePayload(event);
}

export async function getOrganizerDashboard(eventId) {
  if (hasSupabaseEnv) {
    const rpc = await supabaseAdmin.rpc("get_event_dashboard", { p_event_id: eventId });
    if (!rpc.error && rpc.data) return rpc.data;
  }

  const members = hasSupabaseEnv
    ? await (async () => {
        const { data, error } = await from("event_members").select("*, users(*)").eq("event_id", eventId);
        if (error) throw error;
        return data;
      })()
    : dev.event_members.filter((member) => member.event_id === eventId).map((member) => ({ ...member, users: dev.users.find((user) => user.id === member.user_id) }));
  const contacts = hasSupabaseEnv ? (await from("contacts").select("*").eq("event_id", eventId)).data || [] : dev.contacts.filter((item) => item.event_id === eventId);
  const followups = hasSupabaseEnv ? (await from("followups").select("*, contacts(*)").eq("event_id", eventId)).data || [] : dev.followups.filter((item) => item.event_id === eventId).map((item) => ({ ...item, contacts: dev.contacts.find((contact) => contact.id === item.contact_id) }));
  const reminders = hasSupabaseEnv ? (await from("reminders").select("*").eq("event_id", eventId)).data || [] : dev.reminders.filter((item) => item.event_id === eventId);
  const outcomes = hasSupabaseEnv ? (await from("outcomes").select("*").eq("event_id", eventId)).data || [] : dev.outcomes.filter((item) => item.event_id === eventId);
  const analytics = hasSupabaseEnv ? (await from("analytics_events").select("*").eq("event_id", eventId)).data || [] : dev.analytics_events.filter((item) => item.event_id === eventId);

  const messagesSent = outcomes.filter((item) => item.type === "message_sent").length;
  const meetingsBooked = outcomes.filter((item) => item.type === "meeting_booked").length;
  const peopleIntroduced = outcomes.filter((item) => item.type === "person_introduced").length;
  const resultsCount = meetingsBooked + peopleIntroduced;
  const profileCompletedCount = members.filter(({ users }) => profileCompleted(users)).length;

  return {
    overview: {
      participants: members.length,
      profile_completed: profileCompletedCount,
      contacts_saved: contacts.length,
      messages_sent: messagesSent,
      results: resultsCount,
    },
    funnel: {
      invited_count: members.length,
      app_opened_count: analytics.filter((item) => actionOf(item) === "app_opened").length || members.length,
      profile_completed_count: profileCompletedCount,
      contacts_saved_count: contacts.length,
      reminders_sent_count: reminders.filter((item) => item.status === "sent").length,
      messages_sent_count: messagesSent,
      results_count: resultsCount,
    },
    participant_activity: members.map(({ users }) => {
      const userContacts = contacts.filter((contact) => contact.owner_user_id === users.id);
      const userFollowups = followups.filter((followup) => followup.owner_user_id === users.id);
      return {
        participant: nameFromTelegram(users),
        contacts: userContacts.length,
        followups: userFollowups.filter((item) => ["completed", "result"].includes(item.status)).length,
        meetings: outcomes.filter((item) => (item.owner_user_id || item.user_id) === users.id && item.type === "meeting_booked").length,
        intro: outcomes.filter((item) => (item.owner_user_id || item.user_id) === users.id && item.type === "person_introduced").length,
        last_activity: [...userContacts, ...userFollowups].map((item) => item.created_at).sort().at(-1),
      };
    }),
    followup_log: followups.map((followup) => ({
      owner_user_id: followup.owner_user_id,
      contact: followup.contacts?.contact_name,
      next_step: followup.next_step_text,
      remind_at: dueAtOf(followup),
      status: followup.status,
      result: outcomes.find((outcome) => outcome.followup_id === followup.id)?.type || null,
    })),
    recommendations_metrics: {
      recommendation_shown: analytics.filter((item) => actionOf(item) === "recommendation_shown").length,
      recommendation_saved: contacts.filter((item) => item.source === "recommendation").length,
      recommendation_contacted: analytics.filter((item) => actionOf(item) === "recommendation_contacted").length,
    },
    retention_metrics: {
      next_day_returned: analytics.filter((item) => actionOf(item) === "next_day_returned").length,
      week_returned: analytics.filter((item) => actionOf(item) === "week_returned").length,
      inactive_members: members.filter(({ users }) => !contacts.some((contact) => contact.owner_user_id === users.id)).length,
      missed_reminders: reminders.filter((item) => item.status === "missed").length,
      snoozed_reminders: reminders.filter((item) => item.status === "snoozed").length,
    },
    results: {
      meetings_booked: meetingsBooked,
      people_introduced: peopleIntroduced,
    },
  };
}

const activityLabels = {
  app_opened: "Открыл приложение",
  event_joined: "Присоединился к мероприятию",
  profile_completed: "Заполнил профиль",
  profile_updated: "Обновил профиль",
  contact_saved: "Сохранил знакомство",
  reminder_created: "Поставил напоминание",
  reminder_sent: "Получил напоминание",
  followup_completed: "Написал человеку",
  result_meeting_booked: "Назначил встречу",
  result_person_introduced: "Познакомил людей",
  followup_snoozed: "Отложил follow-up",
};

export async function getOrganizerLive(userId, eventId) {
  await requireOrganizerAccess(userId, { eventId, allowedRoles: ["owner", "admin", "manager", "viewer"] });
  const event = await findEvent({ eventId });
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const members = hasSupabaseEnv
    ? await (async () => {
        const { data, error } = await from("event_members").select("*, users(*)").eq("event_id", eventId);
        if (error) throw error;
        return data || [];
      })()
    : dev.event_members
        .filter((member) => member.event_id === eventId)
        .map((member) => ({ ...member, users: dev.users.find((user) => user.id === member.user_id) }));
  const contacts = hasSupabaseEnv ? (await from("contacts").select("*").eq("event_id", eventId)).data || [] : dev.contacts.filter((item) => item.event_id === eventId);
  const reminders = hasSupabaseEnv ? (await from("reminders").select("*").eq("event_id", eventId)).data || [] : dev.reminders.filter((item) => item.event_id === eventId);
  const followups = hasSupabaseEnv ? (await from("followups").select("*").eq("event_id", eventId)).data || [] : dev.followups.filter((item) => item.event_id === eventId);
  const outcomes = hasSupabaseEnv ? (await from("outcomes").select("*").eq("event_id", eventId)).data || [] : dev.outcomes.filter((item) => item.event_id === eventId);
  const analytics = hasSupabaseEnv
    ? (await from("analytics_events").select("*").eq("event_id", eventId).order("created_at", { ascending: false }).limit(60)).data || []
    : dev.analytics_events.filter((item) => item.event_id === eventId).sort((a, b) => b.created_at.localeCompare(a.created_at));

  const userIds = [...new Set([...members.map((member) => member.user_id), ...analytics.map((eventRow) => eventRow.user_id)].filter(Boolean))];
  const users = hasSupabaseEnv
    ? userIds.length
      ? (await from("users").select("*").in("id", userIds)).data || []
      : []
    : dev.users.filter((user) => userIds.includes(user.id));
  const userById = new Map(users.map((user) => [user.id, user]));

  const meetingsBooked = outcomes.filter((item) => item.type === "meeting_booked").length;
  const peopleIntroduced = outcomes.filter((item) => item.type === "person_introduced").length;
  const completedFollowups = followups.filter((item) => ["completed", "result"].includes(item.status)).length;
  const profilesCompleted = members.filter(({ users: rowUser, profile_completed_at }) => profile_completed_at || rowUser?.profile_completed_at || profileCompleted(rowUser)).length;

  return {
    event,
    liveMetrics: {
      appOpened: analytics.filter((item) => actionOf(item) === "app_opened").length,
      joined: members.length,
      profilesCompleted,
      visibleInCatalog: members.filter(({ users: rowUser, is_visible }) => is_visible !== false && rowUser?.is_visible).length,
      contactsSaved: contacts.length,
      remindersCreated: reminders.length,
      completedFollowups,
      resultsTotal: meetingsBooked + peopleIntroduced,
      meetingsBooked,
      peopleIntroduced,
      activeNow: members.filter((member) => member.last_activity_at && member.last_activity_at > tenMinutesAgo).length,
      lastHourActivity: analytics.filter((item) => item.created_at > hourAgo).length,
    },
    funnel: {
      invited: members.length,
      opened: analytics.filter((item) => actionOf(item) === "app_opened").length,
      profileCompleted: profilesCompleted,
      contactsSaved: contacts.length,
      messagesSent: followups.filter((item) => ["completed", "result"].includes(item.status)).length,
      results: meetingsBooked + peopleIntroduced,
    },
    recentActivity: analytics.slice(0, 20).map((item) => ({
      id: item.id,
      created_at: item.created_at,
      user: nameFromTelegram(userById.get(item.user_id) || {}),
      type: actionOf(item),
      label: activityLabels[actionOf(item)] || "Активность",
    })),
    recentMembers: members
      .slice()
      .sort((a, b) => String(b.joined_at || "").localeCompare(String(a.joined_at || "")))
      .slice(0, 10)
      .map((member) => ({
        id: member.id,
        joined_at: member.joined_at,
        last_activity_at: member.last_activity_at,
        profile_completed: Boolean(member.profile_completed_at || member.users?.profile_completed_at || profileCompleted(member.users)),
        user: member.users,
      })),
  };
}

export async function getReport(eventId) {
  const dashboard = await getOrganizerDashboard(eventId);
  return {
    title: "Отчет по нетворкингу за 7 дней",
    generated_at: timestamp(),
    ...dashboard.overview,
    reminders_sent: dashboard.funnel.reminders_sent_count,
    meetings_booked: dashboard.results.meetings_booked,
    people_introduced: dashboard.results.people_introduced,
    privacy_note: "Организатор видит агрегированные статусы и результаты, но не видит личную переписку.",
  };
}
