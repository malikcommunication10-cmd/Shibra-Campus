# Shibra Campus — Production Blueprint

Yeh blueprint maujooda static HTML/JavaScript + Supabase app ko secure, reliable aur laptop/mobile par aasaan school-management software banane ke liye hai. Isay phase-by-phase follow karein; production database par koi migration staging validation ke baghair na chalayein.

## Maujooda baseline

- App pages browser mein chalti hain aur Supabase Auth/PostgREST se data leti hain.
- Shared authentication, page permissions, mobile navigation aur manually configured fee voucher year ke liye improvements maujood hain.
- `supabase_roles.sql` RLS policies configure karta hai, magar yeh existing policies ko replace karta hai. Is migration ko pehle staging par existing schema aur roles ke saath test karna zaroori hai.
- `supabase_updates.sql` mein `arrears2025` abhi year-specific field hai. School-year setting ne tamam historical/year-specific data model ko abhi tak migrate nahi kiya.
- Until a verified backup and staging migration exist, the app preserves this legacy column and treats its 2025 amount as a one-time carry-forward. Existing arrears fee vouchers remain the source for any unpaid balance and are not regenerated in later school years.
- Live Supabase project, real accounts aur physical mobile devices par final validation abhi baqi hai.

## Phase 1 — Staging aur backup (release se pehle lazmi)

1. Production ke barabar schema ke saath alag Supabase staging project banayein; production data ki zaroorat ho to sirf approved, sanitized copy use karein.
2. Production database ka verified backup lein aur restore process ko staging mein test karein.
3. Current tables, columns, indexes, users, roles aur RLS policies ka inventory record karein.
4. `supabase_updates.sql` aur `supabase_roles.sql` staging mein apply karein. Role migration existing managed-table policies ko drop karti hai, is liye custom policies ka review aur migration order confirm karein.
5. Migration ke baad har role se CRUD tests chalayein aur Supabase logs/errors check karein.

**Gate:** Backup restore ho sake, migration repeat/run strategy samajh mein ho, aur authorized/unauthorized test cases expected result dein. In checks ke baghair production migration nahi.

## Phase 2 — Authorization aur account security (sab se pehli engineering priority)

1. `app_users`, `app_roles` aur har data table ki RLS policy ko table-by-table verify karein: students, fees, accounts, increments, books, staff, payroll, settings, call logs aur day close.
2. Kam az kam Admin, cashier/accounts, teacher, staff/payroll aur read-only users ke least-privilege permission matrix tayar karein. Har action ke liye view/add/edit/delete aur special flags ka expected result likhein.
3. App ke visible-button checks aur database policies ko alag samjhein: frontend checks UX ke liye hain; Supabase RLS final enforcement hai.
4. User enable/disable, role change, password reset, logout aur expired/invalid session ko test karein. Admin accounts par MFA enable karein jahan available ho.
5. Browser app mein sirf publishable/anon key rakhein. Service-role key kabhi client files ya browser storage mein na rakhein.
6. Cross-site scripting risk kam karein: user-provided text ko safe render karein, inline HTML construction ko review karein, dependencies aur deployed hosting ko HTTPS par rakhein.
7. Payment, voucher deletion, day close/reopen aur bulk update jaise high-impact actions ke liye database-side checks aur clear confirmation/audit trail define karein.

**Gate:** Unauthorized user API ke zariye bhi blocked ho; sirf UI mein button chhupana security pass nahi hai.

## Phase 3 — Academic year aur fee data integrity

1. School year ko System Settings mein manually controlled single source of truth rakhein.
2. `arrears2025` jaise year-specific columns/logic ka inventory banayein. Historical arrears ko overwrite kiye baghair year-aware structure (misal: year/period se linked arrears records) ki migration design karein. Existing source amount ko tab tak alter/drop na karein jab tak backup restore aur staging reconciliation pass na ho.
3. Fee voucher, tuition plan, annual fund aur arrears generation ke liye duplicate prevention define karein. Existing duplicate data check kiye baghair unique indexes enable na karein.
4. School year badalne se pehle warning dikhayein: change sirf naye records par asar karega; existing vouchers mutate nahi honge.
5. Staging mein year-change scenarios verify karein, jaise 2026 se 2027, existing voucher preservation, student admission mid-year aur inactive students.

