-- Rollback for 20261108_capture_convert.sql. Deletes all Capture & Convert data. Gainora Agents data is untouched.
drop table if exists public.messages, public.opt_outs, public.enquiries, public.enquiry_sources, public.capture_settings cascade;
delete from public.entitlements where agent = 'capture';
alter table public.entitlements drop constraint if exists entitlements_agent_check;
alter table public.entitlements add constraint entitlements_agent_check check (agent in ('watcher','scout','brief'));
alter table public.entitlements drop column if exists plan;
