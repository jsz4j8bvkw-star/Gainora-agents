-- Gainora admin (admin.gainora.co.uk): one place to run every client, deliver on time and see what each one costs.
-- Run AFTER 20261110_gainora_websites.sql. Additive and idempotent; changes no existing rows.
-- Every table here is read and written only by the Netlify functions (service role), after checking the person is
-- on Gainora's team (GAINORA_ADMIN_EMAILS). No row-level policies, so nobody can reach them from a browser.
--
-- admin_accounts   one row per client business, keyed by the email they subscribed with (as in entitlements).
--                  What Gainora knows that the apps don't: contact, set-up fee, start date, status, notes.
-- admin_tasks      the delivery checklist: set-up steps per package with deadlines, plus anything added by hand.
--                  who: 'gainora' (us), 'client' (waiting on them) or 'claude' (for Claude to do).
-- admin_log        what happened with each client: notes, calls, work done (by a person or by Claude).
-- admin_costs      costs entered by hand (ad spend, domains, one-offs), per client and month.
-- admin_settings   one row: the rate card used to estimate running costs.
-- admin_keys       links for the Claude connector. Only a hash is stored; each can be switched off.

create table if not exists public.admin_accounts (
  email text primary key check (email = lower(email)),
  business_name text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  status text not null default 'onboarding' check (status in ('onboarding','active','paused','left')),
  started_on date,
  setup_fee numeric(10,2),
  setup_paid boolean not null default false,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_tasks (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  project text not null default 'other' check (project in ('launch','capture','command','other')),
  template_key text,
  title text not null check (char_length(title) between 1 and 300),
  detail text not null default '',
  who text not null default 'gainora' check (who in ('gainora','client','claude')),
  due_on date,
  status text not null default 'todo' check (status in ('todo','doing','waiting','done')),
  done_at timestamptz,
  sort int not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (email, template_key)
);
create index if not exists admin_tasks_due_idx on public.admin_tasks(status, due_on);
create index if not exists admin_tasks_email_idx on public.admin_tasks(email);

create table if not exists public.admin_log (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  at timestamptz not null default now(),
  author text not null default '',
  kind text not null default 'note' check (kind in ('note','call','email','work','system')),
  text text not null check (char_length(text) between 1 and 4000)
);
create index if not exists admin_log_email_idx on public.admin_log(email, at desc);

create table if not exists public.admin_costs (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  month date not null,
  item text not null check (char_length(item) between 1 and 120),
  amount numeric(10,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);
create index if not exists admin_costs_email_idx on public.admin_costs(email, month);

create table if not exists public.admin_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'Claude',
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.admin_accounts enable row level security;
alter table public.admin_tasks    enable row level security;
alter table public.admin_log      enable row level security;
alter table public.admin_costs    enable row level security;
alter table public.admin_settings enable row level security;
alter table public.admin_keys     enable row level security;
