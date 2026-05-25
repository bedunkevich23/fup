-- Run once in the Supabase SQL Editor if the production enum does not yet
-- include analytics events emitted by contact/task deletion.
alter type public.analytics_action_type add value if not exists 'contact_archived';
alter type public.analytics_action_type add value if not exists 'followup_cancelled';
