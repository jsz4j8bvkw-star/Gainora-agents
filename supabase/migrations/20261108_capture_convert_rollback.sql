-- Rollback for 20261108_capture_convert.sql. Deletes all enquiries and enquiry links.
drop table if exists public.enquiries, public.enquiry_sources cascade;
delete from public.entitlements where agent = 'capture';
delete from public.alerts where agent = 'capture';
delete from public.value_events where agent = 'capture' or kind in ('enquiry_caught','enquiry_won');
alter table public.entitlements drop constraint if exists entitlements_agent_check;
alter table public.entitlements add constraint entitlements_agent_check check (agent in ('watcher','scout','brief'));
alter table public.alerts drop constraint if exists alerts_agent_check;
alter table public.alerts add constraint alerts_agent_check check (agent in ('watcher','scout','brief'));
alter table public.value_events drop constraint if exists value_events_agent_check;
alter table public.value_events add constraint value_events_agent_check check (agent in ('watcher','scout','brief','you'));
alter table public.value_events drop constraint if exists value_events_kind_check;
alter table public.value_events add constraint value_events_kind_check check (kind in ('issue_found','issue_fixed','competitor_change','review_alert','reply_drafted',
  'lead_found','lead_contacted','lead_won','tender_found','opportunity_found','draft_written','brief_written','price_check'));
