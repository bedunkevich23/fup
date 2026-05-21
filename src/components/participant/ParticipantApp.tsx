import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Bell, Check, Clock3, Home, MessageCircle, Plus, Search, Send, Users } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { hapticImpact, hapticSuccess, openTelegramLink, sendReminderMock } from "../../lib/telegram";
import { AppleSwitch } from "../ui/AppleSwitch";
import { ConnectionBadge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, SelectInput, TextArea, TextInput } from "../ui/Field";
import { MetricCard } from "../ui/MetricCard";
import { SegmentedControl } from "../ui/SegmentedControl";

type ParticipantView = "today" | "people" | "save" | "followups" | "profile";
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
const nextSteps = ["Написать", "Отправить материалы", "Назначить звонок", "Сделать intro", "Свой вариант"];
const reminders = [
  { label: "завтра", days: 1 },
  { label: "через 2 дня", days: 2 },
  { label: "через неделю", days: 7 },
  { label: "выбрать дату", days: 3 },
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

const remindAtFromDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
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
const contactName = (contact: AnyRecord = {}) => contact.contact_name || "Контакт";
const contactStep = (contact: AnyRecord = {}) => contact.next_step_text || contact.next_step || "Написать";
const contactUsername = (contact: AnyRecord = {}) => contact.contact_username || "";
const followUpDate = (followUp: AnyRecord = {}) => followUp.remind_at || followUp.due_at;
const followUpContact = (followUp: AnyRecord = {}) => followUp.contact || followUp.contacts || {};

export function ParticipantApp() {
  const [view, setView] = useState<ParticipantView>("today");
  const [me, setMe] = useState<AnyRecord | null>(null);
  const [event, setEvent] = useState<AnyRecord | null>(null);
  const [home, setHome] = useState<AnyRecord | null>(null);
  const [contacts, setContacts] = useState<AnyRecord[]>([]);
  const [followUps, setFollowUps] = useState<AnyRecord[]>([]);
  const [members, setMembers] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [pendingVersion, setPendingVersion] = useState(0);
  const pendingRef = useRef(new Set<string>());

  const notify = (message: string, kind: ToastKind = "success") => {
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
      setLoading(false);
      return;
    }

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
    setLoading(false);
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
    <section className="mx-auto h-[100dvh] w-full max-w-[430px] overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(240,248,255,0.72))] shadow-[0_24px_70px_rgba(29,29,31,0.10)] backdrop-blur-3xl sm:my-5 sm:h-[min(860px,calc(100dvh-40px))] sm:rounded-[34px] sm:border sm:border-white/70">
      <div className="relative flex h-full flex-col overflow-hidden">
        <div className="apple-scroll no-scrollbar relative z-10 flex-1 overflow-y-auto px-4 pb-32 pt-[max(18px,env(safe-area-inset-top))]">
          {loading ? <LoadingScreen /> : null}
          {!loading && !event && view !== "profile" ? <JoinEventScreen actions={actions} onProfile={() => setView("profile")} /> : null}
          {!loading && event && view === "today" ? <TodayScreen me={me} event={event} home={home} contacts={contacts} followUps={followUps} onSave={() => setView("save")} onProfile={() => setView("profile")} /> : null}
          {!loading && event && view === "people" ? <PeopleScreen event={event} members={members} me={me} actions={actions} /> : null}
          {!loading && event && view === "save" ? <SaveScreen event={event} members={members} me={me} actions={actions} /> : null}
          {!loading && event && view === "followups" ? <FollowUpsScreen followUps={followUps} actions={actions} /> : null}
          {!loading && view === "profile" ? <ProfileScreen me={me} actions={actions} pendingVersion={pendingVersion} /> : null}
        </div>
        <BottomNav view={view} setView={setView} />
        <Toast toast={toast} />
      </div>
    </section>
  );
}

