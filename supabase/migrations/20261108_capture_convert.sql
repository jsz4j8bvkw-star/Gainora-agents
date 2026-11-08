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

-- What was booked and who with (from the receptionist or the owner).
alter table public.enquiries add column if not exists booked_type text not null default '';
alter table public.enquiries add column if not exists booked_with text not null default '';

-- Every text and email in and out: automatic messages, the owner's replies, customers' replies and alerts to the owner.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enquiry_id uuid references public.enquiries(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  audience text not null default 'customer' check (audience in ('customer','owner')),
  channel text not null check (channel in ('text','email')),
  to_addr text not null default '',
  from_addr text not null default '',
  subject text not null default '',
  body text not null,
  automatic boolean not null default false,
  workflow text,
  step text,
  key text,                    -- one automatic message per enquiry, step and channel
  status text not null default 'sent' check (status in ('awaiting_approval','sending','sent','failed','skipped','received')),
  error text,
  provider_id text,
  read boolean not null default true,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (enquiry_id, key, channel)
);
create index if not exists messages_user_idx on public.messages(user_id, created_at desc);
create index if not exists messages_enquiry_idx on public.messages(enquiry_id, created_at);
create index if not exists messages_waiting_idx on public.messages(user_id) where status = 'awaiting_approval';

-- People who replied STOP: no more texts to them from that business.
create table if not exists public.opt_outs (
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, phone)
);

alter table public.messages enable row level security;
alter table public.opt_outs enable row level security;
do $$
begin
  drop policy if exists "own messages" on public.messages;
  create policy "own messages" on public.messages for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own opt outs" on public.opt_outs;
  create policy "own opt outs" on public.opt_outs for select to authenticated using (user_id = auth.uid());
end $$;
