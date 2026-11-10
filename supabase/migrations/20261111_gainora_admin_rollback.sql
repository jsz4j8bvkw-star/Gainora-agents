-- Undoes 20261111_gainora_admin.sql: deletes the admin's own records (tasks, notes, costs, connector links).
-- Nothing the client apps use is touched.
drop table if exists public.admin_keys;
drop table if exists public.admin_settings;
drop table if exists public.admin_costs;
drop table if exists public.admin_log;
drop table if exists public.admin_tasks;
drop table if exists public.admin_accounts;
