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
4. Create the first administrator in Supabase Authentication. Then, in SQL Editor, add that exact email to `public.app_users` with role `Admin`, for example:

   ```sql
   insert into public.app_users (email, name, role, active)
   values ('admin@example.com', 'School Administrator', 'Admin', true);
   ```

5. Sign in as that administrator. Use **Users & Roles** to add users and assign least-privilege roles.
6. From **System Settings → Rules & Defaults**, set **School year for fee vouchers** to the year that should be used for new fee periods. Existing fee records are not rewritten when this value changes.

`supabase_roles.sql` intentionally removes all existing RLS policies from its managed tables before installing the Shibra policies. Review any custom policies before running it. Never disable RLS to resolve a permission error. Service-role keys must never be placed in this static client; only the Supabase publishable/anon key belongs in `config.js`.

Optional `payroll` and `call_logs` tables are created by `supabase_roles.sql`. If they are created separately later, run the matching policy statements from that SQL migration as well; do not use page-generated SQL that disables RLS.

## Build and deployment

The GitHub Actions workflow builds Tailwind CSS when source or style configuration changes. Keep generated `styles.css` committed for static hosting. Serve the site over HTTPS and configure Supabase Auth redirect URLs and allowed origins for the deployed site.

## Notes

- All authorization must be enforced by Supabase RLS, not only by hidden buttons or browser-side role checks.
- The browser stores an Auth session for the static client to make authenticated requests. Protect the site against XSS, use strong individual passwords, and enable Supabase MFA for administrators where available.
- Users can change their password from the sidebar while signed in, or request a password reset from the login screen. Configure the deployed HTTPS login URL in Supabase Auth's allowed redirect URLs and enable a working email provider before using reset links. Never share passwords or reset links in chat.
- Use a staging Supabase project to validate schema changes, policies and imports before production.
- Follow [PRODUCTION-BLUEPRINT.md](./PRODUCTION-BLUEPRINT.md) for the phased security, data-integrity, responsive QA and release checklist. The blueprint is a plan, not evidence that live staging checks have passed.
- Use [SUPABASE-STAGING-CHECKLIST.md](./SUPABASE-STAGING-CHECKLIST.md) and the read-only [supabase_staging_validation.sql](./supabase_staging_validation.sql) before any production migration.
- Before changing arrears data/schema on the Free plan, follow [BACKUP-BEFORE-ARREARS-MIGRATION.md](./BACKUP-BEFORE-ARREARS-MIGRATION.md); its PowerShell helper writes a local logical dump and never changes the remote database.
- Before creating the first app administrator, follow [SUPABASE-FIRST-ADMIN-SETUP.md](./SUPABASE-FIRST-ADMIN-SETUP.md) and run its read-only [supabase_admin_preflight.sql](./supabase_admin_preflight.sql). Do not rerun the policy migration solely to add a user.
- Current safe interim arrears handling keeps the existing `arrears2025` column and treats it as a one-time 2025 carry-forward. Once an arrears voucher exists for a student, later fee generation will not bill that carry-forward again; any unpaid balance remains on the original fee voucher. No Supabase schema or records were changed for this behavior.
- **Fee Vouchers → 2025 arrears check** exports a read-only reconciliation CSV of student source amounts versus existing arrears vouchers, collected payments and remaining balances. It does not modify database records and requires the export permission.
