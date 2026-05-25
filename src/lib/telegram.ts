import type { Contact, FollowUp, User } from "../types";

export const getTelegramUserMock = (): Pick<User, "telegram_id" | "username" | "name"> => ({
  telegram_id: "109001",
  username: "simon_founder",
  name: "Симон Бедункевич",
});

export const openTelegramMiniApp = () => {
  window.alert("Откройте FUP внутри Telegram.");
};

export const isTelegramWebApp = () => Boolean((window as Window & { Telegram?: unknown }).Telegram);

export const openTelegramLink = (username?: string) => {
  if (!username) return;
  const normalized = username.replace("@", "").replace("https://t.me/", "");
  const url = `https://t.me/${normalized}`;
  const webApp = (window as Window & { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } }).Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

export const sendReminderMock = (contact: Contact, followUp: FollowUp) =>
  `Напоминание FUP: вы хотели написать ${contact.contact_name}. Контекст: ${contact.context}. Следующий шаг: ${contact.next_step || (contact as Contact & { next_step_text?: string }).next_step_text || (followUp as FollowUp & { next_step_text?: string }).next_step_text || "Написать"}. Напоминание: ${new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(followUp.remind_at || (followUp as FollowUp & { due_at?: string }).due_at || Date.now()))}.`;

type HapticImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type HapticNotificationType = "success" | "warning" | "error";
type TelegramHapticFeedback = {
  impactOccurred?: (style: HapticImpactStyle) => void;
  notificationOccurred?: (type: HapticNotificationType) => void;
  selectionChanged?: () => void;
};
type TelegramBackButton = {
  show?: () => void;
  hide?: () => void;
  onClick?: (callback: () => void) => void;
  offClick?: (callback: () => void) => void;
};

const telegramHaptics = () =>
  (window as Window & {
    Telegram?: { WebApp?: { HapticFeedback?: TelegramHapticFeedback } };
  }).Telegram?.WebApp?.HapticFeedback;

export const getTelegramBackButton = () =>
  (window as Window & {
    Telegram?: { WebApp?: { BackButton?: TelegramBackButton } };
  }).Telegram?.WebApp?.BackButton;

const fireHaptic = (callback: ((feedback: TelegramHapticFeedback) => void) | undefined, fallbackMs: number) => {
  const feedback = telegramHaptics();
  if (feedback && callback) {
    try {
      callback(feedback);
      return;
    } catch {
      // Fall through to the browser vibration fallback for local tests.
    }
  }
  navigator.vibrate?.(fallbackMs);
};

export const hapticSuccess = () => {
  fireHaptic((feedback) => feedback.notificationOccurred?.("success"), 18);
};

export const hapticError = () => {
  fireHaptic((feedback) => feedback.notificationOccurred?.("error"), 18);
};

export const hapticImpact = (style: HapticImpactStyle = "light") => {
  fireHaptic((feedback) => feedback.impactOccurred?.(style), style === "heavy" ? 18 : 10);
};

export const hapticSelection = () => {
  fireHaptic((feedback) => feedback.selectionChanged?.(), 8);
};
