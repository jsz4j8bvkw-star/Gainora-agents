-- Gainora admin: asking clients for details. Run AFTER 20261112_gainora_admin_business.sql.
-- Additive and idempotent; changes no existing rows. Read and written only by the Netlify functions (service role).
--
-- client_asks   a set of questions sent to a client as a link (/q/<token>), their answers and photos, and where it
--               stands (sent, opened, answered). The photos go in the site-media bucket, in the client's folder, so
--               they can be used on their website straight away.

create table if not exists public.client_asks (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null unique,
  template text not null default 'custom',
  title text not null check (char_length(title) between 1 and 160),
  intro text not null default '',
  questions jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  files jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','sent','opened','answered','cancelled')),
  due_on date,
  sent_to text not null default '',
  sent_at timestamptz,
  opened_at timestamptz,
  answered_at timestamptz,
  reminded_at timestamptz,
  client_task_id uuid,
  next_task_id uuid,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_asks_email_idx on public.client_asks(email, created_at desc);
create index if not exists client_asks_status_idx on public.client_asks(status);
alter table public.client_asks enable row level security;   -- no policies: only the service role reads or writes