function BottomNav({ view, setView }: { view: ParticipantView; setView: (view: ParticipantView) => void }) {
  const nav = [
    { id: "today" as const, label: "Сегодня", icon: Home },
    { id: "people" as const, label: "Люди", icon: Users },
    { id: "save" as const, label: "Сохранить", icon: Plus },
    { id: "followups" as const, label: "Напоминания", icon: Bell },
  ];

  return (
    <nav className="liquid-control absolute inset-x-4 bottom-[max(14px,env(safe-area-inset-bottom))] z-20 grid grid-cols-4 gap-1 rounded-[28px] p-1.5">
      {nav.map((item) => {
        const Icon = item.icon;
        const active = view === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`button-press flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-[23px] px-2 text-[10px] font-semibold transition ${
              active ? "bg-white/90 text-[#0066cc] shadow-[0_5px_16px_rgba(29,29,31,0.08)]" : "text-slate-500 hover:bg-white/40"
            }`}
          >
            <Icon size={17} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none absolute inset-x-4 top-[max(18px,env(safe-area-inset-top))] z-40 flex justify-center">
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
      <Card className="w-full p-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-[22px] liquid-control text-xl font-semibold text-[#0066cc]">F</div>
        <h1 className="mt-4 text-2xl font-semibold">Собираем ваши полочки</h1>
        <p className="mt-2 text-[14px] leading-6 text-slate-500">Загружаем профиль, контакты и follow-ups из FUP.</p>
      </Card>
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
        if (!response.event) throw new Error("Мероприятие с таким кодом не найдено");
        return response;
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
            placeholder="Например, demo2026"
            className="h-14 w-full rounded-[24px] border border-white/70 bg-white/62 px-4 text-[17px] font-semibold tracking-[0] outline-none ring-[#0071e3]/15 transition placeholder:font-medium placeholder:text-slate-400 focus:ring-4"
          />
        </label>
        <Button className="mt-4 w-full py-4" onClick={join} disabled={actions.isPending(joinKey)}>
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
    <section className={`glass rounded-[28px] p-4 ${className}`}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold text-[#1d1d1f]">{title}</h3>
          {subtitle ? <p className="mt-1 text-[13px] leading-5 text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-slate-200/70 to-transparent" />
      </div>
      {children}
    </section>
  );
}

function TodayScreen({
  me,
  event,
  home,
  contacts,
  followUps,
  onSave,
  onProfile,
}: {
  me: AnyRecord | null;
  event: AnyRecord | null;
  home: AnyRecord | null;
  contacts: AnyRecord[];
  followUps: AnyRecord[];
  onSave: () => void;
  onProfile: () => void;
}) {
  const stats = home?.stats || {};
  const activeFollowUps = followUps.filter((item) => ["scheduled", "reminder_sent", "snoozed"].includes(item.status));

  return (
    <div className="space-y-5 py-2">
      <header className="pt-2">
        <div className="flex items-center justify-between">
          <div className="liquid-blue flex size-12 items-center justify-center rounded-[16px] text-lg font-semibold text-white">F</div>
          <button className="button-press liquid-control flex items-center gap-2 rounded-full px-2.5 py-2 text-[12px] font-semibold text-[#0066cc]" onClick={onProfile}>
            <Avatar user={me?.user} size="sm" /> Профиль
          </button>
        </div>
        <p className="mt-8 text-[14px] font-medium text-slate-500">Привет, {firstName(me?.user)}</p>
        <h1 className="mt-2 text-[36px] font-semibold leading-[1.04] text-[#1d1d1f]">Разложим новые знакомства по полочкам</h1>
        <p className="mt-4 text-[16px] leading-7 text-slate-600">
          {event ? `${event.name}: сохраните контакт, поставьте напоминание и вернитесь к человеку вовремя.` : "Пока вы не подключены к мероприятию. Откройте invite-ссылку или QR организатора."}
        </p>
        <Button className="mt-5 w-full py-4 text-[17px]" onClick={onSave} disabled={!event}>
          <Plus size={19} /> Сохранить знакомство
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Сохранено" value={stats.saved_contacts || contacts.length} icon={<Users size={18} />} />
        <MetricCard label="Напоминания" value={stats.upcoming_reminders || activeFollowUps.length} icon={<Bell size={18} />} />
        <MetricCard label="Выполнено" value={stats.completed_followups || 0} icon={<Check size={18} />} />
        <MetricCard label="Результаты" value={stats.results || 0} icon={<MessageCircle size={18} />} />
      </div>

      <Shelf title="Сегодня на полке" subtitle="Не забудьте вернуться к важным людям">
        <div className="space-y-3">
          {activeFollowUps.slice(0, 3).map((followUp) => <FollowUpPreview key={followUp.id} followUp={followUp} />)}
          {!activeFollowUps.length ? <p className="rounded-[20px] bg-white/42 p-4 text-[13px] leading-5 text-slate-500">На сегодня ничего не горит. Можно спокойно сохранить новые знакомства.</p> : null}
        </div>
      </Shelf>

      <Shelf title="Последние знакомства">
        <div className="space-y-3">
          {contacts.slice(0, 4).map((contact) => <ContactCard key={contact.id} contact={contact} />)}
          {!contacts.length ? <p className="rounded-[20px] bg-white/38 p-4 text-[13px] text-slate-500">Здесь появятся сохраненные знакомства.</p> : null}
        </div>
      </Shelf>
    </div>
  );
}

function PeopleScreen({ event, members, me, actions }: { event: AnyRecord | null; members: AnyRecord[]; me: AnyRecord | null; actions: AppActions }) {
  const [query, setQuery] = useState("");
  const currentUserId = me?.user?.id;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleMembers = members
    .filter((member) => member.id !== currentUserId)
    .filter((member) => {
      if (!normalizedQuery) return true;
      return [fullName(member), member.role, member.company, member.field, member.looking_for, member.can_help_with]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });

  if (!event) {
    return (
      <div className="space-y-5 py-2">
        <Card className="p-6 text-center">
          <h1 className="text-2xl font-semibold">Нет активного мероприятия</h1>
          <p className="mt-3 text-[14px] leading-6 text-slate-500">Каталог появится после подключения к мероприятию по QR или invite-ссылке.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 py-2">
      <header>
        <p className="text-[13px] font-semibold uppercase text-[#0066cc]">Участники</p>
        <h1 className="mt-2 text-[34px] font-semibold leading-tight">Люди на мероприятии</h1>
        <p className="mt-3 text-[15px] leading-6 text-slate-600">Смотрите анкеты участников и сохраняйте тех, к кому важно вернуться после события.</p>
      </header>
      <div className="liquid-control flex items-center gap-2 rounded-[24px] px-4 py-3">
        <Search size={18} className="text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по роли, компании или запросу"
          className="w-full bg-transparent text-[15px] outline-none placeholder:text-slate-400"
        />
      </div>
      <div className="space-y-3">
        {visibleMembers.map((member) => {
          const key = `people-save-${member.id}`;
          return (
            <Card key={member.id} soft className="p-4">
              <div className="flex items-start gap-3">
                <Avatar user={member} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#1d1d1f]">{fullName(member)}</p>
                      <p className="mt-1 text-[13px] text-slate-500">{roleToRu[member.role] || member.role || "Участник"}{member.company ? ` · ${member.company}` : ""}</p>
                    </div>
                    <ConnectionBadge type="internal" />
                  </div>
                  <div className="mt-3 grid gap-2">
                    <p className="rounded-[18px] bg-white/48 px-3 py-2 text-[13px] leading-5 text-slate-600">Ищет: {member.looking_for || "Не указано"}</p>
                    <p className="rounded-[18px] bg-white/48 px-3 py-2 text-[13px] leading-5 text-slate-600">Может помочь: {member.can_help_with || "Не указано"}</p>
                  </div>
                  <Button
                    className="mt-4 w-full"
                    variant="secondary"
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
                            context: `Анкета участника. Ищет: ${member.looking_for || "не указано"}. Может помочь: ${member.can_help_with || "не указано"}.`,
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
                    {actions.isPending(key) ? "Сохраняем..." : "Сохранить знакомство"}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
        {!visibleMembers.length ? <p className="rounded-[20px] bg-white/38 p-4 text-[13px] text-slate-500">Подходящих участников пока нет.</p> : null}
      </div>
    </div>
  );
}

function ContactCard({ contact }: { contact: AnyRecord }) {
  return (
    <div className="button-press rounded-[22px] border border-white/60 bg-white/48 p-4 shadow-[0_8px_24px_rgba(29,29,31,0.05)] transition hover:-translate-y-0.5 hover:bg-white/66">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1d1d1f]">{contactName(contact)}</p>
          {contactUsername(contact) ? <p className="mt-1 text-[13px] text-[#0066cc]">@{contactUsername(contact)}</p> : null}
        </div>
        <ConnectionBadge type={contact.connection_type || "manual"} />
      </div>
      <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-slate-600">{contact.context}</p>
      <p className="mt-3 text-[12px] font-semibold text-slate-500">Следующий шаг: {contactStep(contact)}</p>
    </div>
  );
}

function FollowUpPreview({ followUp }: { followUp: AnyRecord }) {
  const contact = followUpContact(followUp);
  if (!contact?.id) return null;
  return (
    <div className="rounded-[22px] border border-white/60 bg-white/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1d1d1f]">{contactName(contact)}</p>
          <p className="mt-1 text-[13px] text-slate-500">{contactStep(contact)}</p>
        </div>
        <span className="rounded-full bg-[#0066cc]/10 px-3 py-1 text-[11px] font-semibold text-[#0066cc]">{formatDate(followUpDate(followUp))}</span>
      </div>
    </div>
  );
}

function SaveScreen({ event, members, me, actions }: { event: AnyRecord | null; members: AnyRecord[]; me: AnyRecord | null; actions: AppActions }) {
  const [mode, setMode] = useState<SaveMode>("manual");
  const [saved, setSaved] = useState<{ contact: AnyRecord; followUp: AnyRecord } | null>(null);

  if (!event) {
    return (
      <div className="space-y-5 py-2">
        <Card className="p-6 text-center">
          <h1 className="text-2xl font-semibold">Нет активного мероприятия</h1>
          <p className="mt-3 text-[14px] leading-6 text-slate-500">Чтобы сохранять знакомства, откройте invite-ссылку или QR от организатора.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 py-2">
      <header>
        <p className="text-[13px] font-semibold uppercase text-[#0066cc]">Сохранить</p>
        <h1 className="mt-2 text-[34px] font-semibold leading-tight">Новая карточка знакомства</h1>
        <p className="mt-3 text-[15px] leading-6 text-slate-600">Быстро положим контакт, контекст и следующий шаг на свои полочки.</p>
      </header>

      <SegmentedControl value={mode} onChange={setMode} options={[{ value: "manual", label: "Добавить вручную" }, { value: "program", label: "Из участников" }]} />

      {mode === "manual" ? <ManualSaveForm event={event} actions={actions} onSaved={setSaved} /> : <ProgramMemberPicker event={event} members={members} me={me} actions={actions} onSaved={setSaved} />}

      {saved ? <ReminderModal followUp={saved.followUp} contact={saved.contact} actions={actions} onClose={() => setSaved(null)} /> : null}
    </div>
  );
}

function ManualSaveForm({ event, actions, onSaved }: { event: AnyRecord; actions: AppActions; onSaved: (value: { contact: AnyRecord; followUp: AnyRecord }) => void }) {
  const [contactNameValue, setContactNameValue] = useState("");
  const [username, setUsername] = useState("");
  const [place, setPlace] = useState("Demo Day");
  const [context, setContext] = useState("");
  const [nextStep, setNextStep] = useState("Написать");
  const [customNextStep, setCustomNextStep] = useState("");
  const [reminder, setReminder] = useState("завтра");
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    if (!contactNameValue.trim()) {
      actions.notify("Введите имя контакта", "error");
      return;
    }
    const step = nextStep === "Свой вариант" ? customNextStep || "Вернуться позже" : nextStep;
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
          remindAt: remindAtFromDays(reminders.find((item) => item.label === reminder)?.days ?? 1),
        }),
      "Знакомство сохранено",
    )) as AnyRecord | undefined;

    if (!result) return;
    hapticSuccess();
    await actions.refresh();
    setSuccess(true);
    onSaved({ contact: result.contact, followUp: { ...result.followup, contact: result.contact } });
    setContactNameValue("");
    setUsername("");
    setContext("");
  };

  if (success) {
    return (
      <Card className="animate-[shelfIn_480ms_ease_both] p-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-[22px] bg-emerald-500 text-white shadow-[0_14px_30px_rgba(52,199,89,0.24)]">
          <Check size={28} />
        </div>
        <h2 className="mt-4 text-2xl font-semibold">Знакомство разложено по полочкам</h2>
        <p className="mt-2 text-[14px] leading-6 text-slate-600">Готово — напомним вовремя.</p>
        <Button className="mt-5 w-full" variant="secondary" onClick={() => setSuccess(false)}>
          Сохранить еще одно
        </Button>
      </Card>
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
        </div>
      </Shelf>
      <Button className="w-full py-4" onClick={submit} disabled={actions.isPending("save-contact-manual")}>
        {actions.isPending("save-contact-manual") ? "Сохраняем..." : "Сохранить и напомнить"}
      </Button>
    </div>
  );
}

function ProgramMemberPicker({ event, members, me, actions, onSaved }: { event: AnyRecord; members: AnyRecord[]; me: AnyRecord | null; actions: AppActions; onSaved: (value: { contact: AnyRecord; followUp: AnyRecord }) => void }) {
  const currentUserId = me?.user?.id;
  const visibleMembers = members.filter((member) => member.id !== currentUserId);

  return (
    <Shelf title="Выбрать из участников" subtitle="Сохраняйте людей из каталога мероприятия в один шаг">
      <div className="space-y-3">
        {visibleMembers.slice(0, 4).map((member) => {
          const key = `save-member-${member.id}`;
          return (
            <div key={member.id} className="rounded-[22px] border border-white/60 bg-white/48 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{fullName(member)}</p>
                  <p className="mt-1 text-[13px] text-slate-500">{roleToRu[member.role] || member.role || "Участник"} · {member.company || member.field || "FUP"}</p>
                </div>
                <ConnectionBadge type="internal" />
              </div>
              <p className="mt-3 text-[13px] leading-5 text-slate-600">{member.can_help_with || "Профиль пока не заполнен."}</p>
              <Button
                className="mt-4 w-full"
                variant="secondary"
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
                        context: "Выбрано из списка участников программы.",
                        nextStepType: "Написать",
                        nextStepText: "Написать",
                        remindAt: remindAtFromDays(1),
                      }),
                    "Участник сохранен",
                  )) as AnyRecord | undefined;
                  if (!result) return;
                  hapticSuccess();
                  await actions.refresh();
                  onSaved({ contact: result.contact, followUp: { ...result.followup, contact: result.contact } });
                }}
              >
                {actions.isPending(key) ? "Сохраняем..." : "Положить на полку"}
              </Button>
            </div>
          );
        })}
        {!visibleMembers.length ? <p className="rounded-[20px] bg-white/38 p-4 text-[13px] text-slate-500">В каталоге пока нет других участников.</p> : null}
      </div>
    </Shelf>
  );
}

