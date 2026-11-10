# Shibra Campus

School administration pages for students, fees, accounts, books, staff, follow-ups and user permissions. The front end is static HTML/CSS/JavaScript; Supabase Auth and PostgREST provide authentication and data access.

## Local development

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Run `npm run build:css`.
4. Serve this directory over HTTP (for example, `npx serve .`) and open `login.html`. Do not open the HTML files directly with `file://`.

The checked-in `styles.css` is the compiled Tailwind output. Rebuild it after changing page markup, `js/core/nav.js`, `js/core/*.js`, `input.css` or `tailwind.config.js`.

## Supabase setup

1. Back up the database and confirm that the core tables used by the app exist: `students`, `fees`, `accounts`, `increments`, `books`, `staff` and `settings`.
2. Run `sql/supabase_updates.sql` in Supabase SQL Editor for the additive columns and indexes.
3. Run `sql/supabase_roles.sql` as a database owner. This creates the role/auth tables when absent, enables RLS on the app tables, and replaces existing policies on those tables with policies derived from the app's role permissions. Test the migration in a staging project first.
4. Run `sql/supabase_followups_access.sql` to let users with Follow-up Calls → View load only the student, fee, and payment fields needed by the Follow-up page. It does not grant direct table access. This lets you remove their Students, Fee Vouchers, and Accounts page permissions.
5. Run `sql/supabase_staff_attendance.sql` to add the daily attendance table, payroll calculation columns, and RLS policies. It preserves existing payroll rows and resets the old free-leave setting to zero.
6. Run `sql/supabase_staff_security.sql` to add payroll security deductions and the staff-security liability ledger. Run it after `sql/supabase_staff_attendance.sql`; Accounts → Receivable / Payable then shows opening balances plus salary deductions, less refunds. Do not use the page's embedded setup SQL as a substitute for this migration.
7. Run `sql/supabase_staff_increments.sql` to enable annual staff salary increments. It creates a separate increment history and a permission-checked atomic RPC; it does not update existing payroll rows. Users need Staff → View or Edit to read the history and Staff → Edit to save increments.
8. Run `sql/supabase_require_previous_day_close.sql` once to install additive RLS gates for the optional role-based previous-day close requirement. Attendance changes are covered by this gate as well.
9. Run `sql/supabase_reports_audit.sql` to add permission-checked system-wide reports and the append-only audit trail. It adds Reports and Audit Trail → View to the built-in Admin role and existing Admin users with explicit permission overrides; grant those page permissions separately to any other role that needs them. The audit log begins recording after this migration and does not backfill earlier changes.
10. Create the first administrator in Supabase Authentication. Then, in SQL Editor, add that exact email to `public.app_users` with role `Admin`, for example:

   ```sql
   insert into public.app_users (email, name, role, active)
   values ('admin@example.com', 'School Administrator', 'Admin', true);
   ```

11. Sign in as that administrator. Use **Users & Roles** to add users and assign least-privilege roles.
12. From **System Settings → Rules & Defaults**, set **School year for fee vouchers** to the year that should be used for new fee periods. Existing fee records are not rewritten when this value changes.

Signed-in users are automatically logged out after 5 minutes with no keyboard, pointer, touch, click, or scroll activity. Background data refreshes do not extend the timeout. Activity is shared across the app's tabs in the same browser.

### Admin password reset

The Users & Roles page lets an active Admin set a new password for an existing user's login. Existing passwords cannot be viewed. This feature checks the signed-in user's active `Admin` role on the server and does not require the single-device session feature. The app has returned to its normal multi-device login; do not run `sql/supabase_single_session.sql`. If that migration was already applied, run `sql/supabase_rollback_single_session.sql` in Supabase SQL Editor to restore the role-based access rules. Deploy the `admin-set-user-password` Supabase Edge Function from this repository with the Supabase CLI:

```powershell
supabase login
supabase functions deploy admin-set-user-password --project-ref tsnfwebctvjnmmweepiu
```

The function verifies the signed-in user's Auth token and active `Admin` role in `app_users` before using the server-side Auth Admin API. Supabase's `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` function secrets must be available to the Edge Function runtime. If the service-role secret is not already configured for the project, set it through Supabase's secrets/CLI interface; never put it in `js/core/*.js`, HTML, or any other static client file. The Admin must securely give the new password to the user, who should change it after signing in.

`sql/supabase_roles.sql` intentionally removes all existing RLS policies from its managed tables before installing the Shibra policies. Review any custom policies before running it. Never disable RLS to resolve a permission error. Service-role keys must never be placed in this static client; only the Supabase publishable/anon key belongs in `js/core/*.js`.

