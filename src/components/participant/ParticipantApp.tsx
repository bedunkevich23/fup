import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Clock3, Plus, Search } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { hapticError, hapticSelection, hapticSuccess, openTelegramLink } from "../../lib/telegram";
import chevronLeftIconUrl from "../../assets/fup/chevron-left.svg";
import checklistIconUrl from "../../assets/fup/checklist.svg";
import fupLogoUrl from "../../assets/fup/logo.svg";
import personIconUrl from "../../assets/fup/person-2.svg";
import squareGridIconUrl from "../../assets/fup/square-grid.svg";
import starBackgroundUrl from "../../assets/fup/star-background.svg";
import xmarkIconUrl from "../../assets/fup/xmark.svg";
import { AppleSwitch } from "../ui/AppleSwitch";
import { ConnectionBadge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, SelectInput, TextArea, TextInput } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";

type ParticipantView = "today" | "people" | "save" | "followups" | "profile" | "contact";
type SaveMode = "manual" | "program";
type ToastKind = "success" | "error";
type AnyRecord = Record<string, any>;
type ToastState = { message: string; kind: ToastKind } | null;
type AsyncAction<T = unknown> = () => Promise<T>;

type AppActions = {
  notify: (message: string, kind?: ToastKind) => void;
  runAction: <T>(key: string, action: AsyncAction<T>, successMessage?: string) => Promise<T | undefined>;
  isPending: (key: string) => boolean;
  refresh: () => Promise<void>;
};

const roles = ["Основатель", "Студент", "Ментор", "Инвестор", "Эксперт", "Организатор"];
const roleToDb: Record<string, string> = {
  Основатель: "founder",
  Студент: "student",
  Ментор: "mentor",
  Инвестор: "investor",
  Эксперт: "expert",
  Организатор: "organizer",
};
const roleToRu: Record<string, string> = {
  founder: "Основатель",
  student: "Студент",
  mentor: "Ментор",
  investor: "Инвестор",
  expert: "Эксперт",
  organizer: "Организатор",
  other: "Основатель",
};
const places = ["Demo Day", "Менторская встреча", "Нетворкинг", "Чат", "Другое"];
const nextSteps = ["Написать", "Отправить материалы", "Назначить звонок", "Свой вариант"];
const reminders = [
  { label: "завтра", days: 1 },
  { label: "через 2 дня", days: 2 },
  { label: "через неделю", days: 7 },
  { label: "выбрать дату", days: 0 },
];
const statusLabel: Record<string, string> = {
  scheduled: "Запланировано",
  reminder_sent: "Напоминание отправлено",
  completed: "Выполнено",
  result: "Есть результат",
  snoozed: "Отложено",
  missed: "Пропущено",
  cancelled: "Отменено",
};

const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "Не задано";
const formatMeetingDate = (value?: string) => {
  if (!value) return "Недавно";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Сегодня";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
};

const remindAtFromDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
};
const minReminderDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};
const reminderAtFromDate = (value: string) => {
  const date = new Date(`${value}T10:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const fullName = (user: AnyRecord = {}) =>
  [user.first_name || user.telegram_first_name, user.last_name || user.telegram_last_name].filter(Boolean).join(" ") ||
  user.telegram_username ||
  "Участник";
const firstName = (user: AnyRecord = {}) => (user.first_name || user.telegram_first_name || fullName(user)).split(" ")[0];
const splitFullName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || "", last_name: parts.slice(1).join(" ") || "" };
};
const usernameOf = (user: AnyRecord = {}) => user.telegram_username || user.username || "";
const contactName = (contact: AnyRecord = {}, user?: AnyRecord) => {
  const freshUser = user || contact.target_user;
  return freshUser?.id ? fullName(freshUser) : contact.contact_name || "Контакт";
};
const contactStep = (contact: AnyRecord = {}) => contact.next_step_text || contact.next_step || "Написать";
const contactUsername = (contact: AnyRecord = {}) => contact.contact_username || usernameOf(contact.target_user || {});
const contactPlace = (contact: AnyRecord = {}) => contact.where_met === "Каталог участников" ? "Участник события" : contact.where_met || "На мероприятии";
const cleanContactContext = (contact: AnyRecord = {}) =>
  String(contact.context || "")
    .replace(/^Каталог участников\.\s*/i, "")
    .replace(/^Выбрано из списка участников программы\.?\s*/i, "")
    .replace(/^Анкета участника\.\s*/i, "")
    .replace(/\bИщет:\s*/gi, "")
    .replace(/\bМожет помочь:\s*/gi, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
const followUpDate = (followUp: AnyRecord = {}) => followUp.remind_at || followUp.due_at;
const followUpContact = (followUp: AnyRecord = {}) => followUp.contact || followUp.contacts || {};
const positiveGoal = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};
const metricCount = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
};
const assertJoinedEvent = (response: AnyRecord) => {
  if (response.event) return response;
  if (response.memberStatus === "invite_expired") {
    throw new Error("Код мероприятия истек. Попросите организатора новый код.");
  }
  throw new Error("Мероприятие с таким кодом не найдено");
};

export function ParticipantApp() {
  const [view, setView] = useState<ParticipantView>("today");
  const [me, setMe] = useState<AnyRecord | null>(null);
  const [event, setEvent] = useState<AnyRecord | null>(null);
  const [home, setHome] = useState<AnyRecord | null>(null);
  const [contacts, setContacts] = useState<AnyRecord[]>([]);
  const [followUps, setFollowUps] = useState<AnyRecord[]>([]);
  const [members, setMembers] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydratingEvent, setHydratingEvent] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [selectedContact, setSelectedContact] = useState<AnyRecord | null>(null);
  const [pendingVersion, setPendingVersion] = useState(0);
  const pendingRef = useRef(new Set<string>());

  const notify = (message: string, kind: ToastKind = "success") => {
    if (kind === "error") hapticError();
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 2400);
  };

  const refresh = async () => {
    const meData = (await apiClient.getMe()) as AnyRecord;
    const activeEvent = meData.activeEvents?.[0] || null;
    setMe(meData);
    setEvent(activeEvent);

    if (!activeEvent?.id) {
      setHome(null);
      setContacts([]);
      setFollowUps([]);
      setMembers([]);
      setHydratingEvent(false);
      setLoading(false);
      return;
    }

    setLoading(false);
    setHydratingEvent(true);
    try {
      const [homeData, contactsData, followUpsData, membersData] = await Promise.all([
        apiClient.getEventHome(activeEvent.id),
        apiClient.getContacts(activeEvent.id),
        apiClient.getFollowups(activeEvent.id),
        apiClient.getEventMembers(activeEvent.id),
      ]);
      const groupedFollowUps = followUpsData as AnyRecord;
      setHome(homeData as AnyRecord);
      setContacts(((contactsData as AnyRecord).contacts || []) as AnyRecord[]);
      setFollowUps([...(groupedFollowUps.today || []), ...(groupedFollowUps.upcoming || []), ...(groupedFollowUps.completed || [])]);
      setMembers(((membersData as AnyRecord).members || []) as AnyRecord[]);
    } finally {
      setHydratingEvent(false);
    }
  };

  const runAction = async <T,>(key: string, action: AsyncAction<T>, successMessage?: string) => {
    if (pendingRef.current.has(key)) return undefined;
    pendingRef.current.add(key);
    setPendingVersion((value) => value + 1);
    try {
      const result = await action();
      if (successMessage) notify(successMessage);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Действие не выполнено", "error");
      return undefined;
    } finally {
      pendingRef.current.delete(key);
      setPendingVersion((value) => value + 1);
    }
  };

  const actions: AppActions = {
    notify,
    runAction,
    isPending: (key) => pendingRef.current.has(key),
    refresh,
  };

  useEffect(() => {
    refresh().catch((error) => {
      notify(error instanceof Error ? error.message : "Не удалось загрузить данные", "error");
      setLoading(false);
    });
  }, []);

  return (
    <section
      className="fup-participant-shell mx-auto w-full max-w-[430px] overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.90),rgba(245,250,255,0.78))] shadow-[0_24px_70px_rgba(29,29,31,0.10)] backdrop-blur-3xl sm:my-5 sm:h-[min(860px,calc(100dvh-40px))] sm:rounded-[34px] sm:border sm:border-white/70"
      onChangeCapture={(event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && ["checkbox", "radio", "range"].includes(target.type))) {
          hapticSelection();
        }
      }}
    >
      <div className="relative flex h-full flex-col overflow-hidden">
        <HomeBackdrop />
        <div className="apple-scroll fup-safe-scroll no-scrollbar relative z-10 flex-1 overflow-y-auto px-4">
          {loading ? <LoadingScreen /> : null}
          {!loading && !me?.profileCompleted ? <ProfileScreen me={me} actions={actions} pendingVersion={pendingVersion} required /> : null}
          {!loading && me?.profileCompleted && !event && view !== "profile" ? <JoinEventScreen actions={actions} onProfile={() => setView("profile")} /> : null}
          {!loading && me?.profileCompleted && event && view === "today" ? <TodayScreen me={me} event={event} home={home} contacts={contacts} members={members} hydrating={hydratingEvent} onContacts={() => setView("people")} onProfile={() => setView("profile")} onContact={(contact) => { setSelectedContact(contact); setView("contact"); }} /> : null}
          {!loading && event && view === "people" ? <PeopleScreen event={event} members={members} contacts={contacts} me={me} actions={actions} /> : null}
          {!loading && event && view === "save" ? <SaveScreen event={event} members={members} contacts={contacts} me={me} actions={actions} onDone={() => setView("today")} /> : null}
          {!loading && event && view === "followups" ? <FollowUpsScreen followUps={followUps} actions={actions} /> : null}
          {!loading && view === "profile" ? <ProfileScreen me={me} actions={actions} pendingVersion={pendingVersion} /> : null}
          {!loading && me?.profileCompleted && event && view === "contact" && selectedContact ? <ContactDetailScreen contact={selectedContact} members={members} followUps={followUps} actions={actions} onBack={() => setView("today")} /> : null}
        </div>
        {me?.profileCompleted ? <BottomNav view={view} setView={setView} /> : null}
        <Toast toast={toast} />
      </div>
    </section>
  );
}

function BottomNav({ view, setView }: { view: ParticipantView; setView: (view: ParticipantView) => void }) {
  const nav = [
    { id: "today" as const, label: "Главная", iconUrl: squareGridIconUrl },
    { id: "people" as const, label: "Контакты", iconUrl: personIconUrl },
    { id: "followups" as const, label: "Задачи", iconUrl: checklistIconUrl },
  ];

  return (
    <div className="fup-bottom-dock absolute inset-x-4 z-20 flex items-end gap-3">
      <nav className="fup-bottom-nav grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-[30px] p-1">
        {nav.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`button-press fup-tab flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[24px] px-1 text-[11px] font-semibold transition ${
                active ? "is-active text-[#0087ff]" : "text-[#171717] hover:bg-white/38"
              }`}
            >
              <NavIcon url={item.iconUrl} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <button
        aria-label="Добавить контакт"
        className={`button-press fup-add-button flex size-[64px] shrink-0 items-center justify-center rounded-full text-[#0087ff] ${view === "save" ? "is-active" : ""}`}
        onClick={() => setView("save")}
      >
        <Plus size={33} strokeWidth={2.2} />
      </button>
    </div>
  );
}

function NavIcon({ url }: { url: string }) {
  return <img aria-hidden alt="" className="fup-nav-icon" src={url} />;
}

function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div className="fup-toast-safe pointer-events-none absolute inset-x-4 z-40 flex justify-center">
      <div className={`glass animate-[shelfIn_260ms_ease_both] rounded-full px-4 py-3 text-center text-[14px] font-semibold shadow-[0_16px_42px_rgba(29,29,31,0.12)] ${toast.kind === "error" ? "text-rose-500" : "text-[#1d1d1f]"}`}>
        {toast.message}
      </div>
    </div>
  );
}

function Avatar({ user, size = "md" }: { user?: AnyRecord; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "size-16 rounded-[24px] text-xl" : size === "sm" ? "size-10 rounded-[15px] text-sm" : "size-12 rounded-[18px] text-base";
  const name = fullName(user || {});
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join("")
    .toUpperCase();
  const avatarUrl = user?.avatar_url || user?.telegram_photo_url;
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={`${sizeClass} object-cover shadow-[0_10px_28px_rgba(0,113,227,0.16)]`} />;
  }
  return (
    <div className={`${sizeClass} liquid-blue flex items-center justify-center font-semibold text-white shadow-[0_10px_28px_rgba(0,113,227,0.16)]`}>
      {initials || "F"}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center">
      <div className="fup-panel w-full rounded-[38px] p-6 text-center">
        <img src={fupLogoUrl} alt="FUP" className="mx-auto h-[42px] w-auto" />
        <h1 className="mt-4 text-2xl font-semibold">Собираем ваши полочки</h1>
        <p className="mt-2 text-[14px] leading-6 text-slate-500">Загружаем профиль, контакты и follow-ups из FUP.</p>
      </div>
    </div>
  );
}

