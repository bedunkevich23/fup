import crypto from "node:crypto";

const COOKIE_NAME = "fup_session";

export function createRawSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function readSessionCookie(req) {
  const raw = req.headers.cookie || "";
  const cookies = Object.fromEntries(
    raw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      }),
  );
  return cookies[COOKIE_NAME];
}

export function sessionCookie(token) {
  const webappUrl = process.env.WEBAPP_URL || "";
  const secure = webappUrl.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Priority=High${secure}`;
}

export function clearSessionCookie() {
  const webappUrl = process.env.WEBAPP_URL || "";
  const secure = webappUrl.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Priority=High${secure}`;
}
