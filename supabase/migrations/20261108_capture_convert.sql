-- Capture & Convert: enquiries from the client's AI receptionist, web forms and forwarded email.
-- Run after 20261107_gainora_agents_v2.sql. Safe to run twice.

-- "capture" becomes a plan of its own (sold separately from Command Centre).
alter table public.entitlements drop constraint if exists entitlements_agent_check;
alter table public.entitlements add constraint entitlements_agent_check check (agent in ('watcher','scout','brief','capture'));
alter table public.alerts drop constraint if exists alerts_agent_check;
alter table public.alerts add constraint alerts_agent_check check (agent in ('watcher','scout','brief','capture'));
alter table public.value_events drop constraint if exists value_events_agent_check;
alter table public.value_events add constraint value_events_agent_check check (agent in ('watcher','scout','brief','you','capture'));
alter table public.value_events drop constraint if exists value_events_kind_check;
alter table public.value_events add constraint value_events_kind_check check (kind in ('issue_found','issue_fixed','competitor_change','review_alert','reply_drafted',
  'lead_found','lead_contacted','lead_won','tender_found','opportunity_found','draft_written','brief_written','price_check',
  'enquiry_caught','enquiry_won'));

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
  quoted_at timestamptz,
  chasers_sent int not null default 0,
  value_gbp numeric(14,2),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, external_id)
);
create index if not exists enquiries_user_idx on public.enquiries(user_id, received_at desc);
create index if not exists enquiries_open_idx on public.enquiries(user_id, status) where status in ('new','quoted');

alter table public.enquiry_sources enable row level security;
alter table public.enquiries       enable row level security;

do $$
begin
  drop policy if exists "own enquiries" on public.enquiries;
  create policy "own enquiries" on public.enquiries for select to authenticated using (user_id = auth.uid());
  drop policy if exists "own enquiry sources" on public.enquiry_sources;
  create policy "own enquiry sources" on public.enquiry_sources for select to authenticated using (user_id = auth.uid());
end $$;
-- Writes go through the functions (service role) only.
