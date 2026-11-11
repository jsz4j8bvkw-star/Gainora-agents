-- Gainora admin: "My day", Adelin's own daily routine, targets, to-do list, notes and trading journal.
-- Run AFTER 20261113_gainora_client_asks.sql. Additive and idempotent; changes no existing rows and nothing
-- about clients. Read and written only by the Netlify functions (service role), and only for the email in
-- MY_DAY_EMAILS (or, if that isn't set, the first email in GAINORA_ADMIN_EMAILS).
--
-- me_settings   one row (id 1): gym split and session length, minimum and good day targets, trading rules.
-- me_routine    the repeating day: time blocks (05:30 coffee, gym, follow-ups, walk-ins, trading, bed…) and the
--               weekdays each one is on. The app fills in the default routine the first time it opens.
-- me_days       one row per date: which blocks were ticked, the three must-dos, the scoreboard numbers,
--               energy (1 to 10), the gym session, notes and the trading journal.
-- me_tasks      the personal to-do list: business, trading, gym or personal, with due dates and repeats.

create table if not exists public.me_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.me_routine (
  id uuid primary key default gen_random_uuid(),
  start text not null check (start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  finish text check (finish is null or finish ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  title text not null check (char_length(title) between 1 and 160),
  detail text not null default '',
  days int[] not null default '{1,2,3,4,5}',
  kind text not null default 'other' check (kind in ('checkin','gym','meal','followups','sales','calls','trading','client','review','sleep','other')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.me_days (
  date date primary key,
  ticks jsonb not null default '{}'::jsonb,
  must_dos jsonb not null default '[]'::jsonb,
  notes text not null default '',
  energy int check (energy is null or energy between 1 and 10),
  contacts int check (contacts is null or contacts >= 0),
  conversations int check (conversations is null or conversations >= 0),
  sales_chats int check (sales_chats is null or sales_chats >= 0),
  proposals int check (proposals is null or proposals >= 0),
  new_clients int check (new_clients is null or new_clients >= 0),
  followups_cleared boolean not null default false,
  gym jsonb not null default '{}'::jsonb,
  trading jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.me_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  notes text not null default '',
  due_on date,
  category text not null default 'business' check (category in ('business','trading','gym','personal')),
  repeat text not null default 'none' check (repeat in ('none','daily','weekdays','weekly','monthly')),
  done boolean not null default false,
  done_at timestamptz,
  last_done_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists me_tasks_open_idx on public.me_tasks(done, due_on);

alter table public.me_settings enable row level security;   -- no policies: only the service role reads or writes
alter table public.me_routine  enable row level security;
alter table public.me_days     enable row level security;
alter table public.me_tasks    enable row level security;