For a Follow-up-only account, grant **Follow-up Calls → View** (and **Add** only if the user should record calls), then remove View from Students Directory, Fee Vouchers, and Accounts & Daybook. The page uses the restricted `app_followup_data()` RPC for its family dues instead of direct reads from those tables. Keep normal RLS enabled; do not grant this role broad table access as a workaround.

Optional `payroll` and `call_logs` tables are created by `sql/supabase_roles.sql`. Daily attendance is recorded in Staff & Payroll. Sundays are automatic weekly offs. In the Attendance tab, **Mark missing days Present for month** uses the selected salary month to fill unmarked working dates for all applicable staff; it skips future dates and preserves saved Present/Absent/Late records. Payroll generation can also fill unmarked dates for a completed month. Set each employee's salary days from 0 to 30 and deductible leave days during generation or payroll adjustment; manual changes require a reason, so leave deductions can be increased, reduced, or waived. Net salary uses the fixed daily rate (base salary ÷ 30), less deductible leave days and late deductions, plus/minus bonus, fine and advance. Each unexcused absence is deducted by default; an Admin may excuse an absence with a reason, waiving its deduction, but any absence (including an excused one) disqualifies the one-day no-absence bonus. Late marks count as present for bonus eligibility, and each group of three unexcused late marks deducts one daily salary; late remainders reset each month. Existing payroll rows are preserved and not automatically recalculated by attendance changes. The staff attendance setup adds `salary_days` with a default of 30; re-run `sql/supabase_staff_attendance.sql` to add this column to an existing payroll table. If the attendance table is created separately later, install its matching RLS policies as well; do not use page-generated SQL that disables RLS.

The Staff & Payroll → Attendance tab can import a fingerprint-machine `.xls` / `.xlsx` monthly workbook containing `Attendance Logs`, `Schedule information sheet`, and optionally `Abnormal`. Review the preview and any unmatched staff-name mappings before importing. Only scheduled, non-Sunday dates are considered; a recorded punch is Present unless the Abnormal sheet reports late minutes, no punch on a scheduled shift is Absent, business-trip shift code 26 is Present, and scheduled-leave code 25 is skipped for manual review. Holidays, Sundays, future dates, dates outside the employee's recorded employment period, and existing attendance are not overwritten/imported. Imports use the signed-in user's attendance permissions and day-close restrictions; if a bulk insert partially fails, already completed batches are safe to retry.

For staff security, enter each existing employee's one-time opening liability from **Staff & Payroll → Salary Sheet → Security opening**. An opening is dated when it is recorded, labelled for January of the selected salary year, and carries forward; avoid entering it again if it has already been saved. New monthly security deductions are withheld from net salary and added to the payable ledger. When paying salary, optionally enter a partial refund; it creates a separate Accounts payment voucher and reduces the balance. Refund vouchers are excluded from expense totals and cannot be edited or deleted directly in Accounts; undo them from Staff & Payroll so the linked liability is restored. The Accounts liability table is separate from vendor bills. Users recording monthly deductions need Staff → Add/Edit; opening entries need Staff → Add/Edit or Accounts → Add/Edit; a refund requires Accounts → Add and Staff → Edit. Undoing a payment also needs Accounts → Delete and Staff → Edit. Configure read permissions for the pages users need to view.

For annual salary increments, open **Staff & Payroll → Staff → Annual increment**, select one or more active employees, choose either percentage or fixed PKR, set the effective month, and enter the reason. Review the per-employee salary preview before saving. Increments are recorded once per employee per month and must be scheduled in date order; future increments do not affect earlier payroll. Payroll rows already generated or paid remain unchanged, while payroll generated for the effective month or later uses the increment history.

## Google Sheets bulk sync

`Code.gs` is an optional Google Apps Script for syncing/exporting the operational tables listed in `supabase_sync_tables.csv`, including follow-up call records. It excludes user/role, day-close, and audit-log tables. In a Google Sheet, open **Extensions → Apps Script**, paste the file contents into the bound script, save, and reload the spreadsheet. Create tabs named exactly after the Supabase tables for data you want to sync. Keep the first row as the column header row; export first to get the exact live columns and existing records.

