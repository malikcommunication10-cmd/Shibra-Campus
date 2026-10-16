# Shibra Campus

School administration pages for students, fees, accounts, books, staff, follow-ups and user permissions. The front end is static HTML/CSS/JavaScript; Supabase Auth and PostgREST provide authentication and data access.

## Local development

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Run `npm run build:css`.
4. Serve this directory over HTTP (for example, `npx serve .`) and open `login.html`. Do not open the HTML files directly with `file://`.

The checked-in `styles.css` is the compiled Tailwind output. Rebuild it after changing page markup, `nav.js`, `config.js`, `input.css` or `tailwind.config.js`.

## Supabase setup

1. Back up the database and confirm that the core tables used by the app exist: `students`, `fees`, `accounts`, `increments`, `books`, `staff` and `settings`.
2. Run `supabase_updates.sql` in Supabase SQL Editor for the additive columns and indexes.
3. Run `supabase_roles.sql` as a database owner. This creates the role/auth tables when absent, enables RLS on the app tables, and replaces existing policies on those tables with policies derived from the app's role permissions. Test the migration in a staging project first.
4. Run `supabase_followups_access.sql` to let users with Follow-up Calls → View load only the student, fee, and payment fields needed by the Follow-up page. It does not grant direct table access. This lets you remove their Students, Fee Vouchers, and Accounts page permissions.
5. Run `supabase_staff_attendance.sql` to add the daily attendance table, payroll calculation columns, and RLS policies. It preserves existing payroll rows and resets the old free-leave setting to zero.
6. Run `supabase_require_previous_day_close.sql` once to install additive RLS gates for the optional role-based previous-day close requirement. Attendance changes are covered by this gate as well.
7. Run `supabase_reports_audit.sql` to add permission-checked system-wide reports and the append-only audit trail. It adds Reports and Audit Trail → View to the built-in Admin role; grant those page permissions separately to any other role that needs them. The audit log begins recording after this migration and does not backfill earlier changes.
8. Create the first administrator in Supabase Authentication. Then, in SQL Editor, add that exact email to `public.app_users` with role `Admin`, for example:

   ```sql
   insert into public.app_users (email, name, role, active)
   values ('admin@example.com', 'School Administrator', 'Admin', true);
   ```

9. Sign in as that administrator. Use **Users & Roles** to add users and assign least-privilege roles.
10. From **System Settings → Rules & Defaults**, set **School year for fee vouchers** to the year that should be used for new fee periods. Existing fee records are not rewritten when this value changes.

`supabase_roles.sql` intentionally removes all existing RLS policies from its managed tables before installing the Shibra policies. Review any custom policies before running it. Never disable RLS to resolve a permission error. Service-role keys must never be placed in this static client; only the Supabase publishable/anon key belongs in `config.js`.

For a Follow-up-only account, grant **Follow-up Calls → View** (and **Add** only if the user should record calls), then remove View from Students Directory, Fee Vouchers, and Accounts & Daybook. The page uses the restricted `app_followup_data()` RPC for its family dues instead of direct reads from those tables. Keep normal RLS enabled; do not grant this role broad table access as a workaround.

Optional `payroll` and `call_logs` tables are created by `supabase_roles.sql`. Daily attendance is recorded in Staff & Payroll. Sundays are automatic weekly offs; mark every active staff member Present, Absent, or Late for each other calendar date in the applicable employment period. Payroll can only be generated after the month ends and all required attendance is complete. The daily salary rate always uses a fixed 30-day divisor, regardless of month length. Each unexcused absence is deducted; an Admin may excuse an absence with a reason, waiving its deduction, but any absence (including an excused one) disqualifies the one-day no-absence bonus. Late marks count as present for bonus eligibility, and each group of three unexcused late marks deducts one daily salary; late remainders reset each month. Existing payroll rows are preserved and not automatically recalculated. If the attendance table is created separately later, install its matching RLS policies as well; do not use page-generated SQL that disables RLS.

## Build and deployment

The GitHub Actions workflow builds Tailwind CSS when source or style configuration changes. Keep generated `styles.css` committed for static hosting. Serve the site over HTTPS and configure Supabase Auth redirect URLs and allowed origins for the deployed site.

## Notes

- All authorization must be enforced by Supabase RLS, not only by hidden buttons or browser-side role checks.
- The **Require closing all previous days before working today** role permission pauses operational writes until the role's users close through yesterday in Pakistan time. It also grants that role the ability to close/re-open days; install `supabase_require_previous_day_close.sql` once before enabling the permission. The day-close modal is available from the lower-right corner on every page.
- **Reports & Audit** is a shared expandable sidebar group across the app. Report and audit data are returned by database functions that independently require the matching page's View permission; no underlying table access is granted for report-only or audit-only users. Audit readers can see before/after values, so grant Audit Trail → View only to trusted roles. Install `supabase_reports_audit.sql` after the role, staff-attendance, and previous-day-close migrations.
- The browser stores an Auth session for the static client to make authenticated requests. Protect the site against XSS, use strong individual passwords, and enable Supabase MFA for administrators where available.
- Users can change their password from the sidebar while signed in, or request a password reset from the login screen. Configure the deployed HTTPS login URL in Supabase Auth's allowed redirect URLs and enable a working email provider before using reset links. Never share passwords or reset links in chat.
- Use a staging Supabase project to validate schema changes, policies and imports before production.
- Follow [PRODUCTION-BLUEPRINT.md](./PRODUCTION-BLUEPRINT.md) for the phased security, data-integrity, responsive QA and release checklist. The blueprint is a plan, not evidence that live staging checks have passed.
- Use [SUPABASE-STAGING-CHECKLIST.md](./SUPABASE-STAGING-CHECKLIST.md) and the read-only [supabase_staging_validation.sql](./supabase_staging_validation.sql) before any production migration.
- Before changing arrears data/schema on the Free plan, follow [BACKUP-BEFORE-ARREARS-MIGRATION.md](./BACKUP-BEFORE-ARREARS-MIGRATION.md); its PowerShell helper writes a local logical dump and never changes the remote database.
- Before creating the first app administrator, follow [SUPABASE-FIRST-ADMIN-SETUP.md](./SUPABASE-FIRST-ADMIN-SETUP.md) and run its read-only [supabase_admin_preflight.sql](./supabase_admin_preflight.sql). Do not rerun the policy migration solely to add a user.
- Current safe interim arrears handling keeps the existing `arrears2025` column and treats it as a one-time 2025 carry-forward. Once an arrears voucher exists for a student, later fee generation will not bill that carry-forward again; any unpaid balance remains on the original fee voucher. No Supabase schema or records were changed for this behavior.
- **Fee Vouchers → 2025 arrears check** exports a read-only reconciliation CSV of student source amounts versus existing arrears vouchers, collected payments and remaining balances. It does not modify database records and requires the export permission.
