-- Gainora Agents v2: results tracker, learning from feedback, lead pipeline, public contracts,
-- Google listing for reviews, and local-opportunity research.
-- Run AFTER 20261102_gainora_agents.sql, in the same Supabase project. Additive and idempotent:
-- it only adds tables and columns, and never changes or deletes existing rows.
-- Clients can read their own rows; every write goes through the Netlify functions (service role).

-- The Scout: customer research or local opportunities.
alter table public.scout_searches add column if not exists kind text not null default 'customers';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scout_searches_kind_check') then
    alter table public.scout_searches add constraint scout_searches_kind_check check (kind in ('customers','local'));
  end if;
end $$;

-- The Watcher: the client's Google listing, kept outside `state` (which is rewritten on every check).
alter table public.watcher_state add column if not exists place_id text;
alter table public.watcher_state add column if not exists place_name text;
alter table public.watcher_state alter column state set default '{}'::jsonb;

-- Results: every piece of work the agents did, for the "Your results" page and the monthly email.
create table if not exists public.value_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('watcher','scout','brief','you')),
  kind text not null check (kind in ('issue_found','issue_fixed','competitor_change','review_alert','reply_drafted',
    'lead_found','lead_contacted','lead_won','tender_found','opportunity_found','draft_written','brief_written','price_check')),
  title text not null,
  amount numeric(14,2),          -- only real figures: a won deal value the client entered, or a contract's published value
  ref text,                      -- the item it belongs to (a lead id for wins)
  created_at timestamptz not null default now()
);
create index if not exists value_events_user_idx on public.value_events(user_id, created_at desc);
create index if not exists value_events_ref_idx on public.value_events(user_id, kind, ref);

-- Learning: the client's "Useful" / "Not relevant" answers. One answer per item; a new answer replaces the old.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('watcher','scout','brief')),
  item_kind text not null check (item_kind in ('lead','opportunity','tender','change','fix','review','note','action')),
  item_id text not null,
  verdict text not null check (verdict in ('useful','not_relevant')),
  reason text,
  item_text text not null default '',
  host text,
  change_kind text,
  created_at timestamptz not null default now(),
  unique (user_id, item_kind, item_id)
);
create index if not exists feedback_user_idx on public.feedback(user_id, created_at desc);

-- The Scout's lead pipeline, with follow-up dates (day 4 and day 9 after first contact).
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text not null default '',
  website text not null default '',
  reason text not null default '',
  source jsonb,
  search_id uuid references public.scout_searches(id) on delete set null,
  result_id text,
  stage text not null default 'to_contact' check (stage in ('to_contact','contacted','replied','meeting','won','lost')),
  contacted_at timestamptz,
  next_follow_up_at timestamptz,
  follow_ups int not null default 0,
  last_reminded_at timestamptz,
  value_gbp numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists leads_user_idx on public.leads(user_id, created_at desc);
create index if not exists leads_due_idx on public.leads(next_follow_up_at) where stage = 'contacted';

-- Public contracts from Contracts Finder. Public data, shared by all clients.
create table if not exists public.tenders (
  id text primary key,           -- OCDS ocid
  title text not null,
  description text not null default '',
  buyer text not null default '',
  value numeric(16,2),
  currency text not null default 'GBP',
  deadline timestamptz,
  url text not null,
  cpv jsonb not null default '[]'::jsonb,
  region text,
  sme boolean,
  published_at timestamptz,
  fetched_at timestamptz not null default now()
);
create index if not exists tenders_published_idx on public.tenders(published_at desc);

-- Contracts matched to each client, and what they decided.
create table if not exists public.tender_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tender_id text not null references public.tenders(id) on delete cascade,
  fit text not null check (fit in ('strong','possible')),
  reason text not null default '',
  status text not null default 'new' check (status in ('new','saved','dismissed','applied')),
  created_at timestamptz not null default now(),
  unique (user_id, tender_id)
);
create index if not exists tender_matches_user_idx on public.tender_matches(user_id, created_at desc);

-- Service-only: small bits of scheduler state (for example, where the contracts fetch got to).
create table if not exists public.job_state (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- Row-level security ------------------------------------------------------
alter table public.value_events   enable row level security;
alter table public.feedback       enable row level security;
alter table public.leads          enable row level security;
alter table public.tenders        enable row level security;
alter table public.tender_matches enable row level security;
alter table public.job_state      enable row level security;

do $$
begin
  drop policy if exists "own value events" on public.value_events;
  create policy "own value events" on public.value_events for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own feedback" on public.feedback;
  create policy "own feedback" on public.feedback for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own leads" on public.leads;
  create policy "own leads" on public.leads for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own tender matches" on public.tender_matches;
  create policy "own tender matches" on public.tender_matches for select to authenticated using (user_id = auth.uid());
  -- Public contract notices are public information; signed-in clients can read them (needed to show their matches).
  drop policy if exists "signed-in read tenders" on public.tenders;
  create policy "signed-in read tenders" on public.tenders for select to authenticated using (true);
end $$;

-- job_state has RLS on and no client policies: service role only.