In Apps Script **Project Settings → Script Properties**, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_EMAIL`, and `SUPABASE_PASSWORD`. Use the project's URL and publishable/anon key from `js/core/*.js`, plus an active Shibra administrator's Supabase Auth account. The script signs in as that user, so Supabase RLS and the day-close write rules remain in force. Never put a service-role key in the script. Restrict spreadsheet and Apps Script editor access: spreadsheet editors may be able to run the script, and script editors can access its stored properties.

The **Supabase Sync → Create all table tabs from Supabase** menu exports every configured operational table and creates/populates matching working tabs in one run. Existing non-empty table tabs are preserved and reported as skipped. **Export all tables from Supabase** creates/refreshes only the `Supabase_<table>` export tabs. An exported tab can be edited and synced using **Sync current sheet**. **Sync all table sheets** intentionally reads only exact-name tabs, so an export-only tab cannot overwrite a separate working tab. Sync inserts new rows and updates changed rows using the identity options configured in `Code.gs`; `supabase_sync_tables.csv` documents those keys (semicolon separates alternative keys; `+` combines key fields). Sync does not delete database rows. An export adds a hidden `__sync_key` column so edits to identity values can still update the original record. Keep that column hidden and unchanged. Duplicate identities, missing records, and permission/schema errors are reported instead of silently ignored. Run an export before the first sync and test on a copy/staging project before bulk changes. If you change identity options, update both `Code.gs` and the CSV reference.

## Build and deployment

The GitHub Actions workflow builds Tailwind CSS when source or style configuration changes. Keep generated `styles.css` committed for static hosting. Serve the site over HTTPS and configure Supabase Auth redirect URLs and allowed origins for the deployed site.

## Notes

- All authorization must be enforced by Supabase RLS, not only by hidden buttons or browser-side role checks.
- The **Require closing all previous days before working today** role permission pauses operational writes until the role's users close through yesterday in Pakistan time. It also grants that role the ability to close/re-open days; install `sql/supabase_require_previous_day_close.sql` once before enabling the permission. The day-close modal is available from the lower-right corner on every page.
- **Reports & Audit** is a shared expandable sidebar group across the app. Business Reports includes a current active-student monthly tuition distribution and average, using students with a numeric tuition amount; it is a current snapshot, not date-filtered. Students by class shows total, left, and net active counts. Fee types show active and left student counts and gross, discount, and net payable separately; all-record totals also include fees for other or unmatched statuses. Report panels expand/collapse independently, with Expand all / Collapse all controls; Account Receivable separates Tuition Fee and Annual Fund. Report and audit data are returned by database functions that independently require the matching page's View permission; no underlying table access is granted for report-only or audit-only users. Audit readers can see before/after values, so grant Audit Trail → View only to trusted roles. Install `sql/supabase_reports_audit.sql` after the role, staff-attendance, and previous-day-close migrations.
- The browser stores an Auth session for the static client to make authenticated requests. Protect the site against XSS, use strong individual passwords, and enable Supabase MFA for administrators where available.
- Users can change their password from the sidebar while signed in, or request a password reset from the login screen. Configure the deployed HTTPS login URL in Supabase Auth's allowed redirect URLs and enable a working email provider before using reset links. Never share passwords or reset links in chat.
- Use a staging Supabase project to validate schema changes, policies and imports before production.
- Follow [PRODUCTION-BLUEPRINT.md](./PRODUCTION-BLUEPRINT.md) for the phased security, data-integrity, responsive QA and release checklist. The blueprint is a plan, not evidence that live staging checks have passed.
- Use [SUPABASE-STAGING-CHECKLIST.md](./SUPABASE-STAGING-CHECKLIST.md) and the read-only [sql/supabase_staging_validation.sql](./supabase_staging_validation.sql) before any production migration.
- Before changing arrears data/schema on the Free plan, follow [BACKUP-BEFORE-ARREARS-MIGRATION.md](./BACKUP-BEFORE-ARREARS-MIGRATION.md); its PowerShell helper writes a local logical dump and never changes the remote database.
- Before creating the first app administrator, follow [SUPABASE-FIRST-ADMIN-SETUP.md](./SUPABASE-FIRST-ADMIN-SETUP.md) and run its read-only [sql/supabase_admin_preflight.sql](./supabase_admin_preflight.sql). Do not rerun the policy migration solely to add a user.
- Current safe interim arrears handling keeps the existing `arrears2025` column and treats it as a one-time 2025 carry-forward. Once an arrears voucher exists for a student, later fee generation will not bill that carry-forward again; any unpaid balance remains on the original fee voucher. No Supabase schema or records were changed for this behavior.
- **Fee Vouchers → 2025 arrears check** exports a read-only reconciliation CSV of student source amounts versus existing arrears vouchers, collected payments and remaining balances. It does not modify database records and requires the export permission.


## Development
- Read `docs/ARCHITECTURE.md` for the folder layout and `docs/CHANGELOG.md` for what changed.
- Run the regression tests: `python tests/run_tests.py`.
- Run `sql/supabase_performance.sql` once in the Supabase SQL Editor for faster queries.
