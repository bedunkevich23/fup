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

export const hapticSuccess = () => {
  navigator.vibrate?.(18);
};

export const hapticImpact = () => {
  navigator.vibrate?.(10);
};
