-- Undoes 20261112_gainora_admin_business.sql. Deletes prospects, outreach history, proposals, the price book,
-- expenses and deadlines. Clients, their apps and payments in Stripe are not touched.
drop table if exists public.business_deadlines;
drop table if exists public.business_expenses;
drop table if exists public.price_book;
drop table if exists public.proposals;
drop table if exists public.do_not_contact;
drop table if exists public.outreach_messages;
drop table if exists public.prospects;
drop table if exists public.outreach_sequences;
alter table public.admin_accounts drop column if exists terms_accepted_at;
alter table public.admin_accounts drop column if exists dpa_accepted_at;
