-- Gainora Capture & Convert. Runs in the same Supabase project as Gainora Agents
-- (after 20261102_gainora_agents.sql, which creates entitlements and ai_usage). Safe to run twice.

-- "capture" becomes a plan of its own, sold separately from Command Centre.
alter table public.entitlements drop constraint if exists entitlements_agent_check;
alter table public.entitlements add constraint entitlements_agent_check check (agent in ('watcher','scout','brief','capture'));
-- Which Capture & Convert package: answer, book (Answer & Book) or desk (Front Desk).
alter table public.entitlements add column if not exists plan text;

-- The business details and how calls should be handled. One row per client.
create table if not exists public.capture_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Where enquiries come in from. Each source has its own secret link; only a SHA-256 of the token is stored.
create table if not exists public.enquiry_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'AI receptionist',
  channel text not null default 'call' check (channel in ('call','form','email','text')),
  token_hash text not null unique,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists enquiry_sources_user_idx on public.enquiry_sources(user_id);

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid references public.enquiry_sources(id) on delete set null,
  channel text not null check (channel in ('call','form','email','text')),
  external_id text,
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  postcode text not null default '',
  summary text not null default '',
  transcript text not null default '',
  recording_url text not null default '',
  urgency text not null default 'normal' check (urgency in ('emergency','urgent','normal')),
  kind text not null default 'other' check (kind in ('quote','booking','callback','complaint','spam','other')),
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new','replied','quoted','booked','won','lost','spam')),
  after_hours boolean not null default false,
  notes text not null default '',
  history jsonb not null default '[]'::jsonb,
  replied_at timestamptz,
  quote_amount numeric(14,2),
  quoted_at timestamptz,
  chasers_sent int not null default 0,
  booked_for timestamptz,
  job_value numeric(14,2),
  invoice_due date,
  paid_at timestamptz,
  payment_reminders_sent int not null default 0,
  review_asked_at timestamptz,
  is_test boolean not null default false,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, external_id)
);
create index if not exists enquiries_user_idx on public.enquiries(user_id, received_at desc);
create index if not exists enquiries_open_idx on public.enquiries(status) where status in ('new','quoted','won');

alter table public.capture_settings enable row level security;
alter table public.enquiry_sources  enable row level security;
alter table public.enquiries        enable row level security;

do $$
begin
  -- Clients read their own rows. Settings can also be saved from the app; everything else is written by the functions.
  drop policy if exists "own capture settings" on public.capture_settings;
  create policy "own capture settings" on public.capture_settings for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  drop policy if exists "own enquiries" on public.enquiries;
  create policy "own enquiries" on public.enquiries for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own enquiry sources" on public.enquiry_sources;
  create policy "own enquiry sources" on public.enquiry_sources for select to authenticated using (user_id = auth.uid());
end $$;
