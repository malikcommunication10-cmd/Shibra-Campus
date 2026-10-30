# Shibra Campus – Architecture

```
/*.html            Sirf markup (har page ka HTML 60-75% chhota)
/css/theme.css     Design system (rang, cards, tables, forms, sidebar)
/styles.css        Compiled Tailwind (GitHub Action banata hai; js/**/*.js bhi scan hoti hain)
/js/core/          Shared, har page par load
   config.js       Supabase URL/key, Excel loader
   cache.js        Memory + sessionStorage + IndexedDB data cache
   auth.js         Session, idle logout, token refresh, fetch interceptor
   permissions.js  Pages, roles, ME, can(), day-close guards
   data.js         sbFetchAll (parallel paging, cache, revision)
   settings.js     Setting lists, school year, dues engine (computeDues), fee voucher engine (buildFeeVouchers)
   db.js           ERP.db – table requests
   nav.js          Sidebar + mobile menu
   ui.js           UI.toast / UI.alert / UI.confirm / UI.dialog / UI.csv  (no native alert/confirm)
/js/pages/*.js     Har page ka apna logic (browser cache hota hai)
/sql/              Supabase migrations
/docs/  /tools/    Guides, backup script, Code.gs
```

## Load order (zaroori)
config → cache → auth → permissions → data → settings → db → nav → page script.

## Ab tak kya hua (Phase 1 – structure)
- 1 MB inline JS -> alag cacheable files; config.js (749 lines) 6 modules mein (byte-identical, verify kiya).
- Tailwind config/workflow ko naye paths ke mutabiq update kiya.
- Before/after browser test: 14 pages, koi nayi JS error nahi.

## Agla (Phase 2 – logic & speed), is order mein
1. Duplicate helpers (esc, fmt, toast, confirmBox, showLoading, exportCsv, numToWords) -> ek `js/core/ui.js`.
2. Accounts: `select=*` poori table ki jagah date-range + Postgres view/RPC se opening balance.
3. Students/Books/Staff: server-side search + pagination.
4. `onclick=` (350+) -> event delegation.
5. Playwright tests: voucher save, fee receipt, payroll.

## Phase 1.5 – Workflow fixes
- **Fees / student ledger:** ek bulk (FIFO) payment ab ledger mein EK receipt ("Payment received PKR 10,000") dikhti hai,
  neeche likha hota hai ke wo kis kis mahine ke voucher par lagi. Upar "Month-wise position" table (Cleared / Part paid / Unpaid).
- **Vendor ledger:** Books ab Accounts wala hi `computeDues()` istemal karta hai (pehle `bookOnly` tha jo AR/AP bills ignore karta tha).
  Party ki pehchan `bookPartyFromRow()` se hoti hai (ek hi jagah). Books statement mein "Open in Accounts ledger" link.
- **Books entry:** header ke 6 buttons ki jagah 3 samjhane wale cards (Selling / Buying / Bulk & corrections).
- **Reports:** KPIs 4 groups mein (People, Fees, Money in & out, Staff & follow-up), collection rate, har section ke upar saada note.
- **User.html:** `db.js` load nahi hoti thi (purani bug) - theek.

## Abhi baqi (honest list)
- Books statement aur Accounts vendor ledger ke SCREENS abhi alag renderers hain (numbers ab ek hi engine se aate hain).
- Reports ka data server-side RPC (`supabase_reports_audit.sql`) se aata hai; naye columns chahiyen to SQL badalni hogi.
- Books mein "ek date ke kai single entries" ke liye Accounts jaisa batch grid nahi hai (multi-item bill aur student sale hai).

## Phase 2 – Financial Statements & Login
- **statements.html** (Reports permission): Income & Expenditure (cash basis, with "surplus to cash" walk),
  Financial Position (assets / liabilities / net worth as of today), Fees Outstanding with ageing (0-30, 31-60, 61-90, 90+),
  Books Check (duplicate vouchers, bad dates, negative balances, unknown accounts, over-paid fees, balance agreement). CSV + print.
- **Login:** split layout, remembered email, Caps Lock warning; reset-link and idle-logout flows unchanged.
- Voucher rules in statements.js mirror Accounts -> Daybook (same flags: asset, partner, security, fee).

## Page-by-page rebuild (in sidebar order)
Shared parts: css/theme.css `ui-*` components, js/core/ui.js, buildFeeVouchers() in settings.js.
1. **Students** – DONE: KPI cards, search/class/status/sort, "needs attention" filter, fee position per student,
   profile dialog (family, fee structure, month-wise fees), safe delete (blocked when fee vouchers exist -> "Mark as Left"),
   admission number locked while editing, CSV export, print list, deep link `fees.html?student=ADM`.
2. Bulk Updation – next   3. Fee Vouchers   4. Follow-up Calls   5. Book Store   6. Accounts   7. Staff & Payroll
8. Reports / Statements   9. Audit   10. Settings   11. Users   12. Dashboard (last, it summarises the others)

## Tests & performance
- `python tests/run_tests.py` (needs `pip install playwright && playwright install chromium`).
- `sql/supabase_performance.sql` creates indexes only where the table/column exists.
- `UI.debounce` is applied automatically to search inputs; `UI.words()` converts amounts to words for receipts and vouchers.
