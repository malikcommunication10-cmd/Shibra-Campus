# Supabase staging validation checklist

Use this checklist against a separate staging Supabase project before changing production. The companion [`supabase_staging_validation.sql`](./supabase_staging_validation.sql) contains read-only checks; it does not create, alter, or delete database objects or records.

## 1. Prepare staging safely

- [ ] Create a separate Supabase project for staging. Confirm its project URL before running SQL.
- [ ] Back up production using the approved Supabase backup/export process. Verify that the backup can be restored before relying on it.
- [ ] Use synthetic data where possible. If staging needs production-shaped data, sanitize personal and financial data before copying it.
- [ ] Record the current schema, RLS status, policies, grants, and app roles so they can be compared after migration.
- [ ] Confirm the staging app uses only the staging project's URL and publishable/anon key. Never place a service-role key in browser files.

## 2. Apply schema and policy changes in staging

1. In the staging SQL Editor, run `supabase_updates.sql` first. Review any errors and confirm the required columns/indexes exist.
2. Review the existing policies on all managed tables. `supabase_roles.sql` intentionally drops existing policies on those tables before installing its own; preserve any custom policy requirements before proceeding.
3. Run `supabase_roles.sql` in staging as a database owner. Do not run it against production as part of this checklist.
4. Run `supabase_staff_attendance.sql` to create attendance, add the payroll calculation columns, and install RLS. Confirm existing payroll rows remain intact.
5. Run `supabase_require_previous_day_close.sql` in staging to add the opt-in role-based previous-day write gates.
6. Run each read-only statement in `supabase_staging_validation.sql` and review every result set. Missing required tables, disabled RLS, unexpected anonymous grants, missing policies, or missing helper functions are blockers.
7. If the app has no administrator yet, create the initial Auth user and add its exact email to `public.app_users` using the setup procedure in `README.md`. Do not share the password or access token.

## 3. Exercise authorization as real users

SQL Editor checks typically run with elevated privileges and do **not** prove that an authenticated user's requests are correctly restricted. Use separate staging accounts and sign in through the app:

- [ ] Admin: can access intended pages and perform intended actions.
- [ ] Read-only role: can view permitted pages; add/edit/delete actions are denied.
- [ ] Teacher or follow-up role: can see only permitted student/follow-up information.
- [ ] Accounts role: can perform permitted financial actions; unrelated staff/user administration is denied.
- [ ] Staff roles can add daily attendance only with add permission and correct existing marks only with edit permission; view-only users cannot write attendance.
- [ ] Only an active user with the exact `Admin` role can save or remove an attendance exemption; non-Admins cannot set exemption flags through direct PostgREST requests.
- [ ] Disabled user: after signing out and signing back in, cannot read or change app data.
- [ ] Unauthenticated session: cannot read or change app data.
- [ ] Day-close restrictions and any `todayonly` permission behave as expected.
- [ ] For a role with **Require closing all previous days before working today**, operational writes are denied until dates are closed through yesterday, and become available after closing.
- [ ] Attempt denied actions through the app and verify Supabase returns a permission error; a hidden/disabled button alone is not a passing test.

Use a disposable staging record for write/delete tests. Do not test destructive actions against copied data unless that data is disposable.

## 4. Check data integrity and user-visible behavior

- [ ] Review the validator's possible duplicate `(admis_no, period, type)` groups before considering any unique constraint. Repeated `voucher_id` values can be intentional because one voucher may contain multiple fee rows.
- [ ] Confirm exactly one valid School Year value is configured in System Settings before testing fee generation.
- [ ] Generate a test voucher, record a test payment, and verify balances and ledger dates.
- [ ] Generate the same test period again and verify the app does not create unintended duplicate charges.
- [ ] Verify Sundays are skipped and payroll requires every Monday–Saturday date in the staff member's applicable employment period.
- [ ] Test 29-, 30-, and 31-day months and confirm the daily salary and bonus always use base salary ÷ 30.
- [ ] Verify an unexcused absence is deducted, an Admin-excused absence is not deducted but still cancels the no-absence bonus, and every exemption requires a saved reason.
- [ ] Verify two unexcused late marks have no deduction, exactly 3 deduct one daily salary, Admin-excused lates do not count, and late counts reset for the next month.
- [ ] Verify incomplete attendance blocks payroll generation and historical payroll rows remain unchanged until explicitly adjusted.
- [ ] Change the school year in staging and verify existing vouchers remain unchanged while new periods use the configured year.
- [ ] Test student add/edit, discounts, annual fund, payroll, follow-up ledger, import preview, and backup/restore as applicable.
- [ ] Test login and critical workflows at 375px, 768px, and 1280px viewport widths.

## 5. Production release gate

Do not promote a migration until all of the following are true:

- [ ] Staging backup/restore and all schema/policy migrations have been reviewed.
- [ ] The read-only validator has no unexplained blockers.
- [ ] The role-based positive and negative tests above pass.
- [ ] Financial records and totals have been cross-checked.
- [ ] A production backup, migration operator, maintenance window, monitoring plan, and recovery procedure are ready.
- [ ] A second responsible person has reviewed the production migration steps.

The staging validator is a diagnostic aid, not a proof of complete security or a substitute for authenticated API tests.
