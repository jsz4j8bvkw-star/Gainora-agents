-- Undo 20261110_capture_diary.sql. Removes every clinic's calendar connection (they would need to connect again).
drop index if exists public.capture_settings_page_slug_idx;
drop table if exists public.diary_connections;
