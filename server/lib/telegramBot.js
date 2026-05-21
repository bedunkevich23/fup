export async function sendTelegramReminder({ telegramId, followupId, contactName, context, nextStep }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Telegram bot token is not configured");
  }

  const text = `Напоминание FUP: вы хотели написать ${contactName}. Контекст: ${context}. Следующий шаг: ${nextStep}.`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "Я написал", callback_data: `fup:${followupId}:sent` },
        { text: "Назначил встречу", callback_data: `fup:${followupId}:meeting` },
      ],
      [
        { text: "Познакомил", callback_data: `fup:${followupId}:intro` },
        { text: "Отложить", callback_data: `fup:${followupId}:snooze` },
      ],
    ],
  };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramId,
      text,
      reply_markup,
    }),
  });

  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.description || "Telegram Bot API request failed");
  }
  return json.result;
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
