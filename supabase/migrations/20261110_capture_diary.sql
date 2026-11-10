-- Gainora Capture & Convert: the clinic's own calendar or booking system, connected to the diary.
-- Run AFTER 20261108_capture_convert.sql, in the same project. Additive and idempotent: it only adds a table.
--
-- Each row is one connection (Google Calendar or Cliniko) for one clinic. The secret (a Google refresh token
-- or a Cliniko API key) is encrypted by the app before it is stored (AES-256-GCM), so the database never holds
-- it in plain text. Only the server reads this table: row-level security is on with no policies, so the app in
-- the browser can't see it. Deleting the account deletes its connections.

create table if not exists public.diary_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','cliniko')),
  secret text not null,                         -- encrypted; never shown again after connecting
  account jsonb not null default '{}'::jsonb,   -- calendars, ids and who is who; nothing secret
  status text not null default 'connected' check (status in ('connected','error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create index if not exists diary_connections_user_idx on public.diary_connections(user_id);
alter table public.diary_connections enable row level security;

-- Booking page addresses are looked up from the clinic's settings; this keeps that quick.
create index if not exists capture_settings_page_slug_idx on public.capture_settings ((data->'page'->>'slug'));
