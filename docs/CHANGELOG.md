# Shibra Campus – What changed in this release

## Structure
- 1 MB of inline JS moved to cacheable files: `js/pages/*.js`; `config.js` split into `js/core/{config,cache,auth,permissions,data,settings}.js`.
- New shared parts: `css/theme.css` (design system + `ui-*` components), `js/core/ui.js` (toast / alert / confirm / prompt / csv),
  `buildFeeVouchers()` (one fee-balance engine used by Students and Statements), `bookPartyFromRow()` (one vendor identity rule).
- Folders: `css/ js/ sql/ docs/ tools/`. Tailwind config + GitHub Action now scan `js/**/*.js`.
- Removed the stale duplicate `User.html` / `user.js` (an old copy of `users.html`).

## Pages
| Page | Done |
|---|---|
| Login | Split layout, remembered email, Caps Lock warning |
| Dashboard | New header; quick actions now include Statements, Books, Staff, Reports and hide pages the user may not open |
| Students | KPIs, filters + sort, "needs attention", fee position, profile dialog, safe delete, locked admission no, CSV, print |
| Bulk Updation | New header; native confirm dialogs replaced |
| Fee Vouchers | New header; student ledger shows ONE receipt with where it was applied (FIFO) + month-wise position; `?student=ADM` deep link |
| Follow-up Calls | New header |
| Book Store | New header; 3 guided action cards (single / many-item sale and purchase, import, returns); vendor ledger now uses the same engine as Accounts; link to Accounts ledger |
| Accounts | Statements shortcut |
| Staff & Payroll | New header; native confirm/prompt replaced |
| Business Reports | Grouped KPIs, collection rate, notes on every section |
| Financial Statements (new) | Income & Expenditure, Financial Position, Fees Outstanding ageing, Books Check; CSV + print |
| Audit / Settings / Users | New header; confirm dialogs replaced (Users) |

## Completed in the final round
- **One implementation of toast / confirm / alert** (`UI.*`) replaces the private copies in Accounts, Books, Settings, Staff, Users and Follow-ups.
- **Fee receipts:** every receipt in a student's ledger has a "Print receipt" button (receipt no., months it cleared, amount in words, balance after payment).
- **Financial Position** now includes Book Store stock (average cost) and salaries payable (payroll saved as unpaid).
- **Speed:** search boxes are debounced (typing no longer re-renders big tables on every key); `sql/supabase_performance.sql` adds safe database indexes (run it once in the Supabase SQL Editor).
- **Tests:** `tests/run_tests.py` (Playwright) opens every page and checks the fee ledger, receipts, students, statements and dialogs with mock data.

## Still open (and why)
- Server-side pagination / date-filtered balances: needs Supabase views or RPC functions chosen against your real data volume; the indexes above are the safe first step.
- Converting the ~350 inline `onclick=` handlers to event delegation: no user-visible or security gain here and a high regression risk without end-to-end tests on real data, so it was left alone on purpose.
- Tests use mock data; run the app on a copy of the real database before going live.