function ReminderModal({ followUp, contact, actions, onClose }: { followUp: AnyRecord; contact: AnyRecord; actions: AppActions; onClose: () => void }) {
  const complete = async (action: "message_sent" | "meeting_booked" | "person_introduced", message: string) => {
    await actions.runAction(`followup-${followUp.id}-${action}`, async () => apiClient.updateFollowupAction(followUp.id, { action }), message);
    hapticImpact();
    await actions.refresh();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/18 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-[398px] animate-[shelfIn_420ms_ease_both] p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-[#0066cc]">Напоминание в Telegram</p>
            <h3 className="mt-1 text-2xl font-semibold">Как будет выглядеть напоминание</h3>
          </div>
          <button className="liquid-control size-9 rounded-full text-slate-500" onClick={onClose}>×</button>
        </div>
        <div className="rounded-[24px] border border-white/60 bg-white/58 p-4 text-[14px] leading-6 text-slate-700">{sendReminderMock(contact as any, { ...followUp, remind_at: followUpDate(followUp) } as any)}</div>
        <Button className="mt-4 w-full" variant="secondary" onClick={() => actions.notify("Напоминание создано")}>
          <Bell size={17} /> Готово
        </Button>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="soft" onClick={() => complete("message_sent", "Follow-up отмечен")}>Я написал</Button>
          <Button variant="soft" onClick={() => complete("meeting_booked", "Встреча сохранена")}>Назначил встречу</Button>
          <Button variant="soft" onClick={() => complete("person_introduced", "Intro сохранено")}>Сделал intro</Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await actions.runAction(`followup-${followUp.id}-snooze`, async () => apiClient.updateFollowupAction(followUp.id, { action: "snoozed", snoozeUntil: remindAtFromDays(2) }), "Follow-up отложен");
              await actions.refresh();
              onClose();
            }}
          >
            Отложить
          </Button>
        </div>
      </Card>
    </div>
  );
}