**Gate:** Year change existing financial records ko rewrite na kare, aur dobara generation se duplicate vouchers na banein.

## Phase 4 — Financial workflows, audit aur recovery

1. Student admission/edit, voucher generation, payment, discount, account entry, payroll aur day-close flows ko staging par end-to-end test karein.
2. Financial totals ke rounding, partial payment, overpayment, refunds, discount removal aur date-boundary rules document karein.
3. Important changes ke liye actor, timestamp, action aur affected record ka audit history design karein; audit data ko normal users se immutable/read-only rakhein.
4. Backup export ke saath restore procedure, retention period aur responsible person decide karein. Restore test scheduled basis par repeat karein.
5. Bulk/import operations mein preview, validation errors, duplicate detection aur final confirmation provide karein.

**Gate:** Financial ledger, vouchers aur payment totals independently cross-check ho sakein; restore practice successful ho.

## Phase 5 — Laptop aur mobile UX validation

1. Critical pages ko minimum 375px mobile, 768px tablet aur 1280px desktop widths par check karein.
2. Navigation, dialogs, forms aur tables mein keyboard access, visible focus, labels, contrast aur readable error messages verify karein.
3. Mobile tables ke liye responsive layout ya deliberate horizontal scrolling; actions ke liye touch-friendly spacing; modal ke liye viewport-safe scrolling check karein.
4. Slow/failed network, empty data, loading state aur permission denied states test karein.
5. Real devices/browsers par login, student search, fee payment aur settings change ka smoke test karein.

**Gate:** Core workflows kisi supported viewport par clipped, inaccessible ya unusable na hon.

## Phase 6 — Maintainability aur automated checks

1. Maujooda lightweight architecture ko filhal rakhein; refactor ko feature/bug ke saath chhote, testable changes mein karein.
2. Shared auth, permission aur settings logic ki source-of-truth boundaries document karein; duplicate business rules ko dheere-dheere shared modules mein laayein.
3. Fee/year calculations, permission matrix aur voucher duplicate prevention ke automated tests add karein.
4. CSS build ko CI mein chalayein aur JavaScript syntax/static checks aur broken internal links ke checks add karein.
5. SQL migration changes ko versioned, reviewable aur staging-tested rakhein; manual dashboard changes ko migration files mein record karein.

**Gate:** Har release reproducible build ho aur targeted regression checks pass hon.

## Phase 7 — Controlled production release

1. Release se pehle signed-off migration plan, tested backup, rollback/restore steps aur named operator tayar hon.
2. Staging smoke test pass karein; phir low-traffic waqt production migration karein.
3. Release ke baad auth, RLS denials, database errors, fee generation aur payment totals monitor karein.
4. Kisi financial data mismatch ya authorization bypass par release rok kar rollback/restore procedure follow karein.
5. User feedback aur incident log ki bunyaad par agla chhota improvement release plan karein.

## Release checklist

- [ ] Staging Supabase project par tamam SQL migrations test ki gayi hain.
- [ ] Production backup aur staging restore dono verify hain.
- [ ] Role matrix ke allowed aur denied API operations test hue hain.
- [ ] RLS enabled hai; client bundle mein service-role key nahi.
- [ ] School-year switch aur historical arrears behavior verified hai.
- [ ] Voucher/payment totals aur duplicate handling cross-checked hain.
- [ ] Mobile, tablet aur desktop smoke tests complete hain.
- [ ] HTTPS, Supabase Auth redirect URLs aur allowed origins configured hain.
- [ ] Admin MFA, support/restore owner aur rollback steps documented hain.

## Recommended order

**Pehle:** Phase 1 aur Phase 2 — staging, backup, RLS/role verification.  
**Phir:** Phase 3 aur Phase 4 — year-aware fee data aur financial integrity.  
**Us ke baad:** Phase 5 aur Phase 6 — device QA aur automated regression checks.  
**Aakhir mein:** Phase 7 — controlled production release.

Is blueprint ka matlab yeh nahi ke app pehle se tamam production checks pass kar chuki hai. Live database aur devices par validation complete hone tak isay production-ready declare na karein.
