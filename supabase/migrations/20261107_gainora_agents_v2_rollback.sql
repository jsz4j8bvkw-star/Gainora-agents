-- Rollback for 20261107_gainora_agents_v2.sql. Deletes all v2 data (results, feedback, leads, contracts).
-- The v1 tables and their data are kept.
drop table if exists public.tender_matches, public.tenders, public.leads, public.feedback, public.value_events, public.job_state cascade;
alter table public.scout_searches drop constraint if exists scout_searches_kind_check;
alter table public.scout_searches drop column if exists kind;
alter table public.watcher_state drop column if exists place_id;
alter table public.watcher_state drop column if exists place_name;
alter table public.watcher_state alter column state drop default;
