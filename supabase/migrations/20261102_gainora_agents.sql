-- Gainora Agents: client app schema.
-- Run in a NEW Supabase project (separate from Pablo). Additive and idempotent.
-- Clients read and edit only their own rows (row-level security).
-- Agent runs write with the service role key from Netlify functions.

create extension if not exists pgcrypto;

-- Subscriptions, written by the Stripe webhook. Matched to users by email.
create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  agent text not null check (agent in ('watcher','scout','brief')),
  status text not null default 'active',          -- active | trialing | past_due | canceled
  stripe_customer text,
  stripe_subscription text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  unique (email, agent)
);
create index if not exists entitlements_user_idx on public.entitlements(user_id);
create index if not exists entitlements_customer_idx on public.entitlements(stripe_customer);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  agent text not null default 'you' check (agent in ('watcher','scout','brief','you')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists actions_user_idx on public.actions(user_id, created_at desc);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('watcher','scout','brief')),
  level text not null check (level in ('urgent','notice','good')),
  title text not null, body text not null default '', link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists alerts_user_idx on public.alerts(user_id, created_at desc);

create table if not exists public.agent_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('watcher','scout','brief')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists agent_notes_user_idx on public.agent_notes(user_id, created_at desc);

create table if not exists public.watcher_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Service-only: raw page snapshots used to spot competitor changes.
create table if not exists public.page_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, url)
);

create table if not exists public.competitor_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competitor text not null, url text not null default '',
  kind text not null check (kind in ('price','offer','content','new-page')),
  summary text not null, detail text,
  created_at timestamptz not null default now()
);
create index if not exists competitor_changes_user_idx on public.competitor_changes(user_id, created_at desc);

create table if not exists public.scout_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null, area text not null default 'United Kingdom',
  status text not null default 'running' check (status in ('running','ready','failed')),
  summary text, error text,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists scout_user_idx on public.scout_searches(user_id, created_at desc);

create table if not exists public.week_numbers (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_of date not null,
  values jsonb not null default '{}'::jsonb,
  note text,
  primary key (user_id, week_of)
);

create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_of date not null,
  headline text not null,
  paragraphs jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, week_of)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','agent')),
  text text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_user_idx on public.chat_messages(user_id, created_at);

-- Service-only: AI spend per run, for your margins and the monthly cap.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  agent text not null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  searches int not null default 0,
  cost_usd numeric(10,4) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_month_idx on public.ai_usage(user_id, created_at);

-- Row-level security ------------------------------------------------------
alter table public.entitlements      enable row level security;
alter table public.profiles          enable row level security;
alter table public.actions           enable row level security;
alter table public.alerts            enable row level security;
alter table public.agent_notes       enable row level security;
alter table public.watcher_state     enable row level security;
alter table public.page_snapshots    enable row level security;
alter table public.competitor_changes enable row level security;
alter table public.scout_searches    enable row level security;
alter table public.week_numbers      enable row level security;
alter table public.briefs            enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.ai_usage          enable row level security;

do $$
begin
  -- Read-only for the client
  perform 1;
  drop policy if exists "own entitlements" on public.entitlements;
  create policy "own entitlements" on public.entitlements for select to authenticated
    using (user_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email'));

  drop policy if exists "own notes" on public.agent_notes;
  create policy "own notes" on public.agent_notes for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own watcher" on public.watcher_state;
  create policy "own watcher" on public.watcher_state for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own changes" on public.competitor_changes;
  create policy "own changes" on public.competitor_changes for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own searches" on public.scout_searches;
  create policy "own searches" on public.scout_searches for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own briefs" on public.briefs;
  create policy "own briefs" on public.briefs for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own chat" on public.chat_messages;
  create policy "own chat" on public.chat_messages for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own numbers read" on public.week_numbers;
  create policy "own numbers read" on public.week_numbers for select to authenticated using (user_id = auth.uid());

  -- Read and write for the client
  drop policy if exists "own profile" on public.profiles;
  create policy "own profile" on public.profiles for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  drop policy if exists "own actions" on public.actions;
  create policy "own actions" on public.actions for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  drop policy if exists "own alerts read" on public.alerts;
  create policy "own alerts read" on public.alerts for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own alerts mark read" on public.alerts;
  create policy "own alerts mark read" on public.alerts for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
end $$;

-- Clients may only flip alerts.read, not rewrite alert text.
revoke update on public.alerts from authenticated;
grant update (read) on public.alerts to authenticated;

-- page_snapshots and ai_usage have RLS on and no client policies: service role only.

-- Link a new auth user to any subscription bought with the same email.
create or replace function public.link_entitlements() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.entitlements set user_id = new.id where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;
drop trigger if exists on_auth_user_link_entitlements on auth.users;
create trigger on_auth_user_link_entitlements after insert on auth.users
  for each row execute function public.link_entitlements();
