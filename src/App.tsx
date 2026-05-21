import { useEffect, useMemo, useState } from "react";
import { OrganizerDashboard } from "./components/organizer/OrganizerDashboard";
import { ParticipantApp } from "./components/participant/ParticipantApp";
import { Card } from "./components/ui/Card";
import { apiClient } from "./lib/apiClient";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
        openTelegramLink?: (url: string) => void;
      };
    };
  }
}

type AuthState = "checking" | "authorized" | "telegram_required" | "failed";

const getPathname = () => window.location.pathname.replace(/\/+$/, "") || "/";
const isOrganizerPath = (pathname: string) => pathname === "/admin" || pathname.startsWith("/organizer");
const getInviteCodeFromPath = () => {
  const match = getPathname().match(/^\/join\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : undefined;
};
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const getTelegramInitData = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const initData = window.Telegram?.WebApp?.initData;
    if (initData) return initData;
    await delay(100);
  }
  return "";
};

export default function App() {
  const [pathname, setPathname] = useState(getPathname());
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authMessage, setAuthMessage] = useState("");
  const inviteCode = useMemo(getInviteCodeFromPath, [pathname]);
  const organizerRoute = isOrganizerPath(pathname);

  useEffect(() => {
    const onPopState = () => setPathname(getPathname());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (pathname === "/") {
      window.history.replaceState(null, "", "/user");
      setPathname("/user");
    }
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const authorize = async () => {
      if (organizerRoute) {
        try {
          await apiClient.getMe();
          if (!cancelled) setAuthState("authorized");
        } catch {
          if (!cancelled) {
            setAuthState("telegram_required");
            setAuthMessage(new URLSearchParams(window.location.search).get("auth_error") || "");
          }
        }
        return;
      }

      const initData = await getTelegramInitData();
      if (initData) {
        try {
          window.Telegram?.WebApp?.ready?.();
          window.Telegram?.WebApp?.expand?.();
          await apiClient.authTelegramMiniApp({ initData, inviteCode });
          await apiClient.getMe();
          if (!cancelled) setAuthState("authorized");
          return;
        } catch (error) {
          if (!cancelled) {
            setAuthState("failed");
            setAuthMessage(error instanceof Error ? error.message : "Telegram авторизация не прошла");
          }
          return;
        }
      }

      try {
        await apiClient.getMe();
        if (inviteCode) await apiClient.joinEvent(inviteCode);
        if (!cancelled) setAuthState("authorized");
        return;
      } catch {
        if (!cancelled) {
          setAuthState("telegram_required");
          setAuthMessage("Telegram не передал данные запуска. Закройте окно и откройте Mini App заново из Telegram.");
        }
      }
    };

    authorize();
    return () => {
      cancelled = true;
    };
  }, [inviteCode, organizerRoute, pathname]);

  if (authState !== "authorized") {
    if (organizerRoute) return <OrganizerLogin authMessage={authMessage} returnTo={pathname} />;
    if (pathname.startsWith("/join/")) return <JoinPage inviteCode={inviteCode || ""} authState={authState} authMessage={authMessage} />;
    return <LaunchState authState={authState} authMessage={authMessage} />;
  }

  const route = organizerRoute ? "admin" : "user";

  if (pathname.startsWith("/join/")) {
    window.history.replaceState(null, "", "/user");
  }

  return (
    <main className={route === "admin" ? "min-h-screen py-6" : "min-h-screen"}>
      {route === "admin" ? <OrganizerDashboard /> : <ParticipantApp />}
    </main>
  );
}

function OrganizerLogin({ authMessage, returnTo }: { authMessage: string; returnTo: string }) {
  const loginUrl = `/api/auth/telegram-login/start?returnTo=${encodeURIComponent(returnTo || "/organizer")}`;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-[560px] p-7 text-center sm:p-9">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-[24px] liquid-control text-2xl font-semibold text-[#0066cc]">
          F
        </div>
        <div className="liquid-control mx-auto inline-flex rounded-full px-4 py-2 text-[13px] font-semibold text-[#0066cc]">
          Кабинет организатора
        </div>
        <h1 className="mt-5 text-4xl font-semibold tracking-[-0.02em] text-[#1d1d1f]">Войдите через Telegram</h1>
        <p className="mt-4 text-[15px] leading-7 text-slate-600">
          Мы подтвердим Telegram-аккаунт через защищенный web-login. Если у вас уже есть организация, откроется кабинет; если нет — понадобится ключ доступа FUP.
        </p>
        <a className="liquid-blue button-press mt-7 inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-[15px] font-semibold text-white" href={loginUrl}>
          Войти через Telegram
        </a>
        {authMessage ? <p className="mt-5 text-[13px] leading-6 text-rose-500">{authMessage}</p> : null}
        <p className="mt-6 text-[13px] leading-6 text-slate-500">
          Если вы уже участник Mini App, будет использован тот же профиль по Telegram ID.
        </p>
      </Card>
    </main>
  );
}

