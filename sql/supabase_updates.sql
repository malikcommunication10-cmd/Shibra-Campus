-- ============================================================================
--  Concept School Shibra Campus - Supabase updates
--  Run in: Supabase -> SQL Editor.  Safe to run more than once.
-- ============================================================================

-- 1) Columns used by the new pages (skip any that already exist)
alter table public.students add column if not exists siblings     text;
alter table public.students add column if not exists arrears2025  text;
alter table public.students add column if not exists left_date    date;
alter table public.students add column if not exists doj          date;
alter table public.fees     add column if not exists discount          numeric default 0;
alter table public.fees     add column if not exists original_payable  numeric;
alter table public.fees     add column if not exists siblings          text;
alter table public.fees     add column if not exists arrears2025       text;

-- 2) Speed: indexes for the lookups the pages do all the time
create index if not exists fees_admis_idx      on public.fees (admis_no);
create index if not exists fees_period_idx     on public.fees (period);
create index if not exists fees_voucher_idx    on public.fees (voucher_id);
create index if not exists accounts_voucher_idx on public.accounts (voucher_id);
create index if not exists accounts_date_idx    on public.accounts (date);
create index if not exists students_admis_idx   on public.students (admis_no);

-- 3) BEFORE adding the unique indexes below, check there are no duplicates.
--    Both queries must return 0 rows.
select voucher_id, count(*) from public.fees group by voucher_id having count(*) > 1;
select admis_no, period, type, count(*) from public.fees
 where admis_no is not null and admis_no <> '' group by admis_no, period, type having count(*) > 1;

-- 4) Only when step 3 returned nothing: block duplicate vouchers for good
-- create unique index if not exists fees_voucher_uniq on public.fees (voucher_id);
-- create unique index if not exists fees_student_period_type_uniq on public.fees (admis_no, period, type);

-- 5) Students with an inactive status but no left date (they get no new vouchers)
select admis_no, student_name, status from public.students
 where lower(coalesce(status,'active')) <> 'active' and left_date is null;
-- Students without a joining date (no vouchers are created for them)
select admis_no, student_name from public.students where doj is null;

-- 6) Remove entries created by an earlier Excel import (before re-importing)
-- select count(*), sum(amount_in) from public.accounts where description like 'Imported from Excel%';
-- delete from public.accounts where description like 'Imported from Excel%';

-- 7) Book Store: class / category / fixed sale price per item (also shown as a yellow box in the Book Store page)
alter table public.books add column if not exists item_class text;
alter table public.books add column if not exists category   text;
alter table public.books add column if not exists sale_price numeric;
-- Settings list items (one row per item): the key alone must not be unique
-- alter table public.settings drop constraint if exists settings_setting_key_key;
-- create unique index if not exists settings_key_value_uniq on public.settings (setting_key, setting_value);