function FollowUpsScreen({ followUps, actions }: { followUps: AnyRecord[]; actions: AppActions }) {
  const [preview, setPreview] = useState<AnyRecord | null>(null);
  const today = new Date().toDateString();
  const groups = [
    { title: "Сегодня", items: followUps.filter((item) => new Date(followUpDate(item)).toDateString() === today && !["completed", "result"].includes(item.status)) },
    { title: "Скоро", items: followUps.filter((item) => new Date(followUpDate(item)).toDateString() !== today && !["completed", "result"].includes(item.status)) },
    { title: "Выполнено", items: followUps.filter((item) => item.status === "completed" || item.status === "result") },
  ];

  return (
    <div className="space-y-5 py-2">
      <header>
        <p className="text-[13px] font-semibold uppercase text-[#0066cc]">Следующие шаги</p>
        <h1 className="mt-2 text-[34px] font-semibold">Напоминания</h1>
        <p className="mt-3 text-[15px] leading-6 text-slate-600">Напоминание — это только сигнал. Выполненным follow-up становится после “Я написал”.</p>
      </header>
      {groups.map((group) => (
        <Shelf key={group.title} title={group.title}>
          <div className="space-y-3">
            {group.items.length ? group.items.map((item) => <FollowUpCard key={item.id} followUp={item} actions={actions} onPreview={() => setPreview(item)} />) : <p className="rounded-[20px] bg-white/38 p-4 text-[13px] text-slate-500">Эта полка пока пустая.</p>}
          </div>
        </Shelf>
      ))}
      {preview ? <ReminderModal followUp={preview} contact={followUpContact(preview)} actions={actions} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function FollowUpCard({ followUp, actions, onPreview }: { followUp: AnyRecord; actions: AppActions; onPreview: () => void }) {
  const contact = followUpContact(followUp);
  if (!contact?.id) return null;

  const mark = async (action: "message_sent" | "meeting_booked" | "person_introduced", message: string) => {
    await actions.runAction(`followup-${followUp.id}-${action}`, async () => apiClient.updateFollowupAction(followUp.id, { action }), message);
    hapticImpact();
    await actions.refresh();
  };

  return (
    <div className="rounded-[24px] border border-white/60 bg-white/52 p-4 shadow-[0_12px_34px_rgba(29,29,31,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1d1d1f]">{contactName(contact)}</p>
          <p className="mt-1 text-[13px] text-slate-500">{formatDate(followUpDate(followUp))}</p>
        </div>
        <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold text-slate-500">{statusLabel[followUp.status] || followUp.status}</span>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-slate-600">{contact.context}</p>
      <p className="mt-3 text-[13px] font-semibold text-[#1d1d1f]">Следующий шаг: {contactStep(contact)}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {contactUsername(contact) ? (
          <Button
            variant="secondary"
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
            <Send size={15} /> Telegram
          </Button>
        ) : (
          <Button variant="secondary" onClick={onPreview}><Bell size={15} /> Напоминание</Button>
        )}
        <Button variant="soft" onClick={() => mark("message_sent", "Follow-up отмечен")}>Я написал</Button>
        <Button variant="soft" onClick={() => mark("meeting_booked", "Встреча сохранена")}>Назначил встречу</Button>
        <Button variant="soft" onClick={() => mark("person_introduced", "Intro сохранено")}>Сделал intro</Button>
        <Button
          variant="ghost"
          className="col-span-2"
          onClick={async () => {
            await actions.runAction(`followup-${followUp.id}-snooze`, async () => apiClient.updateFollowupAction(followUp.id, { action: "snoozed", snoozeUntil: remindAtFromDays(2) }), "Follow-up отложен");
            await actions.refresh();
          }}
        >
          <Clock3 size={15} /> Отложить
        </Button>
      </div>
    </div>
  );
}

function ProfileScreen({ me, actions, pendingVersion }: { me: AnyRecord | null; actions: AppActions; pendingVersion: number }) {
  const user = me?.user || {};
  const [name, setName] = useState(fullName(user));
  const [role, setRole] = useState(roleToRu[user.role] || "Основатель");
  const [lookingFor, setLookingFor] = useState(user.looking_for || "");
  const [canHelpWith, setCanHelpWith] = useState(user.can_help_with || "");
  const [company, setCompany] = useState(user.company || "");
  const [isVisible, setIsVisible] = useState(Boolean(user.is_visible));

  useEffect(() => {
    setName(fullName(user));
    setRole(roleToRu[user.role] || "Основатель");
    setLookingFor(user.looking_for || "");
    setCanHelpWith(user.can_help_with || "");
    setCompany(user.company || "");
    setIsVisible(Boolean(user.is_visible));
  }, [user.id, pendingVersion]);

  const submit = async () => {
    const nameParts = splitFullName(name);
    await actions.runAction(
      "save-profile",
      async () => apiClient.updateProfile({
        ...nameParts,
        role: roleToDb[role] || "other",
        looking_for: lookingFor,
        can_help_with: canHelpWith,
        company,
        is_visible: isVisible,
      }),
      "Профиль сохранен",
    );
    hapticSuccess();
    await actions.refresh();
  };

  return (
    <div className="space-y-5 py-2">
      <header>
        <p className="text-[13px] font-semibold uppercase text-[#0066cc]">Профиль</p>
        <h1 className="mt-2 text-[34px] font-semibold">Видимость в программе</h1>
        <p className="mt-3 text-[15px] leading-6 text-slate-600">Контакты можно сохранять сразу. Профиль нужен только чтобы другие участники могли найти вас.</p>
      </header>
      <Shelf title="Базовая карточка">
        <div className="space-y-3">
          <Field label="Имя и фамилия"><TextInput value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Роль"><SelectInput value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</SelectInput></Field>
          <Field label="Вуз / компания / сфера"><TextInput value={company} onChange={(event) => setCompany(event.target.value)} /></Field>
        </div>
      </Shelf>
      <Shelf title="Чем вы полезны">
        <div className="space-y-3">
          <Field label="Кого ищу"><TextArea value={lookingFor} onChange={(event) => setLookingFor(event.target.value)} /></Field>
          <Field label="Чем могу помочь"><TextArea value={canHelpWith} onChange={(event) => setCanHelpWith(event.target.value)} /></Field>
          <label className="flex items-center justify-between gap-4 rounded-[20px] bg-white/48 p-3">
            <span className="text-[14px] font-semibold text-slate-700">Показывать мой профиль участникам</span>
            <AppleSwitch checked={isVisible} onChange={setIsVisible} label="Показывать мой профиль участникам" />
          </label>
        </div>
      </Shelf>
      <Button className="w-full py-4" onClick={submit} disabled={actions.isPending("save-profile")}>
        {actions.isPending("save-profile") ? "Сохраняем..." : "Сохранить профиль"}
      </Button>
    </div>
  );
}
