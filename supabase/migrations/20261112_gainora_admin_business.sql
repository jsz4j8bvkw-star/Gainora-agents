-- Gainora admin, part two: winning clients (prospects, follow-ups, proposals), prices, the business's own money
-- and paperwork. Run AFTER 20261111_gainora_admin.sql. Additive and idempotent.
-- As with the rest of the admin, only the Netlify functions (service role) read or write these tables.
--
-- prospects            businesses Gainora might work with, where each one is, and the next follow-up.
--                      company_type decides whether marketing emails may go without asking first (PECR: limited
--                      companies and LLPs can be emailed with an easy opt-out; sole traders and partnerships
--                      need their OK first).
-- outreach_sequences   the messages and when they go (first message, then follow-ups), per channel.
-- outreach_messages    every message sent or logged, so nobody is contacted twice by mistake.
-- do_not_contact       people and businesses who asked not to hear from Gainora. Checked before every send.
-- proposals            a priced offer with its own link; paying it makes the prospect a client.
-- price_book           Gainora's packages and prices: used by proposals and published to the website.
-- business_expenses    what Gainora itself pays for (suppliers, software, insurance), monthly or one-off.
-- business_deadlines   Gainora's own dates: ICO fee, accounts, tax, insurance, renewals.

alter table public.admin_accounts add column if not exists terms_accepted_at timestamptz;
alter table public.admin_accounts add column if not exists dpa_accepted_at timestamptz;

create table if not exists public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  steps jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (char_length(business_name) between 1 and 160),
  contact_name text not null default '',
  role text not null default '',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  instagram text not null default '',
  linkedin text not null default '',
  town text not null default '',
  industry text not null default '',
  source text not null default '',
  company_type text not null default 'unknown' check (company_type in ('limited','llp','sole_trader','partnership','unknown')),
  consent boolean not null default false,
  consent_note text not null default '',
  stage text not null default 'new' check (stage in ('new','contacted','replied','call','proposal','won','lost')),
  lost_reason text not null default '',
  sequence_id uuid references public.outreach_sequences(id) on delete set null,
  step int not null default 0,
  started_on date,
  next_on date,
  call_at timestamptz,
  personal_line text not null default '',
  note text not null default '',
  unsubscribed_at timestamptz,
  bounced_at timestamptz,
  client_email text,
  unsub_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prospects_next_idx on public.prospects(next_on) where next_on is not null;
create index if not exists prospects_stage_idx on public.prospects(stage);

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  sequence_id uuid,
  step int,
  channel text not null,
  subject text not null default '',
  body text not null default '',
  status text not null default 'sent' check (status in ('sent','skipped','failed')),
  sent_at timestamptz not null default now(),
  by text not null default '',
  provider_id text,
  error text
);
create index if not exists outreach_messages_prospect_idx on public.outreach_messages(prospect_id, sent_at desc);

create table if not exists public.do_not_contact (
  value text primary key,
  kind text not null check (kind in ('email','domain','phone')),
  reason text not null default '',
  at timestamptz not null default now()
);

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  prospect_id uuid references public.prospects(id) on delete set null,
  email text not null default '',
  business_name text not null default '',
  contact_name text not null default '',
  items jsonb not null default '[]'::jsonb,
  trial_days int not null default 0 check (trial_days between 0 and 90),
  note text not null default '',
  status text not null default 'draft' check (status in ('draft','sent','viewed','paid','cancelled')),
  expires_on date,
  sent_at timestamptz,
  viewed_at timestamptz,
  paid_at timestamptz,
  stripe_session text,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.price_book (
  key text primary key check (key ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  description text not null default '',
  setup numeric(10,2) not null default 0,
  monthly numeric(10,2) not null default 0,
  one_off numeric(10,2) not null default 0,
  minimum_months int not null default 0,
  included text not null default '',
  grants text[] not null default '{}',
  stripe_product text,
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  supplier text not null check (char_length(supplier) between 1 and 120),
  category text not null default 'Software',
  amount numeric(10,2) not null check (amount >= 0),
  recurring boolean not null default true,
  starts_on date not null default current_date,
  ends_on date,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.business_deadlines (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  category text not null default 'Other',
  due_on date not null,
  repeat text not null default 'none' check (repeat in ('none','monthly','quarterly','yearly')),
  note text not null default '',
  done_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.outreach_sequences enable row level security;
alter table public.prospects          enable row level security;
alter table public.outreach_messages  enable row level security;
alter table public.do_not_contact     enable row level security;
alter table public.proposals          enable row level security;
alter table public.price_book         enable row level security;
alter table public.business_expenses  enable row level security;
alter table public.business_deadlines enable row level security;