function JoinEventScreen({ actions, onProfile }: { actions: AppActions; onProfile: () => void }) {
  const [inviteCode, setInviteCode] = useState("");
  const joinKey = "join-event-code";

  const join = async () => {
    const code = inviteCode.trim();
    if (!code) {
      actions.notify("Введите код мероприятия", "error");
      return;
    }
    const result = (await actions.runAction(
      joinKey,
      async () => {
        const response = (await apiClient.joinEvent(code)) as AnyRecord;
        return assertJoinedEvent(response);
      },
      "Вы подключились к мероприятию",
    )) as AnyRecord | undefined;
    if (!result?.event) return;
    hapticSuccess();
    await actions.refresh();
  };

  return (
    <div className="flex min-h-[calc(100dvh-180px)] flex-col justify-center gap-5 py-4">
      <Card className="p-6">
        <div className="liquid-blue flex size-14 items-center justify-center rounded-[20px] text-xl font-semibold text-white">
          F
        </div>
        <p className="mt-6 text-[13px] font-semibold uppercase text-[#0066cc]">Подключение</p>
        <h1 className="mt-2 text-[34px] font-semibold leading-tight">Введите код мероприятия</h1>
        <p className="mt-3 text-[15px] leading-6 text-slate-600">
          Код есть на QR и в приглашении организатора. После подключения откроются анкеты участников, контакты и напоминания.
        </p>
        <label className="mt-5 block">
          <span className="mb-2 block text-[13px] font-semibold text-slate-500">Код мероприятия</span>
          <input
            autoCapitalize="none"
            autoComplete="one-time-code"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void join();
            }}
            placeholder="demo2026"
            className="h-14 w-full rounded-[24px] border border-white/70 bg-white/62 px-4 text-[17px] font-semibold tracking-[0] outline-none ring-[#0071e3]/15 transition placeholder:font-medium placeholder:text-slate-400 focus:ring-4"
          />
        </label>
        <Button className="mt-4 w-full" onClick={join} disabled={actions.isPending(joinKey)}>
          {actions.isPending(joinKey) ? "Подключаем..." : "Подключиться"}
        </Button>
      </Card>
      <button className="liquid-control button-press rounded-full px-5 py-3 text-[14px] font-semibold text-[#0066cc]" onClick={onProfile}>
        Открыть профиль
      </button>
    </div>
  );
}

function Shelf({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`fup-panel rounded-[34px] p-4 ${className}`}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h3 className="fup-shelf-title text-[18px] font-semibold leading-tight text-black">{title}</h3>
          {subtitle ? <p className="mt-1 text-[13px] leading-5 text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-slate-200/70 to-transparent" />
      </div>
      {children}
    </section>
  );
}

function useIntroCopy(introKey?: string) {
  const storageKey = introKey ? `fup:intro:${introKey}` : "";
  const [visible, setVisible] = useState(() => {
    if (!introKey) return true;
    try {
      return window.sessionStorage.getItem(storageKey) !== "seen";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!introKey || !visible) return undefined;
    const timer = window.setTimeout(() => {
      setVisible(false);
      try {
        window.sessionStorage.setItem(storageKey, "seen");
      } catch {
        // Session storage is optional inside embedded browsers.
      }
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [introKey, storageKey, visible]);

  return visible;
}

function ParticipantHeader({ kicker, title, description, introKey }: { kicker?: string; title?: string; description?: string; introKey?: string }) {
  const heading = title || kicker;
  const showDescription = useIntroCopy(introKey);
  return (
    <header className="fup-screen-header px-2 pt-1">
      {title && kicker ? <p className="text-[12px] font-semibold uppercase text-[#0072fc]">{kicker}</p> : null}
      {heading ? <h1 className={`fup-display text-[27px] leading-[1.08] text-black ${title && kicker ? "mt-2" : ""}`}>{heading}</h1> : null}
      {description ? (
        <p className={`fup-intro-copy ${showDescription ? "is-visible" : "is-hidden"} ${heading ? "mt-3" : "mt-2"} max-w-[31ch] text-[14px] leading-6 text-[#5f6873]`}>
          {description}
        </p>
      ) : null}
    </header>
  );
}

function IconCircleButton({ iconUrl, label, onClick, className = "" }: { iconUrl: string; label: string; onClick: () => void; className?: string }) {
  return (
    <button aria-label={label} className={`apple-icon-button button-press ${className}`} onClick={onClick}>
      <span aria-hidden className="apple-icon-mask" style={{ WebkitMaskImage: `url(${iconUrl})`, maskImage: `url(${iconUrl})` }} />
    </button>
  );
}

function EmptyGlassState({ children }: { children: ReactNode }) {
  return <p className="fup-empty rounded-[26px] px-4 py-5 text-[13px] leading-5 text-[#6b7480]">{children}</p>;
}

function CompactInfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="fup-subpanel rounded-[20px] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-[#0087ff]">{label}</p>
      <p className="mt-1 text-[13px] leading-5 text-slate-600">{value}</p>
    </div>
  );
}

function HomeBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-white">
      <img className="fup-home-star fup-home-star-top" src={starBackgroundUrl} alt="" />
      <img className="fup-home-star fup-home-star-left" src={starBackgroundUrl} alt="" />
      <img className="fup-home-star fup-home-star-right" src={starBackgroundUrl} alt="" />
      <img className="fup-home-star fup-home-star-bottom" src={starBackgroundUrl} alt="" />
      <div className="fup-home-haze" />
    </div>
  );
}

