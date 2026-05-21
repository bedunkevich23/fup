import { seedDb } from "../data/seed";
import type {
  AnalyticsEvent,
  AnalyticsEventType,
  Contact,
  CreateContactInput,
  CreateFollowUpInput,
  DemoDb,
  FollowUp,
  FollowUpLogRow,
  FollowUpOutcomeType,
  FollowUpStatus,
  FollowUpWithContact,
  OrganizerStats,
  ParticipantStats,
  ProfileInput,
  Program,
  ProgramMember,
  User,
} from "../types";

const DB_KEY = "fup.demo.db.v2";
const CURRENT_USER_ID = "user-current";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const nowIso = () => new Date().toISOString();

const getDb = (): DemoDb => {
  const stored = window.localStorage.getItem(DB_KEY);
  if (!stored) {
    window.localStorage.setItem(DB_KEY, JSON.stringify(seedDb));
    return clone(seedDb);
  }

  try {
    const parsed = JSON.parse(stored) as DemoDb;
    if (!parsed.followUps?.[0] || "remind_at" in parsed.followUps[0]) {
      return parsed;
    }
    window.localStorage.setItem(DB_KEY, JSON.stringify(seedDb));
    return clone(seedDb);
  } catch {
    window.localStorage.setItem(DB_KEY, JSON.stringify(seedDb));
    return clone(seedDb);
  }
};

const saveDb = (db: DemoDb) => {
  window.localStorage.setItem(DB_KEY, JSON.stringify(db));
};

