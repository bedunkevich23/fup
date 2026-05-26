const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const compactText = (value, fallback = "") => {
  const text = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return text || fallback;
};

const cadenceLabel = (cadenceKey) => {
  if (cadenceKey === "day1") return "1 день";
  if (cadenceKey === "day2") return "2 дня";
  if (cadenceKey === "week1") return "неделю";
  return "";
};

const TELEGRAM_BOT_USERNAME = "fupfupfup_bot";

export function getMiniAppUrl(startParam = "fup") {
  const bot = process.env.TELEGRAM_BOT_USERNAME || TELEGRAM_BOT_USERNAME;
  if (bot) {
    const username = bot.replace("@", "");
    return `https://t.me/${username}?startapp=${encodeURIComponent(startParam || "fup")}`;
  }
  return `${process.env.WEBAPP_URL || "http://localhost:3000"}/user`;
}

export function getMiniAppWebUrl(startParam = "fup") {
  const base = process.env.WEBAPP_URL || "http://localhost:3000";
  const url = new URL("/user", base);
  if (startParam) url.searchParams.set("startapp", startParam);
  return url.toString();
}

function miniAppReplyMarkup({ text = "Открыть FUP", startParam = "fup" } = {}) {
  const webAppUrl = getMiniAppWebUrl(startParam);
  const button = webAppUrl.startsWith("https://")
    ? { text, web_app: { url: webAppUrl } }
    : { text, url: getMiniAppUrl(startParam) };

  return {
    inline_keyboard: [[button]],
  };
}

async function sendTelegramMessage({ telegramId, text, parseMode = "HTML", replyMarkup }) {
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
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.description || "Telegram Bot API request failed");
  }
  return json.result;
}

export async function sendTelegramReminder({ telegramId, contactName, context, nextStep }) {
  const cleanContactName = escapeHtml(contactName || "контакт");
  const cleanContext = compactText(context);
  const cleanNextStep = escapeHtml(nextStep || "Написать");
  const text = [
    "<b>Пора вернуться к знакомству.</b>",
    "",
    `Ты хотел не потерять контакт с <b>${cleanContactName}</b>. Сейчас хороший момент сделать следующий шаг, пока контекст еще живой.`,
    "",
    `<b>Что сделать:</b>\n${cleanNextStep}`,
    cleanContext ? `\n<b>Контекст:</b>\n${escapeHtml(cleanContext)}` : "",
    "",
    "Открой FUP кнопкой ниже и отметь результат.",
  ].filter(Boolean).join("\n");

  return sendTelegramMessage({ telegramId, text, replyMarkup: miniAppReplyMarkup() });
}

export async function sendTelegramWelcome({ telegramId, firstName }) {
  const name = firstName ? `, ${escapeHtml(firstName)}` : "";
  const text = [
    `<b>Привет${name}! Это FUP.</b>`,
    "",
    "Я буду тихо помогать не терять полезные знакомства после событий: напоминать, кого открыть, кому написать и где дальше дожать контакт.",
    "",
    "Открой Mini App кнопкой ниже и начни с анкеты.",
  ].join("\n");

  return sendTelegramMessage({ telegramId, text, replyMarkup: miniAppReplyMarkup() });
}

export async function sendLifecycleNotification({ telegramId, type, cadenceKey, user, event, metadata }) {
  const firstName = escapeHtml(user?.first_name || user?.telegram_first_name || "");
  const eventName = escapeHtml(event?.name || metadata?.event_name || "события");
  const contactName = escapeHtml(metadata?.contact_name || "контакт");
  const nextStep = escapeHtml(metadata?.next_step || "Написать");
  const intro = firstName ? `${firstName}, ` : "";
  const waitLabel = cadenceLabel(cadenceKey);

  const contactNotWrittenIntro = {
    day1: [
      "<b>Вчера ты добавил новый контакт.</b>",
      "",
      "Самое время написать приветственное сообщение, пока искра не ушла. Достаточно пары строк: кто ты, где познакомились и зачем хочешь продолжить диалог.",
    ],
    day2: [
      "<b>Прошло два дня с нового знакомства.</b>",
      "",
      "Это все еще отличный момент вернуться к человеку: поделиться впечатлением о мероприятии, отправить полезную ссылку или предложить короткий созвон.",
    ],
    week1: [
      "<b>Прошла неделя после знакомства.</b>",
      "",
      "Пора мягко напомнить о себе. Можно написать без лишней официальности: спросить, как дела, и вернуться к теме, которую обсуждали.",
    ],
  };

  const noContactIntro = {
    day1: [
      "<b>Супер, профиль готов.</b>",
      "",
      "Теперь самое время для нетворкинга. Открой каталог участников и сохрани первый контакт, чтобы FUP потом напомнил о следующем шаге.",
    ],
    day2: [
      "<b>Профиль уже на месте, а база контактов пока пустая.</b>",
      "",
      "Попробуй найти одного человека по сфере, роли или запросу. Один сохраненный контакт уже превращает мероприятие в понятный следующий шаг.",
    ],
    week1: [
      "<b>Контакты сами себя не сохранят.</b>",
      "",
      `Если на ${eventName} был кто-то полезный, самое время занести его в FUP. Даже короткая заметка лучше, чем пытаться вспомнить все через месяц.`,
    ],
  };

  const templates = {
    bot_started_open_app: [
      `<b>${intro}ты нажал старт, но пока не открыл приложение.</b>`,
      "",
      "Зайди внутрь, чтобы посмотреть список участников и начать знакомиться. Это займет меньше 15 секунд.",
      "",
      "Открой FUP кнопкой ниже.",
    ],
    profile_incomplete: [
      `<b>${intro}анкета заполнена не до конца.</b>`,
      "",
      "Остался один шаг: допиши, кого ищешь и чем можешь быть полезен. Так другие участники смогут тебя найти, а ты увидишь подходящих людей.",
      "",
      "Открой FUP кнопкой ниже и заверши анкету.",
    ],
    no_contact_after_profile: [
      ...(noContactIntro[cadenceKey] || noContactIntro.day1),
      "",
      `<b>Событие:</b>\n${eventName}`,
      "",
      "Открой FUP кнопкой ниже и перейди в Контакты.",
    ],
    contact_not_written: [
      ...(contactNotWrittenIntro[cadenceKey] || contactNotWrittenIntro.day1),
      "",
      `<b>Контакт:</b>\n${contactName}`,
      "",
      `<b>Что сделать:</b>\n${nextStep}`,
      waitLabel ? `\nFUP ждет уже ${waitLabel}, поэтому лучше закрыть этот шаг сейчас.` : "",
      "",
      "Открой FUP кнопкой ниже и отметь, что получилось.",
    ],
  };

  const lines = templates[type] || [
    `<b>${intro}FUP напоминает.</b>`,
    "",
    "Открой приложение кнопкой ниже и проверь следующий шаг.",
  ];

  return sendTelegramMessage({ telegramId, text: lines.join("\n"), replyMarkup: miniAppReplyMarkup() });
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
