import crypto from "node:crypto";

const ISSUER = "https://oauth.telegram.org";
const AUTH_URL = `${ISSUER}/auth`;
const TOKEN_URL = `${ISSUER}/token`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const STATE_COOKIE = "fup_tg_login";
const STATE_TTL_SECONDS = 10 * 60;

let jwksCache = null;
let jwksCacheExpiresAt = 0;

const base64url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const hmac = (value) =>
  crypto
    .createHmac("sha256", process.env.APP_SESSION_SECRET || process.env.TELEGRAM_OIDC_CLIENT_SECRET || "fup-dev-secret")
    .update(value)
    .digest("base64url");

const safeReturnTo = (value) => {
  if (!value || typeof value !== "string") return "/organizer";
  if (!value.startsWith("/")) return "/organizer";
  if (value.startsWith("//")) return "/organizer";
  if (!value.startsWith("/organizer") && value !== "/admin") return "/organizer";
  return value;
};

const cookieSecure = () => ((process.env.WEBAPP_URL || "").startsWith("https://") ? "; Secure" : "");

function encodeStateCookie(payload) {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

function decodeStateCookie(value) {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = hmac(body);
  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.expiresAt || payload.expiresAt < Date.now()) return null;
  return payload;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf("=");
      return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
    })
    .find(([key]) => key === name)?.[1];
}

export function telegramLoginStateCookie(payload) {
  return `${STATE_COOKIE}=${encodeURIComponent(encodeStateCookie(payload))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}${cookieSecure()}`;
}

export function clearTelegramLoginStateCookie() {
  return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieSecure()}`;
}

export function readTelegramLoginState(req) {
  return decodeStateCookie(readCookie(req, STATE_COOKIE));
}

export function getTelegramOidcConfig() {
  return {
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID || process.env.TELEGRAM_LOGIN_CLIENT_ID || process.env.TELEGRAM_BOT_USERNAME,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET || process.env.TELEGRAM_LOGIN_CLIENT_SECRET,
    redirectUri:
      process.env.TELEGRAM_OIDC_REDIRECT_URI ||
      process.env.TELEGRAM_LOGIN_REDIRECT_URI ||
      `${process.env.WEBAPP_URL}/api/auth/telegram-login/callback`,
  };
}

export function createTelegramLoginStart(returnTo) {
  const { clientId, clientSecret, redirectUri } = getTelegramOidcConfig();
  if (!clientId || !clientSecret || !redirectUri) {
    const error = new Error("Telegram web login is not configured");
    error.status = 500;
    throw error;
  }

  const state = randomToken(24);
  const nonce = randomToken(24);
  const codeVerifier = randomToken(48);
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const payload = {
    state,
    nonce,
    codeVerifier,
    returnTo: safeReturnTo(returnTo),
    expiresAt: Date.now() + STATE_TTL_SECONDS * 1000,
  };
  const params = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    authUrl: `${AUTH_URL}?${params.toString()}`,
    stateCookie: telegramLoginStateCookie(payload),
  };
}

export async function exchangeTelegramCodeForToken({ code, codeVerifier }) {
  const { clientId, clientSecret, redirectUri } = getTelegramOidcConfig();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: String(clientId),
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id_token) {
    const error = new Error(payload.error_description || payload.error || "Telegram token exchange failed");
    error.status = 401;
    throw error;
  }
  return payload;
}

async function getTelegramJwks() {
  if (jwksCache && jwksCacheExpiresAt > Date.now()) return jwksCache;
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error("Telegram JWKS request failed");
  jwksCache = await response.json();
  jwksCacheExpiresAt = Date.now() + 60 * 60 * 1000;
  return jwksCache;
}

function verifyJwtSignature({ alg, key, signingInput, signature }) {
  const publicKey = crypto.createPublicKey({ key, format: "jwk" });
  if (alg === "RS256") {
    return crypto.createVerify("RSA-SHA256").update(signingInput).verify(publicKey, signature);
  }
  if (alg === "EdDSA") {
    return crypto.verify(null, Buffer.from(signingInput), publicKey, signature);
  }
  if (alg === "ES256") {
    return crypto.verify("sha256", Buffer.from(signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
  }
  throw new Error(`Unsupported Telegram id_token alg: ${alg}`);
}

export async function validateTelegramOidcIdToken(idToken, expectedNonce) {
  const { clientId } = getTelegramOidcConfig();
  const [encodedHeader, encodedPayload, encodedSignature] = String(idToken || "").split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("Telegram id_token is malformed");

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  const jwks = await getTelegramJwks();
  const key = jwks.keys?.find((item) => item.kid === header.kid) || jwks.keys?.find((item) => item.alg === header.alg);
  if (!key) throw new Error("Telegram signing key not found");

  const verified = verifyJwtSignature({
    alg: header.alg,
    key,
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: Buffer.from(encodedSignature, "base64url"),
  });
  if (!verified) throw new Error("Telegram id_token signature is invalid");

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== ISSUER) throw new Error("Telegram id_token issuer is invalid");
  if (!audience.includes(String(clientId))) throw new Error("Telegram id_token audience is invalid");
  if (payload.exp && Number(payload.exp) * 1000 < Date.now()) throw new Error("Telegram id_token expired");
  if (expectedNonce && payload.nonce !== expectedNonce) throw new Error("Telegram id_token nonce is invalid");

  return payload;
}

export function telegramUserFromOidcClaims(claims) {
  const nameParts = String(claims.name || "").trim().split(/\s+/).filter(Boolean);
  return {
    telegram_id: String(claims.id || claims.sub),
    username: claims.preferred_username,
    first_name: claims.given_name || nameParts[0],
    last_name: claims.family_name || nameParts.slice(1).join(" "),
    photo_url: claims.picture,
  };
}
