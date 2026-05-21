import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Building2, Calendar, Copy, Eye, Lock, Plus, QrCode, Radio, Sparkles, Users, Waypoints } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { MetricCard } from "../ui/MetricCard";

type AnyRecord = Record<string, any>;

const path = () => window.location.pathname.replace(/\/+$/, "") || "/organizer";
const eventIdFromPath = () => path().match(/^\/organizer\/events\/([^/]+)$/)?.[1];
const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "Не задано";

function navigate(to: string) {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function OrganizerDashboard() {
  const currentPath = path();
  if (currentPath === "/organizer/events/new") return <CreateEventPage />;
  const eventId = eventIdFromPath();
  if (eventId) return <EventPage eventId={decodeURIComponent(eventId)} />;
  return <OrganizerHome />;
}

function OrganizerHome() {
  const [orgMe, setOrgMe] = useState<AnyRecord | null>(null);
  const [error, setError] = useState("");

  const loadOrgMe = async () => {
    setError("");
    return apiClient
      .getOrgMe()
      .then((data) => setOrgMe(data as AnyRecord))
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Не удалось открыть кабинет"));
  };

  useEffect(() => {
    void loadOrgMe();
  }, []);

  if (error) return <Shell><EmptyState title="Не удалось открыть кабинет" text={error} /></Shell>;
  if (!orgMe) return <Shell><EmptyState title="Загружаем кабинет" text="Проверяем роль организатора..." /></Shell>;
  if (!orgMe.organizations?.length) {
    return (
      <Shell>
        <OrganizationOnboarding user={orgMe.user} onCreated={loadOrgMe} />
      </Shell>
    );
  }

  const events = orgMe.organizations.flatMap((item: AnyRecord) =>
    (item.events || []).map((event: AnyRecord) => ({ ...event, organization: item.organization, role: item.role })),
  );

  return (
    <Shell>
      <header className="glass rounded-[32px] p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="liquid-control inline-flex rounded-full px-4 py-2 text-[13px] font-semibold text-[#0066cc]">
              Кабинет организатора
            </div>
            <h1 className="mt-5 text-[38px] font-semibold tracking-[-0.02em] text-[#1d1d1f] sm:text-[52px]">
              Мероприятия и live-статистика
            </h1>
            <p className="mt-3 max-w-2xl text-[17px] leading-7 text-slate-600">
              Создавайте события, показывайте участникам QR и смотрите, как знакомства превращаются в follow-ups и результаты.
            </p>
          </div>
          <Button onClick={() => navigate("/organizer/events/new")}>
            <Plus size={18} /> Создать мероприятие
          </Button>
        </div>
      </header>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {orgMe.organizations.map((item: AnyRecord) => (
          <Card key={item.organization.id} className="p-5">
            <p className="text-[13px] font-semibold text-[#0066cc]">Организация</p>
            <h2 className="mt-2 text-2xl font-semibold">{item.organization.name}</h2>
            <p className="mt-2 text-[14px] text-slate-500">Роль: {item.role}</p>
          </Card>
        ))}
      </div>

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Мероприятия</h2>
          <span className="text-[14px] text-slate-500">{events.length} всего</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {events.map((event: AnyRecord) => (
            <Card key={event.id} className="p-5 transition duration-200 hover:-translate-y-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[13px] font-semibold text-[#0066cc]">{event.organization?.name}</p>
                  <h3 className="mt-2 text-2xl font-semibold">{event.name}</h3>
                  <p className="mt-2 text-[14px] leading-6 text-slate-500">{event.description || "Описание появится позже"}</p>
                </div>
                <span className="rounded-full bg-white/60 px-3 py-1 text-[12px] font-semibold text-slate-600">
                  {event.status || "draft"}
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <MiniMetric label="Код" value={event.invite_code || "—"} />
                <MiniMetric label="Начало" value={formatDate(event.starts_at)} />
                <MiniMetric label="Роль" value={event.role} />
              </div>
              <Button className="mt-5" variant="secondary" onClick={() => navigate(`/organizer/events/${event.id}`)}>
                Открыть событие
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </Shell>
  );
}

const organizationTypeOptions = [
  { value: "founder_community", label: "Сообщество основателей" },
  { value: "accelerator", label: "Акселератор" },
  { value: "business_club", label: "Бизнес-клуб" },
  { value: "university_program", label: "Образовательная программа" },
  { value: "event_agency", label: "Ивент-команда" },
  { value: "company", label: "Компания" },
  { value: "other", label: "Другое" },
];

function OrganizationOnboarding({ user, onCreated }: { user?: AnyRecord; onCreated: () => Promise<unknown> }) {
  const [form, setForm] = useState({
    accessCode: "",
    name: "",
    type: "founder_community",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const submit = async () => {
    if (saving) return;
    if (!form.name.trim()) {
      setNotice("Добавьте название организации");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await apiClient.createOrganization({
        accessCode: form.accessCode.trim(),
        name: form.name.trim(),
        type: form.type,
        description: form.description.trim() || undefined,
      });
      setNotice("Организация создана. Готовим кабинет...");
      await onCreated();
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "Не удалось создать организацию");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid min-h-[72vh] items-center gap-6 lg:grid-cols-[0.92fr_1.08fr]">
      <Card className="p-6 sm:p-8">
        <div className="liquid-control inline-flex h-16 w-16 items-center justify-center rounded-[24px] text-[#0066cc]">
          <Building2 size={28} />
        </div>
        <h1 className="mt-6 text-[38px] font-semibold tracking-[-0.02em] text-[#1d1d1f] sm:text-[50px]">
          Создайте организацию
        </h1>
        <p className="mt-4 text-[17px] leading-7 text-slate-600">
          Организация — это рабочее пространство для мероприятий, команды, ссылок приглашения и live-аналитики.
        </p>
        <div className="mt-6 rounded-[26px] border border-white/70 bg-white/45 p-4 text-[14px] leading-6 text-slate-600">
          Вы вошли через Telegram{user?.telegram_username ? ` как @${user.telegram_username}` : ""}. Введите ключ доступа, чтобы подключить кабинет организатора.
        </div>
      </Card>

      <Card className="p-6 sm:p-8">
        <div className="grid gap-5">
          <Field label="Ключ доступа" type="password" value={form.accessCode} onChange={(accessCode) => setForm({ ...form, accessCode })} />
          <Field label="Название организации" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <label>
            <span className="mb-2 block text-[13px] font-semibold text-slate-500">Тип организации</span>
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value })}
              className="h-12 w-full rounded-[24px] border border-white/70 bg-white/55 px-4 outline-none ring-[#0071e3]/15 transition focus:ring-4"
            >
              {organizationTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-[13px] font-semibold text-slate-500">Описание, необязательно</span>
            <textarea
              className="min-h-[118px] w-full rounded-[24px] border border-white/70 bg-white/55 px-4 py-3 outline-none ring-[#0071e3]/15 transition focus:ring-4"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Например: сообщество основателей, акселерационная программа или клуб предпринимателей"
            />
          </label>
        </div>
        <Button className="mt-7" onClick={submit} disabled={saving || !form.name.trim() || !form.accessCode.trim()}>
          {saving ? "Создаем..." : "Создать организацию"}
        </Button>
        {notice ? (
          <div className="mt-4 rounded-[22px] border border-white/70 bg-white/55 px-4 py-3 text-[14px] font-semibold text-slate-600">
            {notice}
          </div>
        ) : null}
        <p className="mt-5 text-[13px] leading-6 text-slate-500">
          Ключ выдается команде FUP перед запуском программы или мероприятия.
        </p>
      </Card>
    </div>
  );
}

function CreateEventPage() {
  const [orgMe, setOrgMe] = useState<AnyRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    startsAt: "",
    endsAt: "",
    locationName: "",
    privacy: "invite_only",
    goalContactsPerUser: 3,
    goalMessagesPerUser: 2,
    goalResultsPerUser: 1,
    allowManualContacts: true,
    showParticipantCatalog: true,
    enableRecommendations: true,
    enableReminders: true,
  });

  useEffect(() => {
    apiClient.getOrgMe().then((data) => setOrgMe(data as AnyRecord));
  }, []);

  const organizationId = orgMe?.organizations?.[0]?.organization?.id;

  const submit = async () => {
    if (!organizationId || !form.name.trim()) return;
    setSaving(true);
    try {
      const response = (await apiClient.createOrgEvent({
        organizationId,
        name: form.name,
        description: form.description,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
        privacy: form.privacy,
        locationName: form.locationName,
        goalContactsPerUser: Number(form.goalContactsPerUser),
        goalMessagesPerUser: Number(form.goalMessagesPerUser),
        goalResultsPerUser: Number(form.goalResultsPerUser),
        settings: {
          allowManualContacts: form.allowManualContacts,
          showParticipantCatalog: form.showParticipantCatalog,
          enableRecommendations: form.enableRecommendations,
          enableReminders: form.enableReminders,
        },
      })) as AnyRecord;
      navigate(`/organizer/events/${response.event.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <Card className="p-6 sm:p-8">
        <button className="mb-6 text-[14px] font-semibold text-[#0066cc]" onClick={() => navigate("/organizer")}>
          Назад к кабинету
        </button>
        <h1 className="text-4xl font-semibold tracking-[-0.02em]">Создать мероприятие</h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-7 text-slate-600">
          Событие сразу получит invite code, ссылку для участников и QR для входа через Telegram Mini App.
        </p>
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <Field label="Название" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Field label="Место" value={form.locationName} onChange={(locationName) => setForm({ ...form, locationName })} />
          <Field label="Дата начала" type="datetime-local" value={form.startsAt} onChange={(startsAt) => setForm({ ...form, startsAt })} />
          <Field label="Дата окончания" type="datetime-local" value={form.endsAt} onChange={(endsAt) => setForm({ ...form, endsAt })} />
          <label className="lg:col-span-2">
            <span className="mb-2 block text-[13px] font-semibold text-slate-500">Описание</span>
            <textarea
              className="min-h-[110px] w-full rounded-[24px] border border-white/70 bg-white/55 px-4 py-3 outline-none ring-[#0071e3]/15 transition focus:ring-4"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Field label="Знакомств на участника" type="number" value={String(form.goalContactsPerUser)} onChange={(value) => setForm({ ...form, goalContactsPerUser: Number(value) })} />
          <Field label="Сообщений после события" type="number" value={String(form.goalMessagesPerUser)} onChange={(value) => setForm({ ...form, goalMessagesPerUser: Number(value) })} />
          <Field label="Результатов" type="number" value={String(form.goalResultsPerUser)} onChange={(value) => setForm({ ...form, goalResultsPerUser: Number(value) })} />
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            ["allowManualContacts", "Разрешить ручное сохранение контактов"],
            ["showParticipantCatalog", "Показывать каталог участников"],
            ["enableRecommendations", "Включить рекомендации"],
            ["enableReminders", "Включить напоминания"],
          ].map(([key, label]) => (
            <label key={key} className="glass-soft flex items-center justify-between rounded-[24px] px-4 py-3">
              <span className="text-[14px] font-semibold">{label}</span>
              <input
                type="checkbox"
                checked={Boolean(form[key as keyof typeof form])}
                onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
                className="h-6 w-11 accent-[#0071e3]"
              />
            </label>
          ))}
        </div>
        <Button className="mt-7" onClick={submit} disabled={saving || !organizationId}>
          {saving ? "Создаем..." : "Создать мероприятие"}
        </Button>
      </Card>
    </Shell>
  );
}

function EventPage({ eventId }: { eventId: string }) {
  const [eventData, setEventData] = useState<AnyRecord | null>(null);
  const [live, setLive] = useState<AnyRecord | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    apiClient.getOrganizerEvent(eventId).then((data) => setEventData(data as AnyRecord)).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Ошибка"));
    apiClient.getOrganizerLive(eventId).then((data) => setLive(data as AnyRecord)).catch(() => undefined);
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      apiClient.getOrganizerLive(eventId).then((data) => setLive(data as AnyRecord)).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [eventId]);

  if (error) return <Shell><EmptyState title="Не удалось открыть мероприятие" text={error} /></Shell>;
  if (!eventData) return <Shell><EmptyState title="Загружаем мероприятие" text="Собираем ссылки, QR и live-метрики..." /></Shell>;

  const invite = eventData.invite || {};
  const metrics = live?.liveMetrics || {};
  const funnel = live?.funnel || {};
  const overview = eventData.overview || {};

  return (
    <Shell>
      <header className="glass rounded-[32px] p-6 sm:p-8">
        <button className="mb-6 text-[14px] font-semibold text-[#0066cc]" onClick={() => navigate("/organizer")}>
          Назад к кабинету
        </button>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="liquid-control inline-flex rounded-full px-4 py-2 text-[13px] font-semibold text-[#0066cc]">
              {eventData.organization?.name}
            </div>
            <h1 className="mt-5 text-[38px] font-semibold tracking-[-0.02em] text-[#1d1d1f] sm:text-[52px]">
              {eventData.event.name}
            </h1>
            <p className="mt-3 text-[16px] leading-7 text-slate-600">
              {formatDate(eventData.event.starts_at)} · {eventData.event.status || "draft"}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="secondary" onClick={() => setQrOpen(true)}>
              <QrCode size={18} /> Показать QR
            </Button>
            <Button onClick={() => copy(invite.webJoinUrl)}>Скопировать ссылку</Button>
          </div>
        </div>
      </header>

      <section className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-5">
          <h2 className="text-2xl font-semibold">Приглашение участников</h2>
          <div className="mt-5 grid gap-3">
            <CopyRow label="Invite code" value={invite.inviteCode} />
            <CopyRow label="Web link" value={invite.webJoinUrl} />
            <CopyRow label="Telegram Mini App" value={invite.telegramMiniAppUrl || "Telegram bot username не задан"} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => copy(invite.webJoinUrl)}>
              <Copy size={17} /> Скопировать ссылку
            </Button>
            <Button variant="secondary" onClick={() => copy(invite.telegramMiniAppUrl || invite.webJoinUrl)}>
              <Copy size={17} /> Скопировать Telegram-ссылку
            </Button>
            <Button onClick={() => setQrOpen(true)}>
              <QrCode size={17} /> Показать QR
            </Button>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2 text-[#0066cc]">
            <Radio size={20} />
            <h2 className="text-2xl font-semibold text-[#1d1d1f]">Live-регистрация</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniMetric label="Зашли" value={metrics.appOpened || 0} />
            <MiniMetric label="Заполнили профиль" value={metrics.profilesCompleted || 0} />
            <MiniMetric label="Видны в каталоге" value={metrics.visibleInCatalog || 0} />
            <MiniMetric label="Активны сейчас" value={metrics.activeNow || 0} />
          </div>
        </Card>
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Сохраненные знакомства" value={metrics.contactsSaved ?? overview.contacts_saved ?? 0} icon={<Waypoints size={20} />} />
        <MetricCard label="Написали людям" value={metrics.completedFollowups ?? overview.messages_sent ?? 0} icon={<Sparkles size={20} />} />
        <MetricCard label="Результаты" value={metrics.resultsTotal ?? overview.results ?? 0} icon={<Eye size={20} />} />
        <MetricCard label="Встречи" value={metrics.meetingsBooked || 0} icon={<Calendar size={20} />} />
        <MetricCard label="Познакомили людей" value={metrics.peopleIntroduced || 0} icon={<Users size={20} />} />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="p-5">
          <h2 className="text-2xl font-semibold">Воронка</h2>
          <div className="mt-5 space-y-3">
            {[
              ["Приглашены", funnel.invited],
              ["Зашли", funnel.opened],
              ["Заполнили профиль", funnel.profileCompleted],
              ["Сохранили знакомство", funnel.contactsSaved],
              ["Написали", funnel.messagesSent],
              ["Получили результат", funnel.results],
            ].map(([label, value]) => (
              <div key={String(label)} className="glass-soft flex items-center justify-between rounded-[22px] px-4 py-3">
                <span className="text-[14px] font-semibold text-slate-600">{label}</span>
                <span className="text-xl font-semibold">{Number(value || 0)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-2xl font-semibold">Журнал действий</h2>
          <div className="mt-5 space-y-3">
            {(live?.recentActivity || []).slice(0, 8).map((activity: AnyRecord) => (
              <div key={activity.id} className="flex items-start justify-between gap-4 rounded-[22px] bg-white/45 px-4 py-3">
                <div>
                  <p className="font-semibold">{activity.label}</p>
                  <p className="mt-1 text-[13px] text-slate-500">{activity.user}</p>
                </div>
                <span className="text-[12px] text-slate-500">{formatDate(activity.created_at)}</span>
              </div>
            ))}
            {!live?.recentActivity?.length ? <p className="text-[14px] text-slate-500">Пока нет событий.</p> : null}
          </div>
        </Card>
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <TableHeader title="Активность участников" />
          <Table
            columns={["Участник", "Профиль", "Последняя активность"]}
            rows={(live?.recentMembers || []).map((member: AnyRecord) => [
              displayName(member.user),
              member.profile_completed ? "Заполнен" : "Не заполнен",
              formatDate(member.last_activity_at || member.joined_at),
            ])}
          />
        </Card>
        <Card soft className="flex items-start gap-3 p-5 text-[14px] leading-6 text-slate-600">
          <Lock className="mt-0.5 shrink-0 text-[#0066cc]" size={20} />
          <p>Организатор видит статусы и агрегированные результаты, но не видит личную переписку.</p>
        </Card>
      </section>

      <section className="mt-5">
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[13px] font-semibold uppercase text-[#0066cc]">Финальный отчет</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">Отчет по нетворкингу</h2>
              <p className="mt-2 max-w-2xl text-[14px] leading-6 text-slate-500">
                Сводка собирается из действий участников: сохраненные знакомства, напоминания, отправленные сообщения, встречи и intro.
              </p>
            </div>
            <Button variant="secondary" onClick={() => copy(reportSummary(eventData.event.name, metrics, overview))}>
              <Copy size={17} /> Скопировать сводку
            </Button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MiniMetric label="Знакомства" value={metrics.contactsSaved ?? overview.contacts_saved ?? 0} />
            <MiniMetric label="Напоминания" value={metrics.remindersCreated ?? 0} />
            <MiniMetric label="Написали" value={metrics.completedFollowups ?? overview.messages_sent ?? 0} />
            <MiniMetric label="Встречи" value={metrics.meetingsBooked || 0} />
            <MiniMetric label="Intro" value={metrics.peopleIntroduced || 0} />
          </div>
        </Card>
      </section>

      {qrOpen ? <QrModal invite={invite} eventName={eventData.event.name} onClose={() => setQrOpen(false)} /> : null}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</section>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Card className="mx-auto max-w-2xl p-8 text-center">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-3 text-[15px] leading-7 text-slate-600">{text}</p>
    </Card>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label>
      <span className="mb-2 block text-[13px] font-semibold text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-[24px] border border-white/70 bg-white/55 px-4 outline-none ring-[#0071e3]/15 transition focus:ring-4"
      />
    </label>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-soft rounded-[24px] p-4">
      <p className="text-[12px] font-semibold text-slate-500">{label}</p>
      <p className="mt-2 truncate text-xl font-semibold">{value}</p>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="glass-soft flex items-center justify-between gap-3 rounded-[22px] px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-slate-500">{label}</p>
        <p className="mt-1 truncate text-[14px] font-semibold">{value || "—"}</p>
      </div>
      <button className="liquid-control rounded-full p-2 text-[#0066cc]" onClick={() => copy(value || "")} aria-label="Скопировать">
        <Copy size={16} />
      </button>
    </div>
  );
}

function QrModal({ invite, eventName, onClose }: { invite: AnyRecord; eventName: string; onClose: () => void }) {
  const payload = invite.qrPayload || invite.telegramMiniAppUrl || invite.webJoinUrl;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 px-4 backdrop-blur-md">
      <Card className="w-full max-w-[440px] p-6 text-center">
        <h2 className="text-2xl font-semibold">{eventName}</h2>
        <p className="mt-2 text-[14px] leading-6 text-slate-500">Покажите этот QR участникам, чтобы они подключились к мероприятию.</p>
        {invite.inviteCode ? (
          <div className="mt-4 inline-flex rounded-full border border-white/70 bg-white/55 px-4 py-2 text-[14px] font-semibold text-slate-600">
            Код: {invite.inviteCode}
          </div>
        ) : null}
        <div className="mx-auto mt-6 inline-flex rounded-[28px] bg-white p-4 shadow-sm">
          <QRCodeSVG value={payload} size={220} level="M" includeMargin />
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button variant="secondary" onClick={() => downloadQr(payload, eventName)}>Скачать QR</Button>
          <Button variant="secondary" onClick={() => copy(payload)}>Скопировать ссылку</Button>
          <Button onClick={onClose}>Закрыть</Button>
        </div>
      </Card>
    </div>
  );
}

function TableHeader({ title }: { title: string }) {
  return <div className="border-b border-white/60 p-5 text-xl font-semibold">{title}</div>;
}

function Table({ columns, rows }: { columns: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
        <thead className="bg-white/42 text-[12px] uppercase text-slate-500">
          <tr>{columns.map((column) => <th key={column} className="px-5 py-3 font-semibold">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-t border-white/48">
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`} className={`px-5 py-4 ${cellIndex === 0 ? "font-semibold" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function displayName(user: AnyRecord = {}) {
  return [user.first_name || user.telegram_first_name, user.last_name || user.telegram_last_name].filter(Boolean).join(" ") || user.username || user.telegram_username || "Участник";
}

function copy(value: string) {
  if (!value) return;
  navigator.clipboard?.writeText(value);
}

function downloadQr(payload: string, eventName: string) {
  const svg = document.querySelector("svg");
  if (!svg) return;
  const data = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${eventName || "fup"}-qr.svg`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function reportSummary(eventName: string, metrics: AnyRecord, overview: AnyRecord) {
  return [
    `Отчет FUP: ${eventName}`,
    `Сохраненные знакомства: ${metrics.contactsSaved ?? overview.contacts_saved ?? 0}`,
    `Созданные напоминания: ${metrics.remindersCreated ?? 0}`,
    `Выполненные follow-ups: ${metrics.completedFollowups ?? overview.messages_sent ?? 0}`,
    `Встречи: ${metrics.meetingsBooked || 0}`,
    `Intro: ${metrics.peopleIntroduced || 0}`,
  ].join("\n");
}
