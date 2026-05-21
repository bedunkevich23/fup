# FUP Backend / Supabase Checklist

Backend runs as a local Node API server and uses Supabase only server-side through the service role key.
Frontend table writes must go through `/api/*`.

## 1. Prepare Supabase

1. Run the project SQL schema in Supabase.
2. Ensure RLS is enabled.
3. Do not add open anon policies for private tables.
4. Create storage buckets when needed:
   - `avatars`
   - `event-covers`
   - `reports`

## 2. Env

Copy the example and fill local secrets:

```bash
cp .env.local.example .env.local
```

Required variables:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
VITE_TELEGRAM_BOT_USERNAME=
TELEGRAM_OIDC_CLIENT_ID=
TELEGRAM_OIDC_CLIENT_SECRET=
TELEGRAM_OIDC_REDIRECT_URI=
TELEGRAM_WEBHOOK_SECRET=
APP_SESSION_SECRET=
ORGANIZER_ACCESS_CODE=
CRON_SECRET=
WEBAPP_URL=
NODE_ENV=development
API_PORT=8787
NEXT_PUBLIC_USE_BACKEND=true
VITE_USE_BACKEND=true
```

Never commit `.env`, `.env.local`, `*.env`, service keys, tokens, access codes, or passwords.

## 3. Start

In one terminal:

```bash
bun run api
```

In another terminal:

```bash
bun run dev
```

Frontend opens on `http://localhost:3000`, API opens on `http://localhost:8787`.

## 4. Telegram Mini App URLs

Production Mini App / Menu Button / Web App URL:

```bash
https://fup-beta.vercel.app
```

Production organizer Telegram OIDC redirect URL:

```bash
https://fup-beta.vercel.app/api/auth/telegram-login/callback
```

### Local Telegram Mini App Test With ngrok

1. Start the local API server:

```bash
bun run api
```

2. Start the local frontend server:

```bash
bun run dev
```

3. Start ngrok:

```bash
ngrok http 3000
```

4. Copy the HTTPS ngrok URL, for example:

```bash
https://xxxx.ngrok-free.app
```

5. Set it in `.env.local`:

```bash
WEBAPP_URL=https://xxxx.ngrok-free.app
```

6. Restart both local servers.

7. In BotFather, set the Mini App / Menu Button / Web App URL to:

```bash
https://xxxx.ngrok-free.app
```

8. Open the Mini App inside Telegram.

9. Confirm the frontend detects `window.Telegram.WebApp.initData`.

10. Confirm `POST /api/auth/telegram-miniapp` creates or updates the user in Supabase.

11. Check the current session:

```bash
curl -i http://localhost:8787/api/me
```

12. Open:

```bash
https://xxxx.ngrok-free.app/organizer
```

13. Enter `ORGANIZER_ACCESS_CODE`, create an organization, then create an event and check invite link and QR on the event page.

## Organizer Web Login With Telegram

Organizer dashboard uses Telegram OIDC web login, not Mini App `initData`.

Allowed production redirect URL in BotFather:

```bash
https://fup-beta.vercel.app/api/auth/telegram-login/callback
```

Open production organizer dashboard:

```bash
https://fup-beta.vercel.app/organizer
```

Flow:

1. Click “Войти через Telegram”.
2. Backend redirects to Telegram OIDC with PKCE.
3. Telegram redirects back to `/api/auth/telegram-login/callback`.
4. Backend validates `id_token`, upserts `public.users` by `telegram_id`, creates `public.app_sessions`, and redirects to `/organizer`.
5. Access to organizer data is controlled by `public.organization_members`.
6. First organization creation requires `ORGANIZER_ACCESS_CODE`; the creator becomes `owner`.

## Telegram Bot Reminders

Set the webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\":\"$WEBAPP_URL/api/telegram/webhook\",
    \"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\"
  }"
```

Run reminders from a scheduler every 1-5 minutes:

```bash
curl -X POST "$WEBAPP_URL/api/cron/reminders" \
  -H "X-Cron-Secret: $CRON_SECRET"
```

Recommended production scheduler: Supabase Scheduled Edge Function, Vercel Cron, Render Cron, Railway Cron, or another server-side scheduler that can send the `X-Cron-Secret` header.

## 5. Smoke Tests

Health:

```bash
curl http://localhost:8787/api/health
```

Supabase connection:

```bash
curl http://localhost:8787/api/supabase/health
```

Demo event:

```bash
curl http://localhost:8787/api/dev/demo-event
```

Demo dashboard:

```bash
curl http://localhost:8787/api/dev/dashboard
```

Current authenticated user:

```bash
curl -i http://localhost:8787/api/me
```

Update profile:

```bash
curl -X POST http://localhost:8787/api/profile \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Демо",
    "last_name": "Участник",
    "role": "Основатель",
    "looking_for": "Партнерства и пилотных клиентов",
    "can_help_with": "MVP, продукт, запуск пилотов",
    "company": "FUP Demo",
    "education": "Demo University",
    "field": "SaaS",
    "city": "Москва",
    "is_visible": true
  }'
```

Join event:

```bash
curl -X POST http://localhost:8787/api/events/join \
  -H "Content-Type: application/json" \
  -d '{"inviteCode":"demo2026"}'
```

Create contact + follow-up + reminder:

```bash
curl -X POST http://localhost:8787/api/events/<EVENT_ID>/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "contactName": "Ирина из клуба",
    "contactUsername": "irina_club",
    "source": "manual",
    "whereMet": "Нетворкинг",
    "context": "Обсудили партнерский вебинар",
    "nextStepType": "message",
    "nextStepText": "Написать и отправить материалы",
    "remindAt": "2026-05-20T10:00:00.000Z"
  }'
```

Follow-up action:

```bash
curl -X POST http://localhost:8787/api/followups/<FOLLOWUP_ID>/action \
  -H "Content-Type: application/json" \
  -d '{"action":"message_sent"}'
```

Organizer events:

```bash
curl -i http://localhost:8787/api/org/events
```

Organizer dashboard:

```bash
curl http://localhost:8787/api/org/events/<EVENT_ID>/dashboard
```

Report:

```bash
curl http://localhost:8787/api/org/events/<EVENT_ID>/report
```

## Notes

- Protected endpoints use the `fup_session` httpOnly cookie.
- `POST /api/auth/telegram-miniapp` validates Telegram `initData` server-side with `TELEGRAM_BOT_TOKEN`.
- `POST /api/dev/grant-organizer-access` works only in development.
- Telegram Login Widget auth, payments, PDF export, and AI matching are intentionally out of scope for this step.
