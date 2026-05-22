-- Run once in the Supabase SQL Editor.
-- Replace the placeholder cron secret before executing the Vault insert.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://fup-beta.vercel.app',
  'fup_webapp_url'
);

select vault.create_secret(
  'replace-with-vercel-cron-secret',
  'fup_cron_secret'
);

select cron.schedule(
  'fup-send-telegram-reminders',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'fup_webapp_url'
      ) || '/api/cron/reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'fup_cron_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $$
);

-- Verify the registered job:
-- select jobid, jobname, schedule from cron.job where jobname = 'fup-send-telegram-reminders';
