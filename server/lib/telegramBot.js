const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function getMiniAppUrl(startParam = "fup") {
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  if (bot) {
    const username = bot.replace("@", "");
    return `https://t.me/${username}?startapp=${encodeURIComponent(startParam || "fup")}`;
  }
  return `${process.env.WEBAPP_URL || "http://localhost:3000"}/user`;
}

async function sendTelegramMessage({ telegramId, text, parseMode = "HTML" }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Telegram bot token is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });

  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.description || "Telegram Bot API request failed");
  }
  return json.result;
}

export async function sendTelegramReminder({ telegramId, contactName, context, nextStep }) {
  const miniAppUrl = getMiniAppUrl();
  const cleanContext = String(context || "").trim();
  const text = [
    "<b>FUP напоминает</b>",
    "",
    `Вы хотели вернуться к контакту: <b>${escapeHtml(contactName || "контакту")}</b>`,
    cleanContext ? `\n<b>Контекст</b>\n${escapeHtml(cleanContext)}` : "",
    `\n<b>Следующий шаг</b>\n${escapeHtml(nextStep || "Написать")}`,
    "",
    `Откройте Mini App и отметьте, что получилось: <a href="${miniAppUrl}">Открыть FUP</a>`,
  ].filter(Boolean).join("\n");

  return sendTelegramMessage({ telegramId, text });
}

export async function sendTelegramWelcome({ telegramId, firstName }) {
  const miniAppUrl = getMiniAppUrl();
  const name = firstName ? `, ${escapeHtml(firstName)}` : "";
  const text = [
    `<b>Привет${name}! Это FUP.</b>`,
    "",
    "Я буду тихо помогать не терять полезные знакомства после событий: напоминать, кого открыть, кому написать и где дальше дожать контакт.",
    "",
    `Начните с Mini App: <a href="${miniAppUrl}">открыть FUP</a>`,
  ].join("\n");

  return sendTelegramMessage({ telegramId, text });
}

export async function sendLifecycleNotification({ telegramId, type, user, event, metadata }) {
  const miniAppUrl = getMiniAppUrl("fup");
  const firstName = escapeHtml(user?.first_name || user?.telegram_first_name || "");
  const eventName = escapeHtml(event?.name || metadata?.event_name || "события");
  const contactName = escapeHtml(metadata?.contact_name || "контакта");
  const nextStep = escapeHtml(metadata?.next_step || "написать");
  const intro = firstName ? `${firstName}, ` : "";
  const templates = {
    bot_started_open_app: [
      `<b>${intro}FUP уже на месте.</b>`,
      "",
      "Остался один маленький шаг: открыть Mini App, чтобы я понял, к какому событию вас подключить.",
      "",
      `Жмите сюда: <a href="${miniAppUrl}">открыть FUP</a>`,
    ],
    profile_incomplete: [
      `<b>${intro}анкета почти просится наружу.</b>`,
      "",
      "Заполните пару полей, и участники смогут понять, с чем к вам подходить и чем вы можете быть полезны.",
      "",
      `Давайте добьем красиво: <a href="${miniAppUrl}">открыть анкету</a>`,
    ],
    no_contact_after_profile: [
      `<b>${intro}у вас уже есть профиль на ${eventName}.</b>`,
      "",
      "Теперь самое вкусное: сохранить хотя бы одно полезное знакомство. Так FUP сможет напомнить о следующем шаге, а не просто красиво лежать в телефоне.",
      "",
      `Открыть участников: <a href="${miniAppUrl}">перейти в FUP</a>`,
    ],
    contact_not_written: [
      `<b>${intro}контакт с ${contactName} еще теплый.</b>`,
      "",
      `Следующий шаг: <b>${nextStep}</b>`,
      "",
      "Лучше написать, пока контекст не растворился в неделе. FUP уже держит ниточку.",
      "",
      `Открыть карточку: <a href="${miniAppUrl}">перейти в FUP</a>`,
    ],
  };

  const lines = templates[type] || [
    `<b>${intro}FUP напоминает.</b>`,
    "",
    `Откройте Mini App и проверьте следующий шаг: <a href="${miniAppUrl}">перейти в FUP</a>`,
  ];

  return sendTelegramMessage({ telegramId, text: lines.join("\n") });
}

export async function answerTelegramCallbackQuery({ callbackQueryId, text }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !callbackQueryId) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    }),
  }).catch(() => undefined);
}
