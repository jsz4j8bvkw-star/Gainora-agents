-- Undoes 20261114_gainora_my_day.sql. Deletes Adelin's routine, daily log, to-do list and trading journal.
-- Nothing about clients is touched.
drop table if exists public.me_tasks;
drop table if exists public.me_days;
drop table if exists public.me_routine;
drop table if exists public.me_settings;
