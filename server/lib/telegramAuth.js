import crypto from "node:crypto";

const maxAuthAgeSeconds = 60 * 60 * 24;

const hmacHex = (key, value) => crypto.createHmac("sha256", key).update(value).digest("hex");

const safeEqualHex = (expected, provided) => {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  if (!/^[a-f0-9]+$/i.test(expected) || !/^[a-f0-9]+$/i.test(provided)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

const sortDataCheckString = (entries) =>
  entries
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

function ensureFresh(authDate) {
  if (!authDate) return;
  const age = Math.floor(Date.now() / 1000) - Number(authDate);
  if (Number.isFinite(age) && age > maxAuthAgeSeconds) {
    throw new Error("Telegram auth payload expired");
  }
}

export function validateTelegramMiniAppInitData(initData, botToken) {
  if (!initData || !botToken) throw new Error("Telegram initData or bot token is missing");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Telegram initData hash is missing");

  const dataCheckString = sortDataCheckString([...params.entries()]);
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = hmacHex(secretKey, dataCheckString);
  if (!safeEqualHex(expectedHash, hash)) {
    throw new Error("Invalid Telegram Mini App initData hash");
  }

  ensureFresh(params.get("auth_date"));
  const user = JSON.parse(params.get("user") || "{}");
  return {
    telegram_id: String(user.id),
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    photo_url: user.photo_url,
  };
}

export const validateMiniAppInitData = validateTelegramMiniAppInitData;

export function validateLoginWidgetPayload(payload, botToken) {
  if (!payload || !botToken) throw new Error("Telegram login payload or bot token is missing");
  const hash = payload.hash;
  if (!hash) throw new Error("Telegram login hash is missing");

  const dataCheckString = sortDataCheckString(Object.entries(payload));
  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expectedHash = hmacHex(secretKey, dataCheckString);
  if (!safeEqualHex(expectedHash, hash)) {
    throw new Error("Invalid Telegram Login Widget hash");
  }

  ensureFresh(payload.auth_date);
  return {
    telegram_id: String(payload.id),
    username: payload.username,
    first_name: payload.first_name,
    last_name: payload.last_name,
    photo_url: payload.photo_url,
  };
}

export function getDevTelegramUser() {
  return {
    telegram_id: "109001",
    username: "simon_founder",
    first_name: "Симон",
    last_name: "Бедункевич",
    photo_url: null,
  };
}