function TodayScreen({
  me,
  event,
  home,
  contacts,
  members,
  hydrating,
  onContacts,
  onProfile,
  onContact,
}: {
  me: AnyRecord | null;
  event: AnyRecord | null;
  home: AnyRecord | null;
  contacts: AnyRecord[];
  members: AnyRecord[];
  hydrating: boolean;
  onContacts: () => void;
  onProfile: () => void;
  onContact: (contact: AnyRecord) => void;
}) {
  const stats = home?.stats || {};
  const recentContacts: AnyRecord[] = (home?.latestContacts?.length ? home.latestContacts : contacts).slice(0, 2);
  const latestAvatars: AnyRecord[] = contacts.slice(0, 3);
  const savedContacts = metricCount(stats.saved_contacts) ?? contacts.length;
  const eventData = home?.event || event || {};
  const contactGoal = positiveGoal(eventData.goal_contacts_per_user) || 3;
  const goalChecks = [
    { target: contactGoal, current: savedContacts },
    { target: positiveGoal(eventData.goal_messages_per_user), current: positiveGoal(stats.completed_followups) },
    { target: positiveGoal(eventData.goal_results_per_user), current: positiveGoal(stats.results) },
  ].filter((goal) => goal.target > 0);
  const inferredTotalGoals = (Array.isArray(eventData.goals) ? eventData.goals.length : 0) || goalChecks.length || 3;
  const totalGoals = metricCount(stats.total_active_event_goals) ?? inferredTotalGoals;
  const inferredCompletedGoals = goalChecks.filter((goal) => goal.current >= goal.target).length || positiveGoal(stats.completed_followups);
  const completedGoals = Math.min(
    totalGoals,
    metricCount(stats.completed_event_goals) ?? inferredCompletedGoals,
  );
  const publicName = me?.user?.public_name || me?.user?.first_name || me?.user?.telegram_first_name || "";

  return (
    <div className="fup-home space-y-6 pb-3 pt-2">
      <header className="animate-[shelfIn_360ms_ease_both] px-2 pt-1">
        <div className="flex items-center justify-between gap-4">
          <img src={fupLogoUrl} alt="FUP" className="h-[42px] w-auto" />
          <button aria-label="Открыть профиль" className="button-press rounded-full" onClick={onProfile}>
            <RoundAvatar user={me?.user} label={publicName || fullName(me?.user || {})} className="size-[74px]" />
          </button>
        </div>
        <h1 className="fup-display mt-8 text-[27px] leading-[1.08] text-black">
          {publicName ? `Привет, ${publicName}!` : "Привет!"}
        </h1>
      </header>

      {hydrating && !home ? (
        <HomeDataSkeleton />
      ) : (
        <>
          <section className="fup-progress-shell animate-[shelfIn_460ms_ease_both] rounded-[38px] p-4">
            <div className="grid grid-cols-2 gap-3">
              <HomeProgressCard label="Сохранено" value={`${savedContacts} / ${contactGoal}`}>
                <div className="mt-auto flex min-h-12 items-end justify-end">
                  <div className="flex items-center pr-1">
                    {latestAvatars.map((contact, index) => (
                      <RoundAvatar
                        key={contact.id || `${contactName(contact)}-${index}`}
                        user={contactUser(contact, members)}
                        label={contactName(contact, contactUser(contact, members))}
                        className={`size-11 border-2 border-white/70 ${index ? "-ml-3" : ""}`}
                      />
                    ))}
                  </div>
                </div>
              </HomeProgressCard>
              <HomeProgressCard label="Выполнено" value={`${completedGoals} / ${totalGoals}`} />
            </div>
          </section>

          <section className="space-y-6 animate-[shelfIn_560ms_ease_both]">
            <h2 className="fup-display px-2 text-[25px] leading-[1.1] text-black">Последние встречи</h2>
            <div className="fup-meetings-shell rounded-[38px] p-3">
              <div className="space-y-3">
                {recentContacts.map((contact) => <RecentMeetingCard key={contact.id} contact={contact} user={contactUser(contact, members)} onOpen={() => onContact(contact)} />)}
                {!recentContacts.length ? (
                  <div className="fup-meeting-card rounded-[32px] px-5 py-8 text-center text-[14px] leading-6 text-[#6f7780]">
                    Здесь появятся последние сохраненные встречи.
                  </div>
                ) : null}
              </div>
              <button className="button-press fup-muted-action mt-3" onClick={onContacts}>
                Открыть еще
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function HomeDataSkeleton() {
  return (
    <div className="space-y-4 animate-[shelfIn_420ms_ease_both]">
      <section className="fup-progress-shell rounded-[38px] p-4">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1].map((item) => (
            <div key={item} className="fup-progress-card min-h-[136px] rounded-[29px] p-4">
              <div className="h-5 w-20 animate-pulse rounded-full bg-white/70" />
              <div className="mt-5 h-9 w-16 animate-pulse rounded-full bg-white/75" />
              <div className="mt-6 h-8 w-24 animate-pulse rounded-full bg-white/60" />
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <div className="mx-2 h-7 w-48 animate-pulse rounded-full bg-white/70" />
        <div className="fup-meetings-shell rounded-[38px] p-3">
          {[0, 1].map((item) => (
            <div key={item} className="fup-meeting-card mb-3 rounded-[30px] p-4">
              <div className="flex gap-3">
                <div className="size-16 animate-pulse rounded-full bg-white/75" />
                <div className="flex-1 pt-2">
                  <div className="h-5 w-32 animate-pulse rounded-full bg-white/75" />
                  <div className="mt-3 h-4 w-24 animate-pulse rounded-full bg-white/60" />
                </div>
              </div>
              <div className="mt-4 h-16 animate-pulse rounded-[22px] bg-white/55" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HomeProgressCard({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="fup-progress-card flex min-h-[136px] flex-col rounded-[29px] p-4">
      <p className="text-[15px] font-medium text-black">{label}</p>
      <p className="mt-2 text-[33px] font-bold leading-none tracking-[0] text-black">{value}</p>
      {children}
    </div>
  );
}

function contactUser(contact: AnyRecord, members: AnyRecord[]) {
  return members.find((member) => member.id === contact.target_user_id) || contact.target_user || contact.user;
}

function RoundAvatar({ user, label, className = "size-12" }: { user?: AnyRecord; label?: string; className?: string }) {
  const name = label || fullName(user || {});
  const avatarUrl = user?.avatar_url || user?.telegram_photo_url || user?.photo_url;
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join("")
    .toUpperCase();

  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={`${className} rounded-full object-cover shadow-[0_12px_30px_rgba(23,45,68,0.14)]`} />;
  }

  return (
    <span className={`${className} fup-avatar-fallback flex shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-[#0072fc]`}>
      {initials || "F"}
    </span>
  );
}

function RecentMeetingCard({ contact, user, onOpen }: { contact: AnyRecord; user?: AnyRecord; onOpen: () => void }) {
  const username = contactUsername(contact) || usernameOf(user || {});
  const context = cleanContactContext(contact);
  const name = contactName(contact, user);
  return (
    <button className="button-press fup-meeting-card block w-full rounded-[30px] p-4 text-left" onClick={onOpen}>
      <div className="flex items-start gap-3">
        <RoundAvatar user={user} label={name} className="size-16" />
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[21px] font-bold leading-none text-black">{name}</h3>
              {username ? <p className="mt-2 truncate text-[16px] font-medium text-[#0087ff]">@{username.replace(/^@/, "")}</p> : null}
            </div>
            <time className="shrink-0 pt-0.5 text-[12px] font-medium text-[#838b94]">{formatMeetingDate(contact.created_at)}</time>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[16px] font-bold leading-tight text-black">{contactPlace(contact)}</p>
      </div>
      {context ? <p className="fup-subpanel mt-3 line-clamp-3 rounded-[22px] px-3 py-2 text-[14px] leading-5 text-black">{context}</p> : null}
      <div className="fup-meeting-action mt-4 inline-flex h-11 max-w-full items-center justify-center rounded-full bg-[#0087ff] px-4 text-[13px] font-medium text-white shadow-[0_10px_24px_rgba(0,135,255,0.24)]">
        <span className="truncate text-center">{contactStep(contact)}</span>
      </div>
    </button>
  );
}

function PeopleScreen({ event, members, contacts, me, actions }: { event: AnyRecord | null; members: AnyRecord[]; contacts: AnyRecord[]; me: AnyRecord | null; actions: AppActions }) {
  const [query, setQuery] = useState("");
  const currentUserId = me?.user?.id;
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const visibleMembers = useMemo(
    () =>
      members
        .filter((member) => member.id !== currentUserId)
        .filter((member) => {
          if (!normalizedQuery) return true;
          return [fullName(member), member.role, member.company, member.field, member.looking_for, member.can_help_with]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        }),
    [currentUserId, members, normalizedQuery],
  );
  const savedMemberIds = useMemo(() => new Set(contacts.map((contact) => contact.target_user_id).filter(Boolean)), [contacts]);

  if (!event) {
    return (
      <div className="fup-screen space-y-5 py-2">
        <Card className="p-6 text-center">
          <h1 className="text-2xl font-semibold">Нет активного мероприятия</h1>
          <p className="mt-3 text-[14px] leading-6 text-slate-500">Каталог появится после подключения к мероприятию по QR или invite-ссылке.</p>
        </Card>
      </div>
    );
  }

  if (me?.user?.is_visible === false) {
    return (
      <div className="fup-screen space-y-4 py-1">
        <ParticipantHeader kicker="Контакты" introKey="people-hidden" description="Каталог участников доступен, когда ваша анкета видна другим." />
        <EmptyGlassState>Включите видимость в профиле, чтобы искать людей и сохранять контакты из каталога.</EmptyGlassState>
      </div>
    );
  }

  return (
    <div className="fup-screen space-y-4 py-1">
      <ParticipantHeader
        kicker="Контакты"
        introKey="people"
        description="Смотрите анкеты участников и сохраняйте тех, к кому важно вернуться после встречи."
      />
      <div className="fup-control flex h-14 items-center gap-2 rounded-[28px] px-4">
        <Search size={18} className="text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по роли, компании или запросу"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="w-full bg-transparent text-[16px] outline-none placeholder:text-slate-400"
        />
      </div>
      <div className="space-y-3">
        {visibleMembers.map((member) => {
          const key = `people-save-${member.id}`;
          const saved = savedMemberIds.has(member.id);
          return (
            <article key={member.id} className="fup-card rounded-[32px] p-4">
              <div className="flex items-start gap-3">
                <RoundAvatar user={member} label={fullName(member)} className="size-14" />
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[17px] font-semibold text-black">{fullName(member)}</p>
                      <p className="mt-1 text-[13px] text-slate-500">{roleToRu[member.role] || member.role || "Участник"}{member.company ? ` · ${member.company}` : ""}</p>
                    </div>
                    <ConnectionBadge type="internal" />
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-2">
                <CompactInfoBlock label="Ищет" value={member.looking_for || "Не указано"} />
                <CompactInfoBlock label="Может помочь" value={member.can_help_with || "Не указано"} />
              </div>
              {saved ? (
                <span className="fup-confirm-action mt-4">Уже в контактах</span>
              ) : (
                <Button
                  className="mt-4 w-full"
                  disabled={actions.isPending(key)}
                  onClick={async () => {
                      const result = (await actions.runAction(
                        key,
                        async () =>
                          apiClient.createContact(event.id, {
                            targetUserId: member.id,
                            contactName: fullName(member),
                            contactUsername: usernameOf(member),
                            source: "program_member",
                            whereMet: "Каталог участников",
                            context: [member.looking_for, member.can_help_with].filter(Boolean).join("\n"),
                            nextStepType: "Написать",
                            nextStepText: "Написать",
                            remindAt: remindAtFromDays(1),
                          }),
                        "Знакомство сохранено",
                      )) as AnyRecord | undefined;
                      if (!result) return;
                      hapticSuccess();
                      await actions.refresh();
                  }}
                >
                  {actions.isPending(key) ? "Сохраняем..." : "Сохранить"}
                </Button>
              )}
            </article>
          );
        })}
        {!visibleMembers.length ? <EmptyGlassState>Подходящих участников пока нет.</EmptyGlassState> : null}
      </div>
    </div>
  );
}

function SaveScreen({ event, members, contacts, me, actions, onDone }: { event: AnyRecord | null; members: AnyRecord[]; contacts: AnyRecord[]; me: AnyRecord | null; actions: AppActions; onDone: () => void }) {
  const programEnabled = me?.user?.is_visible !== false;
  const [mode, setMode] = useState<SaveMode>(programEnabled ? "program" : "manual");

  if (!event) {
    return (
      <div className="fup-screen space-y-5 py-2">
        <Card className="p-6 text-center">
          <h1 className="text-2xl font-semibold">Нет активного мероприятия</h1>
          <p className="mt-3 text-[14px] leading-6 text-slate-500">Чтобы сохранять знакомства, откройте invite-ссылку или QR от организатора.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="fup-screen space-y-4 py-1">
      <ParticipantHeader
        kicker="Новый контакт"
        introKey="save"
        description="Сохраните человека, контекст разговора и следующий шаг в одной карточке."
      />

      <SegmentedControl
        value={mode}
        onChange={setMode}
        options={programEnabled ? [{ value: "program", label: "Из участников" }, { value: "manual", label: "Вручную" }] : [{ value: "manual", label: "Вручную" }]}
      />

      {mode === "manual" || !programEnabled ? <ManualSaveForm event={event} actions={actions} /> : <ProgramMemberPicker event={event} members={members} contacts={contacts} me={me} actions={actions} onSaved={onDone} />}
    </div>
  );
}

function ManualSaveForm({ event, actions }: { event: AnyRecord; actions: AppActions }) {
  const [contactNameValue, setContactNameValue] = useState("");
  const [username, setUsername] = useState("");
  const [place, setPlace] = useState("Demo Day");
  const [context, setContext] = useState("");
  const [nextStep, setNextStep] = useState("Написать");
  const [customNextStep, setCustomNextStep] = useState("");
  const [reminder, setReminder] = useState("завтра");
  const [reminderDate, setReminderDate] = useState(minReminderDate());
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    if (!contactNameValue.trim()) {
      actions.notify("Введите имя контакта", "error");
      return;
    }
    const step = nextStep === "Свой вариант" ? customNextStep || "Вернуться позже" : nextStep;
    const remindAt = reminder === "выбрать дату"
      ? reminderAtFromDate(reminderDate)
      : remindAtFromDays(reminders.find((item) => item.label === reminder)?.days ?? 1);
    if (!remindAt) {
      actions.notify("Выберите дату напоминания", "error");
      return;
    }
    const result = (await actions.runAction(
      "save-contact-manual",
      async () =>
        apiClient.createContact(event.id, {
          contactName: contactNameValue.trim(),
          contactUsername: username.replace("@", "").replace("https://t.me/", ""),
          source: "manual",
          whereMet: place,
          context: `${place}. ${context}`.trim(),
          nextStepType: step,
          nextStepText: step,
          remindAt,
        }),
      "Знакомство сохранено",
    )) as AnyRecord | undefined;

    if (!result) return;
    hapticSuccess();
    await actions.refresh();
    setSuccess(true);
    setContactNameValue("");
    setUsername("");
    setContext("");
  };

  if (success) {
    return (
      <div className="fup-panel animate-[shelfIn_480ms_ease_both] rounded-[34px] p-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-[22px] bg-emerald-500 text-white shadow-[0_14px_30px_rgba(52,199,89,0.24)]">
          <Check size={28} />
        </div>
        <h2 className="mt-4 text-2xl font-semibold">Знакомство разложено по полочкам</h2>
        <p className="mt-2 text-[14px] leading-6 text-slate-600">Готово — напомним вовремя.</p>
        <Button className="mt-5 w-full" onClick={() => setSuccess(false)}>
          Сохранить еще одно
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Shelf title="Кто это">
        <div className="space-y-3">
          <Field label="Имя контакта"><TextInput value={contactNameValue} onChange={(event) => setContactNameValue(event.target.value)} /></Field>
          <Field label="Telegram username или ссылка"><TextInput value={username} onChange={(event) => setUsername(event.target.value)} placeholder="@username" /></Field>
        </div>
      </Shelf>
      <Shelf title="О чем говорили">
        <div className="space-y-3">
          <Field label="Где познакомились"><SelectInput value={place} onChange={(event) => setPlace(event.target.value)}>{places.map((item) => <option key={item}>{item}</option>)}</SelectInput></Field>
          <Field label="Контекст"><TextArea value={context} onChange={(event) => setContext(event.target.value)} /></Field>
        </div>
      </Shelf>
      <Shelf title="Что сделать дальше">
        <div className="space-y-3">
          <Field label="Следующий шаг"><SelectInput value={nextStep} onChange={(event) => setNextStep(event.target.value)}>{nextSteps.map((item) => <option key={item}>{item}</option>)}</SelectInput></Field>
          {nextStep === "Свой вариант" ? <Field label="Свой вариант"><TextInput value={customNextStep} onChange={(event) => setCustomNextStep(event.target.value)} /></Field> : null}
          <Field label="Напомнить"><SelectInput value={reminder} onChange={(event) => setReminder(event.target.value)}>{reminders.map((item) => <option key={item.label}>{item.label}</option>)}</SelectInput></Field>
          {reminder === "выбрать дату" ? (
            <Field label="Дата напоминания">
              <TextInput type="date" min={minReminderDate()} value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} />
            </Field>
          ) : null}
        </div>
      </Shelf>
      <Button className="w-full" onClick={submit} disabled={actions.isPending("save-contact-manual")}>
        {actions.isPending("save-contact-manual") ? "Сохраняем..." : "Сохранить и напомнить"}
      </Button>
    </div>
  );
}

function ProgramMemberPicker({ event, members, contacts, me, actions, onSaved }: { event: AnyRecord; members: AnyRecord[]; contacts: AnyRecord[]; me: AnyRecord | null; actions: AppActions; onSaved: () => void }) {
  const currentUserId = me?.user?.id;
  const visibleMembers = useMemo(() => members.filter((member) => member.id !== currentUserId), [currentUserId, members]);
  const savedMemberIds = useMemo(() => new Set(contacts.map((contact) => contact.target_user_id).filter(Boolean)), [contacts]);

  return (
    <Shelf title="Выбрать из участников" subtitle="Сохраняйте людей из каталога мероприятия в один шаг">
      <div className="space-y-3">
        {visibleMembers.slice(0, 4).map((member) => {
          const key = `save-member-${member.id}`;
          const saved = savedMemberIds.has(member.id);
          return (
            <div key={member.id} className="fup-card rounded-[28px] p-4">
              <div className="flex items-start gap-3">
                <RoundAvatar user={member} label={fullName(member)} className="size-12" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{fullName(member)}</p>
                      <p className="mt-1 text-[13px] text-slate-500">{roleToRu[member.role] || member.role || "Участник"} · {member.company || member.field || "FUP"}</p>
                    </div>
                    <ConnectionBadge type="internal" />
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <CompactInfoBlock label="Может помочь" value={member.can_help_with || "Профиль пока не заполнен."} />
              </div>
              {saved ? <span className="fup-confirm-action mt-4">Уже в контактах</span> : <Button
                className="mt-4 w-full"
                disabled={actions.isPending(key)}
                onClick={async () => {
                  const result = (await actions.runAction(
                    key,
                    async () =>
                      apiClient.createContact(event.id, {
                        targetUserId: member.id,
                        contactName: fullName(member),
                        contactUsername: usernameOf(member),
                        source: "program_member",
                        whereMet: "Каталог участников",
                        context: member.looking_for || member.can_help_with || "",
                        nextStepType: "Написать",
                        nextStepText: "Написать",
                        remindAt: remindAtFromDays(1),
                      }),
                    "Участник сохранен",
                  )) as AnyRecord | undefined;
                  if (!result) return;
                  hapticSuccess();
                  await actions.refresh();
                  onSaved();
                }}
              >
                {actions.isPending(key) ? "Сохраняем..." : "Сохранить"}
              </Button>}
            </div>
          );
        })}
        {!visibleMembers.length ? <EmptyGlassState>В каталоге пока нет других участников.</EmptyGlassState> : null}
      </div>
    </Shelf>
  );
}

function FollowUpsScreen({ followUps, actions }: { followUps: AnyRecord[]; actions: AppActions }) {
  const [nextAction, setNextAction] = useState<{ followUp: AnyRecord; action: "message_sent" | "meeting_booked"; message: string } | null>(null);
  const today = new Date().toDateString();
  const groups = [
    {
      title: "Сегодня",
      empty: "На сегодня чисто. Новые действия появятся здесь, когда подойдет время.",
      items: followUps.filter((item) => new Date(followUpDate(item)).toDateString() === today && !["completed", "result"].includes(item.status)),
    },
    {
      title: "Скоро",
      empty: "Пока пусто. FUP положит сюда задачи, которые запланированы на следующие дни.",
      items: followUps.filter((item) => new Date(followUpDate(item)).toDateString() !== today && !["completed", "result"].includes(item.status)),
    },
    {
      title: "Выполнено",
      empty: "Готовых действий пока нет. Как только отметите шаг, он появится здесь.",
      items: followUps.filter((item) => item.status === "completed" || item.status === "result"),
    },
  ];

  return (
    <div className="fup-screen space-y-4 py-1">
      <ParticipantHeader
        kicker="Задачи"
        introKey="followups"
        description="Здесь лежат напоминания и действия по встречам, которые еще нужно довести до результата."
      />
      {groups.map((group) => (
        <Shelf key={group.title} title={group.title} className="fup-task-shelf">
          <div className="space-y-3">
            {group.items.length ? group.items.map((item) => <FollowUpCard key={item.id} followUp={item} actions={actions} onNextAction={(action, message) => setNextAction({ followUp: item, action, message })} />) : <EmptyGlassState>{group.empty}</EmptyGlassState>}
          </div>
        </Shelf>
      ))}
      {nextAction ? <NextReminderModal {...nextAction} actions={actions} onClose={() => setNextAction(null)} /> : null}
    </div>
  );
}

function followUpCardDate(followUp: AnyRecord) {
  return ["completed", "result"].includes(followUp.status)
    ? followUp.result_at || followUp.completed_at || followUp.updated_at || followUpDate(followUp)
    : followUpDate(followUp);
}

function FollowUpCard({
  followUp,
  actions,
  onNextAction,
}: {
  followUp: AnyRecord;
  actions: AppActions;
  onNextAction: (action: "message_sent" | "meeting_booked", message: string) => void;
}) {
  const contact = followUpContact(followUp);
  if (!contact?.id) return null;
  const active = !["completed", "result"].includes(followUp.status);

  return (
    <div className="fup-card rounded-[28px] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[17px] font-semibold text-black">{contactName(contact)}</p>
          <p className="mt-1 text-[13px] text-slate-500">
            {["completed", "result"].includes(followUp.status) ? "Последнее действие: " : "Сделать до: "}
            {formatDate(followUpCardDate(followUp))}
          </p>
        </div>
        <span className="fup-subpanel rounded-full px-3 py-1 text-[11px] font-semibold text-slate-500">{statusLabel[followUp.status] || followUp.status}</span>
      </div>
      {cleanContactContext(contact) ? <p className="mt-3 text-[13px] leading-5 text-slate-600">{cleanContactContext(contact)}</p> : null}
      <p className="mt-3 text-[13px] font-semibold text-[#1d1d1f]">Следующий шаг: {contactStep(contact)}</p>
      {active ? (
        <div className="fup-action-grid mt-4 grid grid-cols-2 gap-2">
          {contactUsername(contact) ? (
            <Button
              className="col-span-2"
              variant="primary"
              disabled={actions.isPending(`followup-${followUp.id}-telegram-opened`)}
              onClick={async () => {
                await actions.runAction(
                  `followup-${followUp.id}-telegram-opened`,
                  async () => apiClient.updateFollowupAction(followUp.id, { action: "telegram_opened" }),
                );
                openTelegramLink(contactUsername(contact));
                actions.notify("Telegram открыт. Это намерение, не выполненный follow-up.");
              }}
            >
              Открыть Telegram
            </Button>
          ) : null}
          <Button variant="soft" onClick={() => onNextAction("message_sent", "Сообщение отмечено")}>Я написал</Button>
          <Button variant="soft" onClick={() => onNextAction("meeting_booked", "Встреча отмечена")}>Назначил встречу</Button>
          <Button
            className="col-span-2"
            variant="ghost"
            disabled={actions.isPending(`followup-${followUp.id}-delete`)}
            onClick={async () => {
              const result = await actions.runAction(
                `followup-${followUp.id}-delete`,
                async () => apiClient.deleteFollowup(followUp.id),
                "Задача удалена",
              );
              if (!result) return;
              await actions.refresh();
            }}
          >
            Удалить задачу
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NextReminderModal({
  followUp,
  action,
  message,
  actions,
  onClose,
}: {
  followUp: AnyRecord;
  action: "message_sent" | "meeting_booked";
  message: string;
  actions: AppActions;
  onClose: () => void;
}) {
  const [date, setDate] = useState(minReminderDate());
  const key = `followup-${followUp.id}-${action}-next`;

  const complete = async (nextReminderAt?: string) => {
    const result = await actions.runAction(
      key,
      async () => apiClient.updateFollowupAction(followUp.id, { action, nextReminderAt }),
      nextReminderAt ? `${message}. Следующая задача поставлена` : message,
    );
    if (!result) return;
    hapticSuccess();
    await actions.refresh();
    onClose();
  };

  return (
    <div className="fup-reminder-backdrop fixed inset-0 z-30 flex items-end justify-center p-4 pb-[max(16px,var(--tg-content-safe-area-inset-bottom,0px))]">
      <div className="fup-reminder-sheet w-full max-w-[398px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-[#0066cc]">Следующий шаг</p>
            <h3 className="mt-1 text-[23px] font-semibold leading-tight text-black">Когда вернуться к контакту?</h3>
          </div>
          <IconCircleButton iconUrl={xmarkIconUrl} label="Закрыть" onClick={onClose} />
        </div>
        <p className="mt-3 text-[14px] leading-6 text-slate-600">Текущее действие уйдет в выполненные, а FUP создаст новую задачу на выбранную дату.</p>
        <Field label="Дата следующего напоминания">
          <TextInput type="date" min={minReminderDate()} value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <div className="mt-4 grid gap-2">
          <Button disabled={actions.isPending(key)} onClick={() => void complete(reminderAtFromDate(date))}>
            Поставить напоминание
          </Button>
          <Button disabled={actions.isPending(key)} variant="ghost" onClick={() => void complete()}>
            Отметить без новой даты
          </Button>
        </div>
      </div>
    </div>
  );
}

function ContactDetailScreen({
  contact,
  members,
  followUps,
  actions,
  onBack,
}: {
  contact: AnyRecord;
  members: AnyRecord[];
  followUps: AnyRecord[];
  actions: AppActions;
  onBack: () => void;
}) {
  const user = contactUser(contact, members);
  const username = contactUsername(contact) || usernameOf(user || {});
  const followUp = followUps.find((item) => followUpContact(item)?.id === contact.id);
  const activeFollowUp = followUp && !["completed", "result"].includes(followUp.status) ? followUp : null;
  const context = cleanContactContext(contact);
  const [nextAction, setNextAction] = useState<{ action: "message_sent" | "meeting_booked"; message: string } | null>(null);
  const openChat = async () => {
    if (!username) {
      actions.notify("У контакта нет Telegram username", "error");
      return;
    }
    if (followUp?.id) {
      await actions.runAction(`detail-${followUp.id}-telegram`, async () => apiClient.updateFollowupAction(followUp.id, { action: "telegram_opened" }));
    }
    openTelegramLink(username);
    actions.notify("Открыли Telegram чат");
  };

  return (
    <div className="fup-screen space-y-4 py-1">
      <IconCircleButton iconUrl={chevronLeftIconUrl} label="Назад" className="apple-icon-button--back" onClick={onBack} />
      <section className="fup-panel rounded-[36px] p-5">
        <div className="flex items-start gap-4">
          <RoundAvatar user={user} label={contactName(contact, user)} className="size-[76px]" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase text-[#0072fc]">{contactPlace(contact)}</p>
            <h1 className="mt-2 text-[28px] font-semibold leading-none text-black">{contactName(contact, user)}</h1>
            {username ? <p className="mt-2 truncate text-[15px] font-semibold text-[#0087ff]">@{username.replace(/^@/, "")}</p> : null}
          </div>
        </div>
        <div className="mt-5 grid gap-2">
          {user?.role || user?.company ? <p className="fup-subpanel rounded-[22px] px-3 py-2 text-[14px] text-slate-700">{roleToRu[user?.role] || user?.role || "Участник"}{user?.company ? ` · ${user.company}` : ""}</p> : null}
          {user?.looking_for ? <InfoBlock label="Ищет" value={user.looking_for} /> : null}
          {user?.can_help_with ? <InfoBlock label="Может помочь" value={user.can_help_with} /> : null}
          {context ? <InfoBlock label="Контекст встречи" value={context} /> : null}
          <InfoBlock label="Следующий шаг" value={contactStep(contact)} />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button onClick={() => void openChat()} disabled={!username}>Открыть Telegram</Button>
          {activeFollowUp ? <Button variant="soft" onClick={() => setNextAction({ action: "message_sent", message: "Отметили сообщение" })}>Я написал</Button> : null}
          {activeFollowUp ? <Button variant="soft" onClick={() => setNextAction({ action: "meeting_booked", message: "Встреча отмечена" })}>Назначил встречу</Button> : null}
          {activeFollowUp ? <SnoozeDateButton followUp={activeFollowUp} actions={actions} /> : null}
          <Button
            className="sm:col-span-2"
            variant="ghost"
            disabled={actions.isPending(`contact-${contact.id}-delete`)}
            onClick={async () => {
              const result = await actions.runAction(
                `contact-${contact.id}-delete`,
                async () => apiClient.deleteContact(contact.id),
                "Контакт удален",
              );
              if (!result) return;
              await actions.refresh();
              onBack();
            }}
          >
            Удалить контакт
          </Button>
        </div>
      </section>
      {activeFollowUp && nextAction ? <NextReminderModal followUp={activeFollowUp} {...nextAction} actions={actions} onClose={() => setNextAction(null)} /> : null}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="fup-subpanel rounded-[22px] px-3 py-2">
      <p className="text-[11px] font-semibold uppercase text-[#0072fc]">{label}</p>
      <p className="mt-1 whitespace-pre-line text-[14px] leading-5 text-slate-700">{value}</p>
    </div>
  );
}

function SnoozeDateButton({ followUp, actions, className = "" }: { followUp: AnyRecord; actions: AppActions; className?: string }) {
  const min = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const snooze = async (value: string) => {
    if (!value) return;
    const date = new Date(`${value}T10:00:00`);
    await actions.runAction(
      `followup-${followUp.id}-snooze`,
      async () => apiClient.updateFollowupAction(followUp.id, { action: "snoozed", snoozeUntil: date.toISOString() }),
      "Задача отложена",
    );
    await actions.refresh();
  };

  return (
    <label className={`button-press relative ${className}`}>
      <span className="fup-muted-action pointer-events-none gap-2 text-[#0087ff]">
        <Clock3 size={15} /> Отложить до даты
      </span>
      <input
        aria-label="Отложить до даты"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        min={min}
        type="date"
        onChange={(event) => void snooze(event.target.value)}
      />
    </label>
  );
}

function ProfileScreen({ me, actions, pendingVersion, required = false }: { me: AnyRecord | null; actions: AppActions; pendingVersion: number; required?: boolean }) {
  const user = me?.user || {};
  const [name, setName] = useState(fullName(user));
  const [role, setRole] = useState(roleToRu[user.role] || user.role || "Основатель");
  const [lookingFor, setLookingFor] = useState(user.looking_for || "");
  const [canHelpWith, setCanHelpWith] = useState(user.can_help_with || "");
  const [company, setCompany] = useState(user.company || user.education || user.field || "");
  const [isVisible, setIsVisible] = useState(Boolean(user.is_visible));
  const [eventCode, setEventCode] = useState("");

  useEffect(() => {
    setName(fullName(user));
    setRole(roleToRu[user.role] || user.role || "Основатель");
    setLookingFor(user.looking_for || "");
    setCanHelpWith(user.can_help_with || "");
    setCompany(user.company || user.education || user.field || "");
    setIsVisible(Boolean(user.is_visible));
  }, [
    user.id,
    user.first_name,
    user.last_name,
    user.telegram_first_name,
    user.telegram_last_name,
    user.role,
    user.looking_for,
    user.can_help_with,
    user.company,
    user.education,
    user.field,
    user.is_visible,
  ]);

  const submit = async () => {
    const nameParts = splitFullName(name);
    if (
      !nameParts.first_name ||
      !role.trim() ||
      !company.trim() ||
      !lookingFor.trim() ||
      !canHelpWith.trim()
    ) {
      actions.notify("Ошибка: необходимо заполнить все поля", "error");
      return;
    }
    const savedProfile = await actions.runAction(
      "save-profile",
      async () => apiClient.updateProfile({
        ...nameParts,
        last_name: nameParts.last_name || user.last_name || user.telegram_last_name || "",
        role: roleToDb[role] || "other",
        looking_for: lookingFor.trim(),
        can_help_with: canHelpWith.trim(),
        company: company.trim(),
        is_visible: isVisible,
      }),
      "Профиль сохранен",
    );
    if (!savedProfile) return;
    hapticSuccess();
    await actions.refresh();
  };

  const switchEvent = async () => {
    const code = eventCode.trim();
    if (!code) {
      actions.notify("Введите новый код мероприятия", "error");
      return;
    }
    const joined = await actions.runAction(
      "profile-switch-event",
      async () => assertJoinedEvent((await apiClient.joinEvent(code)) as AnyRecord),
      "Мероприятие переключено",
    );
    if (!joined) return;
    hapticSuccess();
    setEventCode("");
    await actions.refresh();
  };

  return (
    <div className="fup-screen space-y-4 py-2">
      <ParticipantHeader
        title={required ? "Заполните анкету" : "Профиль"}
        introKey={required ? "profile-required" : "profile"}
        description={required ? "Сначала расскажите о себе и решите, показывать ли вас другим участникам." : "Заполните профиль, чтобы другие участники могли найти вас в каталоге события."}
      />
      <div className="fup-panel flex items-center gap-4 rounded-[34px] p-4">
        <RoundAvatar user={user} label={name} className="size-[68px]" />
        <div className="min-w-0">
          <p className="truncate text-[18px] font-semibold text-black">{name || "Участник FUP"}</p>
          <p className="mt-1 text-[13px] leading-5 text-slate-500">{role}{company ? ` · ${company}` : ""}</p>
        </div>
      </div>
      <Shelf title="Базовая карточка">
        <div className="space-y-3">
          <Field label="Имя и фамилия" required><TextInput required value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Роль" required><SelectInput required value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</SelectInput></Field>
          <Field label="Вуз / компания / сфера" required><TextInput required value={company} onChange={(event) => setCompany(event.target.value)} /></Field>
        </div>
      </Shelf>
      <Shelf title="Чем вы полезны">
        <div className="space-y-3">
          <Field label="Кого ищу" required><TextArea required value={lookingFor} onChange={(event) => setLookingFor(event.target.value)} /></Field>
          <Field label="Чем могу помочь" required><TextArea required value={canHelpWith} onChange={(event) => setCanHelpWith(event.target.value)} /></Field>
          <label className="fup-subpanel flex items-center justify-between gap-4 rounded-[24px] p-3">
            <span className="text-[14px] font-semibold text-slate-700">Показывать мой профиль участникам</span>
            <AppleSwitch checked={isVisible} onChange={setIsVisible} label="Показывать мой профиль участникам" />
          </label>
        </div>
      </Shelf>
      <Button className="w-full" onClick={submit} disabled={actions.isPending("save-profile")}>
        {actions.isPending("save-profile") ? "Сохраняем..." : "Сохранить профиль"}
      </Button>
      {!required ? (
        <Shelf title="Другое мероприятие" subtitle="Новый код переключит приложение на последнее подключенное событие.">
          <div className="grid gap-2">
            <TextInput
              autoCapitalize="none"
              autoComplete="one-time-code"
              placeholder="Введите код"
              value={eventCode}
              onChange={(event) => setEventCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void switchEvent();
              }}
            />
            <Button disabled={actions.isPending("profile-switch-event")} onClick={() => void switchEvent()}>
              {actions.isPending("profile-switch-event") ? "Подключаем..." : "Подключиться по новому коду"}
            </Button>
          </div>
        </Shelf>
      ) : null}
    </div>
  );
}