function LaunchState({ authState, authMessage }: { authState: AuthState; authMessage: string }) {
  const isError = authState === "failed" || authState === "telegram_required";
  const [devLoginPending, setDevLoginPending] = useState(false);
  const [devLoginError, setDevLoginError] = useState("");

  const loginLocally = async () => {
    setDevLoginPending(true);
    setDevLoginError("");
    try {
      await apiClient.authLocalDevParticipant();
      window.location.reload();
    } catch (error) {
      setDevLoginPending(false);
      setDevLoginError(error instanceof Error ? error.message : "Локальный вход не сработал");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-[520px] p-7 text-center sm:p-9">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-[24px] liquid-control text-2xl font-semibold text-[#0066cc]">
          F
        </div>
        <h1 className="text-3xl font-semibold tracking-[-0.01em] text-[#1d1d1f]">
          {isError ? "Не удалось запустить FUP" : "Запускаем FUP"}
        </h1>
        <p className={`mt-4 text-[15px] leading-7 ${isError ? "text-rose-500" : "text-slate-600"}`}>
          {isError ? authMessage : "Получаем данные Telegram, создаем защищенную сессию и готовим ваши знакомства."}
        </p>
        {!isError ? (
          <div className="mx-auto mt-7 h-2 w-36 overflow-hidden rounded-full bg-white/60">
            <div className="h-full w-1/2 animate-[shelfIn_1.2s_ease-in-out_infinite] rounded-full bg-[#0071e3]" />
          </div>
        ) : null}
        {import.meta.env.DEV ? (
          <div className="mt-7 border-t border-white/60 pt-6">
            <p className="text-[13px] leading-6 text-slate-500">Локальный режим разработки открывает демо-участника без Telegram initData.</p>
            <button
              className="liquid-control button-press mt-4 inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-[15px] font-semibold text-[#0066cc] disabled:cursor-wait disabled:opacity-60"
              disabled={devLoginPending}
              onClick={() => void loginLocally()}
            >
              {devLoginPending ? "Входим..." : "Войти локально"}
            </button>
            {devLoginError ? <p className="mt-4 text-[13px] leading-6 text-rose-500">{devLoginError}</p> : null}
          </div>
        ) : null}
      </Card>
    </main>
  );
}

function JoinPage({ inviteCode, authState, authMessage }: { inviteCode: string; authState: AuthState; authMessage: string }) {
  const [eventInfo, setEventInfo] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getPublicEventByInvite(inviteCode)
      .then((data) => {
        if (!cancelled) setEventInfo(data as Record<string, any>);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Мероприятие не найдено");
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  const isChecking = authState === "checking";
  const isError = authState === "failed" || authState === "telegram_required";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-[620px] p-7 sm:p-9">
        <div className="liquid-control inline-flex rounded-full px-4 py-2 text-[13px] font-semibold text-[#0066cc]">
          Приглашение FUP
        </div>
        <h1 className="mt-5 text-4xl font-semibold tracking-[-0.02em] text-[#1d1d1f]">
          {eventInfo?.event?.name || "Подключение к мероприятию"}
        </h1>
        <p className="mt-4 text-[16px] leading-7 text-slate-600">
          {eventInfo?.event?.description ||
            "Откройте Mini App в Telegram, чтобы сохранить знакомства, поставить напоминания и вернуться к важным людям после события."}
        </p>
        {eventInfo?.organization?.name ? (
          <p className="mt-4 text-[14px] font-semibold text-slate-500">{eventInfo.organization.name}</p>
        ) : null}
        {inviteCode ? (
          <div className="mt-5 inline-flex rounded-full border border-white/70 bg-white/55 px-4 py-2 text-[14px] font-semibold text-slate-600">
            Код мероприятия: {inviteCode}
          </div>
        ) : null}
        {eventInfo?.telegramMiniAppUrl ? (
          <a
            className="liquid-blue button-press mt-6 inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-[15px] font-semibold text-white"
            href={eventInfo.telegramMiniAppUrl}
          >
            Открыть в Telegram
          </a>
        ) : null}
        {error ? <p className="mt-5 text-[14px] text-rose-500">{error}</p> : null}
        {isChecking ? <p className="mt-6 text-[14px] text-slate-500">Подключаем Telegram-сессию...</p> : null}
        {isError ? <p className="mt-6 text-[14px] text-rose-500">{authMessage}</p> : null}
        <p className="mt-6 text-[13px] leading-6 text-slate-500">
          FUP подключит вас к мероприятию автоматически после получения данных запуска от Telegram.
        </p>
      </Card>
    </main>
  );
}
