-- Run once in the Supabase SQL Editor after supabase/reminder-cron.sql.
-- This keeps the existing cron job. The cron still calls /api/cron/reminders every 5 minutes;
-- the backend will now also send lifecycle bot notifications from this table.

create extension if not exists pgcrypto with schema public;

alter table public.users
  add column if not exists bot_started_at timestamptz,
  add column if not exists bot_last_seen_at timestamptz;

alter table public.contacts
  add column if not exists is_archived boolean not null default false;

create table if not exists public.bot_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  telegram_chat_id text,
  notification_type text not null check (
    notification_type in (
      'bot_started_open_app',
      'profile_incomplete',
      'no_contact_after_profile',
      'contact_not_written'
    )
  ),
  cadence_key text not null check (cadence_key in ('day1', 'day2', 'week1')),
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  telegram_message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_notifications_due_idx
  on public.bot_notifications (status, scheduled_at)
  where status = 'pending';

create index if not exists bot_notifications_user_idx
  on public.bot_notifications (user_id, notification_type, cadence_key);

create unique index if not exists bot_notifications_unique_lifecycle_idx
  on public.bot_notifications (
    user_id,
    notification_type,
    cadence_key,
    coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(metadata->>'contact_id', '')
  );

create or replace function public.fup_enqueue_lifecycle_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Cancel nudges that are no longer relevant.
  update public.bot_notifications bn
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  from public.users u
  where bn.user_id = u.id
    and bn.status = 'pending'
    and bn.notification_type = 'bot_started_open_app'
    and u.miniapp_first_seen_at is not null;

  update public.bot_notifications bn
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  from public.users u
  where bn.user_id = u.id
    and bn.status = 'pending'
    and bn.notification_type = 'profile_incomplete'
    and u.profile_completed_at is not null;

  update public.bot_notifications bn
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  where bn.status = 'pending'
    and bn.notification_type = 'no_contact_after_profile'
    and exists (
      select 1
      from public.contacts c
      where c.owner_user_id = bn.user_id
        and c.event_id = bn.event_id
        and coalesce(c.is_archived, false) = false
    );

  update public.bot_notifications bn
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  where bn.status = 'pending'
    and bn.notification_type = 'contact_not_written'
    and exists (
      select 1
      from public.outcomes o
      where o.contact_id::text = bn.metadata->>'contact_id'
        and o.owner_user_id = bn.user_id
        and o.type in ('message_sent', 'meeting_booked', 'person_introduced')
    );

  -- 1. User pressed /start in bot but never opened Mini App.
  insert into public.bot_notifications (
    user_id,
    telegram_chat_id,
    notification_type,
    cadence_key,
    scheduled_at,
    metadata
  )
  select
    u.id,
    u.telegram_chat_id,
    'bot_started_open_app',
    cadence.key,
    u.bot_started_at + cadence.delay,
    jsonb_build_object('reason', 'bot_started_without_miniapp')
  from public.users u
  cross join (
    values
      ('day1', interval '1 day'),
      ('day2', interval '2 days'),
      ('week1', interval '7 days')
  ) as cadence(key, delay)
  where u.telegram_chat_id is not null
    and u.bot_started_at is not null
    and u.miniapp_first_seen_at is null
  on conflict do nothing;

  -- 2. User opened Mini App but did not finish profile.
  insert into public.bot_notifications (
    user_id,
    telegram_chat_id,
    notification_type,
    cadence_key,
    scheduled_at,
    metadata
  )
  select
    u.id,
    u.telegram_chat_id,
    'profile_incomplete',
    cadence.key,
    u.miniapp_first_seen_at + cadence.delay,
    jsonb_build_object('reason', 'profile_incomplete')
  from public.users u
  cross join (
    values
      ('day1', interval '1 day'),
      ('day2', interval '2 days'),
      ('week1', interval '7 days')
  ) as cadence(key, delay)
  where u.telegram_chat_id is not null
    and u.miniapp_first_seen_at is not null
    and u.profile_completed_at is null
  on conflict do nothing;

  -- 3. Profile is complete, but there are still no saved contacts in the latest event.
  insert into public.bot_notifications (
    user_id,
    event_id,
    telegram_chat_id,
    notification_type,
    cadence_key,
    scheduled_at,
    metadata
  )
  select
    u.id,
    latest_event.event_id,
    u.telegram_chat_id,
    'no_contact_after_profile',
    cadence.key,
    u.profile_completed_at + cadence.delay,
    jsonb_build_object(
      'event_name', latest_event.event_name,
      'invite_code', latest_event.invite_code
    )
  from public.users u
  join lateral (
    select em.event_id, e.name as event_name, e.invite_code
    from public.event_members em
    join public.events e on e.id = em.event_id
    where em.user_id = u.id
    order by coalesce(em.last_activity_at, em.joined_at) desc nulls last
    limit 1
  ) latest_event on true
  cross join (
    values
      ('day1', interval '1 day'),
      ('day2', interval '2 days'),
      ('week1', interval '7 days')
  ) as cadence(key, delay)
  where u.telegram_chat_id is not null
    and u.profile_completed_at is not null
    and not exists (
      select 1
      from public.contacts c
      where c.owner_user_id = u.id
        and c.event_id = latest_event.event_id
        and coalesce(c.is_archived, false) = false
    )
  on conflict do nothing;

  -- 4. User saved a contact, but did not mark the follow-up as done/result.
  insert into public.bot_notifications (
    user_id,
    event_id,
    telegram_chat_id,
    notification_type,
    cadence_key,
    scheduled_at,
    metadata
  )
  select
    u.id,
    c.event_id,
    u.telegram_chat_id,
    'contact_not_written',
    cadence.key,
    c.created_at + cadence.delay,
    jsonb_build_object(
      'contact_id', c.id::text,
      'contact_name', coalesce(c.contact_name, 'контакта'),
      'next_step', coalesce(c.next_step_text, 'написать'),
      'event_name', e.name,
      'invite_code', e.invite_code
    )
  from public.contacts c
  join public.users u on u.id = c.owner_user_id
  left join public.events e on e.id = c.event_id
  cross join (
    values
      ('day1', interval '1 day'),
      ('day2', interval '2 days'),
      ('week1', interval '7 days')
  ) as cadence(key, delay)
  where u.telegram_chat_id is not null
    and coalesce(c.is_archived, false) = false
    and not exists (
      select 1
      from public.outcomes o
      where o.contact_id = c.id
        and o.owner_user_id = c.owner_user_id
        and o.type in ('message_sent', 'meeting_booked', 'person_introduced')
    )
  on conflict do nothing;
end;
$$;

-- Run manually to verify it inserts rows without waiting for cron:
-- select public.fup_enqueue_lifecycle_notifications();
-- select notification_type, cadence_key, scheduled_at, status, metadata
-- from public.bot_notifications
-- order by created_at desc
-- limit 20;
