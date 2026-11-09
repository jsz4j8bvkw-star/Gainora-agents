-- Undoes 20261109_gainora_clients.sql. This DELETES every owner's client records, visits, sent
-- messages and confirmed bookings held in Gainora. Export first if anyone has imported clients.
drop trigger if exists clients_touch on public.clients;
drop table if exists public.client_reminders;
drop table if exists public.client_outcomes;
drop table if exists public.client_actions;
drop table if exists public.client_visits;
drop table if exists public.clients;
drop function if exists public.touch_updated_at();
