export type Role =
  | "Основатель"
  | "Студент"
  | "Ментор"
  | "Инвестор"
  | "Эксперт"
  | "Организатор";

export type ContactSource = "manual" | "program_member" | "recommendation";
export type ConnectionType = "manual" | "internal" | "verified";
export type FollowUpStatus =
  | "scheduled"
  | "reminder_sent"
  | "completed"
  | "result"
  | "snoozed"
  | "missed"
  | "cancelled";
export type FollowUpOutcomeType =
  | "sent_message"
  | "meeting_booked"
  | "intro_made"
  | "person_introduced"
  | "none";
export type AnalyticsEventType =
  | "contact_created"
  | "followup_created"
  | "reminder_mock_sent"
  | "telegram_opened"
  | "followup_completed"
  | "meeting_booked"
  | "intro_made"
  | "followup_snoozed"
  | "profile_saved";

export interface User {
  id: string;
  telegram_id?: string;
  name: string;
  username?: string;
  role?: Role;
  looking_for?: string;
  can_help_with?: string;
  company?: string;
  is_visible: boolean;
  created_at: string;
}

export interface Program {
  id: string;
  name: string;
  slug: string;
  organizer_id: string;
  created_at: string;
}

export interface ProgramMember {
  id: string;
  program_id: string;
  user_id: string;
  joined_at: string;
}

export interface Contact {
  id: string;
  program_id: string;
  owner_user_id: string;
  target_user_id?: string;
  contact_name: string;
  contact_username?: string;
  source: ContactSource;
  connection_type: ConnectionType;
  context: string;
  next_step: string;
  created_at: string;
}

export interface FollowUp {
  id: string;
  contact_id: string;
  owner_user_id: string;
  remind_at: string;
  reminder_sent_at?: string;
  status: FollowUpStatus;
  outcome_type: FollowUpOutcomeType;
  completed_at?: string;
  created_at: string;
}

export interface AnalyticsEvent {
  id: string;
  program_id: string;
  user_id: string;
  type: AnalyticsEventType | string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface DemoDb {
  programs: Program[];
  users: User[];
  programMembers: ProgramMember[];
  contacts: Contact[];
  followUps: FollowUp[];
  analyticsEvents: AnalyticsEvent[];
}

export interface ProfileInput {
  name: string;
  role?: Role;
  looking_for?: string;
  can_help_with?: string;
  company?: string;
  is_visible: boolean;
}

export interface CreateContactInput {
  program_id: string;
  owner_user_id: string;
  target_user_id?: string;
  contact_name: string;
  contact_username?: string;
  source: ContactSource;
  connection_type?: ConnectionType;
  context: string;
  next_step: string;
}

export interface CreateFollowUpInput {
  contact_id: string;
  owner_user_id: string;
  remind_at: string;
}

export interface ParticipantStats {
  savedContacts: number;
  scheduledFollowUps: number;
  remindersSent: number;
  completedFollowUps: number;
  meetings: number;
  intros: number;
  results: number;
}

export interface OrganizerStats extends ParticipantStats {
  participants: number;
}

export interface FollowUpWithContact extends FollowUp {
  contact?: Contact;
  owner?: User;
}

export interface FollowUpLogRow {
  id: string;
  ownerName: string;
  contactName: string;
  nextStep: string;
  remindAt: string;
  status: FollowUpStatus;
  result: string;
}
