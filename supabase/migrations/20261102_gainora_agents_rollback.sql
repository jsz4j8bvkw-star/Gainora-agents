-- Rollback for 20261102_gainora_agents.sql. Deletes ALL Gainora Agents client data.
drop trigger if exists on_auth_user_link_entitlements on auth.users;
drop function if exists public.link_entitlements();
drop table if exists public.ai_usage, public.chat_messages, public.briefs, public.week_numbers,
  public.scout_searches, public.competitor_changes, public.page_snapshots, public.watcher_state,
  public.agent_notes, public.alerts, public.actions, public.profiles, public.entitlements cascade;
