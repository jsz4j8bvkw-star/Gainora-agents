-- Gainora Agents v3: the owner's clients, their visits, the messages Gainora drafted and the owner
-- sent, and the bookings the owner confirmed came from them (the money number).
-- Run AFTER 20261102_gainora_agents.sql and 20261107_gainora_agents_v2.sql, in the same project.
-- Additive and idempotent: it only adds tables and never changes or deletes existing rows.
--
-- Unlike the agents' own tables, these belong to the owner and are written by the app directly
-- (PostgREST under row-level security), the same way profiles and actions are: the owner adds a
-- client, logs a visit, marks a booking. The Netlify functions read them with the service role for
-- the morning digest and the monthly email. Until this migration has run, the app shows "Your
-- clients is being set up" and never fails.
--
-- Personal data: names, mobiles, emails and visit history are the owner's client records (the owner
-- is the data controller). Nothing here is shared between accounts. Deleting a client cascades to
-- their visits, messages and outcomes; deleting the account (auth.users) cascades to everything.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  phone text not null default '',            -- normalised UK mobile (+447…) or '' (shared/clients.ts normalisePhone)
  phone_raw text,                            -- what was typed, kept when it was not a mobile
  email text not null default '',
  consent text not null default 'unknown' check (consent in ('opted_in','soft_opt_in','opted_out','unknown')),
  consent_at timestamptz,
  consent_source text check (consent_source in ('owner','import','stop')),
  interval_weeks int check (interval_weeks is null or interval_weeks between 1 and 156),   -- the owner's gap for this client
  snoozed_until timestamptz,
  not_coming_back boolean not null default false,
  last_review_ask_at timestamptz,
  notes text,                                -- private to the owner; never sent to the AI
  source text not null default 'manual' check (source in ('manual','import')),
  imported_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_user_idx on public.clients(user_id, created_at desc);
create index if not exists clients_user_phone_idx on public.clients(user_id, phone) where phone <> '';
create index if not exists clients_user_email_idx on public.clients(user_id, lower(email)) where email <> '';

create table if not exists public.client_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  visited_on date not null,
  treatment text not null default 'Visit',
  treatment_id text,                         -- catalogue id from shared/treatments.ts when the name matched
  amount numeric(10,2) check (amount is null or amount >= 0),
  practitioner text,
  created_at timestamptz not null default now()
);
create index if not exists client_visits_user_idx on public.client_visits(user_id, visited_on desc);
create index if not exists client_visits_client_idx on public.client_visits(client_id, visited_on desc);

-- Every message Gainora drafted and the owner approved and sent (or copied), and every response pack used.
create table if not exists public.client_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,    -- null for a public caption or website line
  kind text not null check (kind in ('rebook','review_request','quiet_day','competitor_response')),
  channel text not null check (channel in ('sms_phone','sms_twilio','copy','instagram','website')),
  text text not null default '',
  treatment_id text,
  amount_hint numeric(10,2),                 -- the client's last price for the treatment, for pre-filling the outcome
  ref text,                                  -- the competitor event or review it answers
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists client_actions_user_idx on public.client_actions(user_id, sent_at desc);
create index if not exists client_actions_client_idx on public.client_actions(client_id, sent_at desc);

-- Bookings attributed to Gainora. Only 'confirmed' rows count in the headline; 'likely' rows are visits
-- logged within 21 days of a message and wait for the owner to confirm or dismiss them.
create table if not exists public.client_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid references public.client_actions(id) on delete set null,
  client_id uuid references public.clients(id) on delete cascade,
  visit_id uuid references public.client_visits(id) on delete set null,
  amount numeric(10,2) check (amount is null or amount >= 0),
  status text not null default 'likely' check (status in ('confirmed','likely','dismissed')),
  happened_at timestamptz not null default now(),
  title text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, visit_id)                 -- a visit is counted once
);
create index if not exists client_outcomes_user_idx on public.client_outcomes(user_id, happened_at desc);
create index if not exists client_outcomes_status_idx on public.client_outcomes(user_id, status);

-- Row-level security: the owner reads and writes their own rows; nobody else sees them. ---------
alter table public.clients         enable row level security;
alter table public.client_visits   enable row level security;
alter table public.client_actions  enable row level security;
alter table public.client_outcomes enable row level security;

do $$
begin
  drop policy if exists "own clients" on public.clients;
  create policy "own clients" on public.clients for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  drop policy if exists "own client visits" on public.client_visits;
  create policy "own client visits" on public.client_visits for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  drop policy if exists "own client actions" on public.client_actions;
  create policy "own client actions" on public.client_actions for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  drop policy if exists "own client outcomes" on public.client_outcomes;
  create policy "own client outcomes" on public.client_outcomes for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
end $$;

-- Keeps updated_at honest on clients.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();

-- Reminders the daily job has already sent, so the owner is told once per client becoming due.
-- Service-only (RLS on, no client policies).
create table if not exists public.client_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  due_on date not null,
  reminded_at timestamptz not null default now(),
  primary key (user_id, client_id, due_on)
);
alter table public.client_reminders enable row level security;
