-- Undoes 20261110_gainora_websites.sql. Deletes every website, its counted visits and its enquiries.
-- Photos in the site-media bucket are left in place (delete them from Storage first if wanted).
drop policy if exists "site-media: owner uploads" on storage.objects;
drop policy if exists "site-media: owner replaces" on storage.objects;
drop policy if exists "site-media: owner deletes" on storage.objects;
drop table if exists public.site_enquiries;
drop table if exists public.site_events;
drop table if exists public.sites;
delete from public.entitlements where agent = 'website';
alter table public.entitlements drop constraint if exists entitlements_agent_check;
alter table public.entitlements add constraint entitlements_agent_check check (agent in ('watcher','scout','brief','capture'));
