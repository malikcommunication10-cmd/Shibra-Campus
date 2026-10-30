# Backup before arrears migration

**No arrears or database schema changes should be made until a fresh backup has completed and its files have been checked.**

This project is on Supabase Free, so do not rely on Supabase's scheduled daily database backups. Use the Supabase CLI logical dump procedure below on a trusted Windows computer. The companion [`backup_supabase_database.ps1`](./backup_supabase_database.ps1) prompts for the database connection string and writes timestamped SQL dump files outside this source folder.

## What this backup does and does not cover

- Creates separate role, schema and database-data SQL dumps using `supabase db dump`.
- Writes a manifest with file sizes and SHA-256 checksums; it never writes the connection string into the manifest.
- Does **not** alter the remote database.
- Is not a complete Supabase-project clone: Supabase Storage file contents, project settings/secrets, and customizations to managed schemas may require separate backup steps. Supabase's automatic database backups also do not include Storage API objects.
- Contains sensitive student/financial data. Store the output on an encrypted/protected drive, restrict access, and never commit it to Git, upload it here, or share it.

## Steps

1. Install the Supabase CLI and Docker Desktop from their official sources. Start Docker Desktop and wait for it to finish starting.
2. From PowerShell, run:

   ```powershell
   & "C:\Users\shabb\Shibra-Campus-work\Shibra-Campus-main\backup_supabase_database.ps1"
   ```

3. In Supabase Dashboard, open the project and select **Connect**. Copy its PostgreSQL **Session pooler** connection string. Replace the password placeholder locally when the script prompts. Do not send the connection string or database password in chat. If the password contains URL-reserved characters, percent-encode them in the URL as required by PostgreSQL connection-string rules.
4. Let all three dump steps finish successfully. The script stops on the first failure and does not report success if a dump is empty.
5. Check the displayed output directory and manifest. Keep a second copy on a separate encrypted drive.
6. Before the migration, confirm that each `.sql` file exists and has non-zero size. Ideally restore the dump into a **separate disposable Supabase project** and verify that the `public.students` and `public.fees` tables and their arrears data are present.
7. Only after this backup gate passes should we design/apply an arrears migration. Do not run `supabase_roles.sql` or any schema-changing SQL in production as part of the backup.

Supabase's CLI backup guide: <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>. Free-plan backup guidance: <https://supabase.com/docs/guides/platform/backups>.
