import { useEffect, useMemo, useState } from "react";
import { OrganizerDashboard } from "./components/organizer/OrganizerDashboard";
import { ParticipantApp } from "./components/participant/ParticipantApp";
import { Card } from "./components/ui/Card";
import fupLogoUrl from "./assets/fup/logo.svg";
import starBackgroundUrl from "./assets/fup/star-background.svg";
import { apiClient } from "./lib/apiClient";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
        requestFullscreen?: () => void;
        setHeaderColor?: (color: string) => void;
        platform?: string;
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
          const telegramApp = window.Telegram?.WebApp;
          telegramApp?.ready?.();
          telegramApp?.expand?.();
          try {
            telegramApp?.setHeaderColor?.("#ffffff");
            if (!["tdesktop", "macos", "web", "weba", "webk"].includes(String(telegramApp?.platform || ""))) {
              telegramApp?.requestFullscreen?.();
            }
          } catch {
            // Fullscreen is client-dependent; auth should continue if it is unavailable.
          }
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
    <main className="mx-auto min-h-[100dvh] w-full max-w-[430px] overflow-hidden bg-white shadow-[0_24px_70px_rgba(29,29,31,0.10)] sm:my-5 sm:min-h-[min(860px,calc(100dvh-40px))] sm:rounded-[34px] sm:border sm:border-white/70">
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-[max(28px,env(safe-area-inset-top))] sm:min-h-[min(860px,calc(100dvh-40px))]">
        <LaunchBackdrop />
        <section className="fup-panel relative z-10 w-full animate-[shelfIn_420ms_ease_both] rounded-[38px] px-5 py-7 text-center">
          <img src={fupLogoUrl} alt="FUP" className="mx-auto h-[42px] w-auto" />
          <h1 className="fup-display mt-8 text-[27px] leading-[1.08] text-black">
            {isError ? "Не удалось открыть FUP" : "Открываем FUP"}
          </h1>
          <p className={`mx-auto mt-4 max-w-[300px] text-[14px] leading-6 ${isError ? "text-rose-500" : "text-[#5f6873]"}`}>
            {isError ? authMessage : "Проверяем Telegram и готовим ваши встречи."}
          </p>
          {!isError ? (
            <div className="fup-subpanel mx-auto mt-7 h-3 w-full max-w-[216px] overflow-hidden rounded-full p-0.5">
              <div className="fup-launch-progress h-full rounded-full bg-[#0087ff] shadow-[0_8px_22px_rgba(0,135,255,0.28)]" />
            </div>
          ) : null}
          {import.meta.env.DEV ? (
            <div className="fup-subpanel mt-7 rounded-[28px] px-4 py-5">
              <p className="text-[13px] leading-6 text-[#6b7480]">Локальный режим открывает демо-участника без Telegram initData.</p>
              <button
                className="button-press mt-4 inline-flex h-12 w-full items-center justify-center rounded-[24px] bg-white/70 px-5 text-[14px] font-semibold text-[#0066cc] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(23,36,51,0.08)] disabled:cursor-wait disabled:opacity-60"
                disabled={devLoginPending}
                onClick={() => void loginLocally()}
              >
                {devLoginPending ? "Входим..." : "Войти локально"}
              </button>
              {devLoginError ? <p className="mt-4 text-[13px] leading-6 text-rose-500">{devLoginError}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function LaunchBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-white">
      <img className="fup-home-star fup-home-star-top" src={starBackgroundUrl} alt="" />
      <img className="fup-home-star fup-home-star-left" src={starBackgroundUrl} alt="" />
      <img className="fup-home-star fup-home-star-right" src={starBackgroundUrl} alt="" />
      <div className="fup-home-haze" />
    </div>
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
