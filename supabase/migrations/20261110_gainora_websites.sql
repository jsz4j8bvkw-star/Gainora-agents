-- Gainora Launch & Grow: websites that Command Centre builds, hosts and measures.
-- Run AFTER the earlier Gainora migrations (agents, v2, clients, and Capture & Convert's), in the same project.
-- Additive and idempotent: adds tables, a storage bucket and one more entitlement kind; changes no existing rows.
--
-- sites            one website per account. `data` is the draft the owner edits; `published` is what visitors see.
--                  Written only by the Netlify function /api/site (service role), which checks everything first;
--                  the owner can read their own row.
-- site_events      visits, call taps and booking clicks counted by the live site. No cookies, no IP addresses:
--                  `visitor` is a one-way code that changes every day. Service role only.
-- site_enquiries   messages sent through the website form. Personal data, owned by the business (the data
--                  controller); readable and deletable only by that account.
-- site_requests    changes the client asks Gainora to make to the design or wording (clients edit their own
--                  prices, services, hours and contact details; everything else is Gainora's). Service role only.
-- site-media       public bucket for the site's photos and logo, one folder per account.

alter table public.entitlements drop constraint if exists entitlements_agent_check;
alter table public.entitlements add constraint entitlements_agent_check check (agent in ('watcher','scout','brief','capture','website'));

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  domain text unique check (domain is null or domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  data jsonb not null default '{}'::jsonb,
  published jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sites enable row level security;
drop policy if exists "sites: owner reads" on public.sites;
create policy "sites: owner reads" on public.sites for select using (user_id = auth.uid());

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('view','call','book','enquiry')),
  path text not null default '/',
  source text not null default 'Direct',
  device text not null default 'computer' check (device in ('phone','computer')),
  visitor text not null default ''
);
create index if not exists site_events_site_at_idx on public.site_events(site_id, at desc);
alter table public.site_events enable row level security;   -- no policies: only the service role reads or writes

create table if not exists public.site_enquiries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  phone text not null default '',
  email text not null default '',
  service text not null default '',
  postcode text not null default '',
  message text not null default '',
  page text not null default '',
  source text not null default 'Direct',
  forwarded boolean not null default false
);
create index if not exists site_enquiries_user_idx on public.site_enquiries(user_id, at desc);
alter table public.site_enquiries enable row level security;
drop policy if exists "site_enquiries: owner reads" on public.site_enquiries;
create policy "site_enquiries: owner reads" on public.site_enquiries for select using (user_id = auth.uid());
drop policy if exists "site_enquiries: owner deletes" on public.site_enquiries;
create policy "site_enquiries: owner deletes" on public.site_enquiries for delete using (user_id = auth.uid());

create table if not exists public.site_requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  at timestamptz not null default now(),
  page text not null default '',
  text text not null check (char_length(text) between 1 and 2000),
  status text not null default 'open' check (status in ('open','done')),
  done_at timestamptz,
  reply text not null default ''
);
create index if not exists site_requests_site_idx on public.site_requests(site_id, at desc);
alter table public.site_requests enable row level security;   -- no policies: only the service role reads or writes

-- Photos: public to read (they're on a public website), and each account writes only its own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 5242880, array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/svg+xml'];
drop policy if exists "site-media: owner uploads" on storage.objects;
create policy "site-media: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "site-media: owner replaces" on storage.objects;
create policy "site-media: owner replaces" on storage.objects for update to authenticated
  using (bucket_id = 'site-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "site-media: owner deletes" on storage.objects;
create policy "site-media: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and (storage.foldername(name))[1] = auth.uid()::text);