const addDays = (dateIso: string, days: number) => {
  const date = new Date(dateIso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const getContact = (db: DemoDb, contactId: string) =>
  db.contacts.find((contact) => contact.id === contactId);

const getOwner = (db: DemoDb, userId: string) => db.users.find((user) => user.id === userId);

const resultLabel: Record<FollowUpOutcomeType, string> = {
  none: "Нет",
  sent_message: "Написал",
  meeting_booked: "Встреча",
  intro_made: "Intro",
  person_introduced: "Intro",
};

export const getCurrentUser = (): User => {
  const db = getDb();
  return db.users.find((user) => user.id === CURRENT_USER_ID) ?? db.users[0];
};

export const getCurrentProgram = (): Program => getDb().programs[0];

export const getProgramMembers = (programId: string): Array<ProgramMember & { user: User }> => {
  const db = getDb();
  return db.programMembers
    .filter((member) => member.program_id === programId)
    .map((member) => ({
      ...member,
      user: db.users.find((user) => user.id === member.user_id)!,
    }))
    .filter((member) => member.user?.is_visible);
};

export const saveProfile = (profile: ProfileInput): User => {
  const db = getDb();
  const user = db.users.find((item) => item.id === CURRENT_USER_ID) ?? db.users[0];
  Object.assign(user, profile);
  saveDb(db);
  createAnalyticsEvent({
    program_id: db.programs[0].id,
    user_id: user.id,
    type: "profile_saved",
    entity_id: user.id,
  });
  return user;
};

export const createContact = (input: CreateContactInput): Contact => {
  const db = getDb();
  const contact: Contact = {
    id: createId("contact"),
    created_at: nowIso(),
    connection_type:
      input.connection_type ?? (input.source === "program_member" ? "internal" : "manual"),
    ...input,
  };
  db.contacts.unshift(contact);
  saveDb(db);
  createAnalyticsEvent({
    program_id: contact.program_id,
    user_id: contact.owner_user_id,
    type: "contact_created",
    entity_id: contact.id,
    metadata: { source: contact.source },
  });
  return contact;
};

export const createFollowUp = (input: CreateFollowUpInput): FollowUp => {
  const db = getDb();
  const contact = getContact(db, input.contact_id);
  const followUp: FollowUp = {
    id: createId("follow"),
    status: "scheduled",
    outcome_type: "none",
    created_at: nowIso(),
    ...input,
  };
  db.followUps.unshift(followUp);
  saveDb(db);
  createAnalyticsEvent({
    program_id: contact?.program_id ?? getCurrentProgram().id,
    user_id: followUp.owner_user_id,
    type: "followup_created",
    entity_id: followUp.id,
  });
  return followUp;
};

export const createAnalyticsEvent = (
  input: Omit<AnalyticsEvent, "id" | "created_at">,
): AnalyticsEvent => {
  const db = getDb();
  const event: AnalyticsEvent = {
    id: createId("event"),
    created_at: nowIso(),
    ...input,
  };
  db.analyticsEvents.unshift(event);
  saveDb(db);
  return event;
};

export const updateFollowUpStatus = (
  id: string,
  status: FollowUpStatus,
  outcomeType: FollowUpOutcomeType = "none",
): FollowUp | undefined => {
  const db = getDb();
  const followUp = db.followUps.find((item) => item.id === id);
  if (!followUp) return undefined;

  followUp.status = status;
  followUp.outcome_type = outcomeType;
  followUp.completed_at =
    status === "completed" || status === "result" ? nowIso() : followUp.completed_at;

  const contact = getContact(db, followUp.contact_id);
  const type: AnalyticsEventType =
    outcomeType === "meeting_booked"
      ? "meeting_booked"
      : outcomeType === "intro_made"
        ? "intro_made"
        : status === "completed"
          ? "followup_completed"
          : "followup_snoozed";

  db.analyticsEvents.unshift({
    id: createId("event"),
    program_id: contact?.program_id ?? getCurrentProgram().id,
    user_id: followUp.owner_user_id,
    type,
    entity_id: followUp.id,
    metadata: { outcome_type: outcomeType },
    created_at: nowIso(),
  });

  saveDb(db);
  return followUp;
};

export const snoozeFollowUp = (id: string, days = 2): FollowUp | undefined => {
  const db = getDb();
  const followUp = db.followUps.find((item) => item.id === id);
  if (!followUp) return undefined;

  followUp.status = "snoozed";
  followUp.remind_at = addDays(followUp.remind_at, days);
  followUp.outcome_type = "none";

  const contact = getContact(db, followUp.contact_id);
  db.analyticsEvents.unshift({
    id: createId("event"),
    program_id: contact?.program_id ?? getCurrentProgram().id,
    user_id: followUp.owner_user_id,
    type: "followup_snoozed",
    entity_id: followUp.id,
    created_at: nowIso(),
  });

  saveDb(db);
  return followUp;
};

export const sendReminderMock = (id: string): FollowUp | undefined => {
  const db = getDb();
  const followUp = db.followUps.find((item) => item.id === id);
  if (!followUp) return undefined;

  followUp.status = "reminder_sent";
  followUp.reminder_sent_at = nowIso();

  const contact = getContact(db, followUp.contact_id);
  db.analyticsEvents.unshift({
    id: createId("event"),
    program_id: contact?.program_id ?? getCurrentProgram().id,
    user_id: followUp.owner_user_id,
    type: "reminder_mock_sent",
    entity_id: followUp.id,
    created_at: nowIso(),
  });

  saveDb(db);
  return followUp;
};

export const trackTelegramOpened = (followUpId: string): FollowUp | undefined => {
  const db = getDb();
  const followUp = db.followUps.find((item) => item.id === followUpId);
  if (!followUp) return undefined;
  const contact = getContact(db, followUp.contact_id);

  db.analyticsEvents.unshift({
    id: createId("event"),
    program_id: contact?.program_id ?? getCurrentProgram().id,
    user_id: followUp.owner_user_id,
    type: "telegram_opened",
    entity_id: followUp.id,
    created_at: nowIso(),
  });

  saveDb(db);
  return followUp;
};

export const getContactsForUser = (userId: string, programId: string): Contact[] =>
  getDb().contacts.filter(
    (contact) => contact.owner_user_id === userId && contact.program_id === programId,
  );

export const getFollowUpsForUser = (userId: string): FollowUpWithContact[] => {
  const db = getDb();
  return db.followUps
    .filter((followUp) => followUp.owner_user_id === userId)
    .map((followUp) => ({
      ...followUp,
      contact: getContact(db, followUp.contact_id),
    }))
    .sort((a, b) => a.remind_at.localeCompare(b.remind_at));
};

export const getContactDetails = (
  contactId: string,
): { contact: Contact; followUp?: FollowUp } | undefined => {
  const db = getDb();
  const contact = getContact(db, contactId);
  if (!contact) return undefined;
  return {
    contact,
    followUp: db.followUps.find((item) => item.contact_id === contactId),
  };
};

export const getParticipantStats = (userId: string, programId: string): ParticipantStats => {
  const db = getDb();
  const contacts = db.contacts.filter(
    (contact) => contact.owner_user_id === userId && contact.program_id === programId,
  );
  const contactIds = new Set(contacts.map((contact) => contact.id));
  const followUps = db.followUps.filter(
    (followUp) => followUp.owner_user_id === userId && contactIds.has(followUp.contact_id),
  );

  const remindersSent = followUps.filter((followUp) => followUp.reminder_sent_at).length;
  const completedFollowUps = followUps.filter(
    (followUp) => followUp.status === "completed" || followUp.status === "result",
  ).length;
  const meetings = followUps.filter((followUp) => followUp.outcome_type === "meeting_booked").length;
  const intros = followUps.filter((followUp) => followUp.outcome_type === "intro_made").length;

  return {
    savedContacts: contacts.length,
    scheduledFollowUps: followUps.filter((followUp) =>
      ["scheduled", "reminder_sent", "snoozed"].includes(followUp.status),
    ).length,
    remindersSent,
    completedFollowUps,
    meetings,
    intros,
    results: meetings + intros,
  };
};

export const getOrganizerStats = (programId: string): OrganizerStats => {
  const db = getDb();
  const contacts = db.contacts.filter((contact) => contact.program_id === programId);
  const contactIds = new Set(contacts.map((contact) => contact.id));
  const followUps = db.followUps.filter((followUp) => contactIds.has(followUp.contact_id));
  const remindersSent = followUps.filter((followUp) => followUp.reminder_sent_at).length;
  const completedFollowUps = followUps.filter(
    (followUp) => followUp.status === "completed" || followUp.status === "result",
  ).length;
  const meetings = followUps.filter((followUp) => followUp.outcome_type === "meeting_booked").length;
  const intros = followUps.filter((followUp) => followUp.outcome_type === "intro_made").length;

  return {
    participants: db.programMembers.filter((member) => member.program_id === programId).length,
    savedContacts: contacts.length,
    scheduledFollowUps: followUps.filter((followUp) =>
      ["scheduled", "reminder_sent", "snoozed"].includes(followUp.status),
    ).length,
    remindersSent,
    completedFollowUps,
    meetings,
    intros,
    results: meetings + intros,
  };
};

export const getParticipantActivity = (programId: string) => {
  const db = getDb();
  return db.programMembers
    .filter((member) => member.program_id === programId)
    .map((member) => {
      const user = getOwner(db, member.user_id);
      const stats = getParticipantStats(member.user_id, programId);
      const lastActivity = [
        ...db.contacts.filter((contact) => contact.owner_user_id === member.user_id),
        ...db.followUps.filter((followUp) => followUp.owner_user_id === member.user_id),
        ...db.analyticsEvents.filter((event) => event.user_id === member.user_id),
      ]
        .map((item) => ("created_at" in item ? item.created_at : member.joined_at))
        .sort()
        .at(-1);

      return {
        id: member.id,
        participant: user?.name ?? "Участник",
        contacts: stats.savedContacts,
        followUps: stats.completedFollowUps,
        meetings: stats.meetings,
        intros: stats.intros,
        lastActivity: lastActivity ?? member.joined_at,
      };
    });
};

export const getFollowUpLog = (programId: string): FollowUpLogRow[] => {
  const db = getDb();
  return db.followUps
    .map((followUp) => {
      const contact = getContact(db, followUp.contact_id);
      if (!contact || contact.program_id !== programId) return undefined;
      const owner = getOwner(db, followUp.owner_user_id);
      return {
        id: followUp.id,
        ownerName: owner?.name ?? "Участник",
        contactName: contact.contact_name,
        nextStep: contact.next_step,
        remindAt: followUp.remind_at,
        status: followUp.status,
        result: resultLabel[followUp.outcome_type],
      };
    })
    .filter(Boolean) as FollowUpLogRow[];
};

export const resetDemoData = () => {
  saveDb(clone(seedDb));
};

export const getContactLog = getFollowUpLog;
