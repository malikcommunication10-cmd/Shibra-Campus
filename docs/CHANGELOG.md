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

## Speed round (loading wheel on every page)
Causes found in the code, and what was changed:
1. **Every page downloaded the same big table again in a different shape** (Accounts alone was requested 5 different ways). Now a
   "column subset" query is served from ONE cached copy of the table (`sbFetchAll` in `js/core/data.js`); the first page pays,
   the rest open from memory. If the full table is not readable for a role, the original query is used automatically.
2. **The saved copy was thrown away after 5 minutes**, so returning to a page meant a full download. Saved data now stays usable
   for 12 hours and is shown instantly while a fresh copy loads in the background (fresh for 60 s).
3. **A background refresh never redrew the page.** Now, only if the data really changed, the page is redrawn quietly (no wheel).
   It waits while a dialog is open, rows are ticked, or you are typing.
4. **Follow-up Calls** called a heavy server function on every open; its result is now cached the same way (`sbRpcCached`).
5. **Schema checks** ("does this column exist?") in Books and Staff ran on every load; they now run once a day (`sbProbe`).
6. **Google Fonts `@import`** in `theme.css` could block rendering on slow connections; removed (system fonts are used).
7. Script/CSS version tag raised to `20261030-1` so browsers fetch the new files instead of the 10-minute GitHub cache.

Diagnose any page: open it with `?perf` at the end of the address (e.g. `fees.html?perf`) and look at the browser Console (F12):
each table prints `shared / direct` and the milliseconds it took.

## Cold-start round (first open of a page was slow, repeat opens were fast)
Your tables are small (largest: audit_log 17,995, accounts 6,338, staff_attendance 5,970, books 3,205, fees 3,130), so the wait was
not the amount of data but the *steps before it appears*. Changed:
1. Paging uses `limit/offset` instead of a `Range` header (Range answers can skip compression and fail when a table shrinks).
2. The sort column and last row count are remembered in the browser, so a repeat load asks for every page at once (1 wait, not 2).
3. After the current page has loaded, the big tables the user can open next are downloaded quietly in the background (`sbWarmList`).
4. Saved data stays usable for 7 days (shown instantly, refreshed in the background, page redraws only if something changed);
   if the server cannot be reached a short notice says the saved copy is being shown.
5. The connection to the database is opened at page start (`preconnect`).
6. "Loading…" while only reading data is now a small floating chip; the page stays visible. Saving / deleting still blocks the screen.

## Smooth page switching (screen / sidebar blink)
Causes: (1) the sidebar was built only after the whole page had been read, so it popped in on every page; (2) ten pages hid the whole
page until the stylesheet loaded (four others did not, which is why only some pages blinked); (3) the browser had nothing to hold on
screen while the next page loaded.
Changed: the sidebar is drawn as soon as its container is read (first frame) and redrawn only if permissions arrive late;
the page is no longer hidden while loading (only if the stylesheet truly fails); `@view-transition` makes Chrome / Edge / Safari keep
the old page until the new one is ready and cross-fade the content while the sidebar stays still.

## Fee challans (Fee Vouchers -> "Print challans")
A4 landscape, three copies per student (Student / Office / Bank), modelled on the school's own challan.
Choose a class (or the whole school) or one student, the month the challan is for, and the "arrears up to" date.
Arrears = every item still unpaid for earlier months up to that date; a minus amount is fee paid in advance.
Amount payable = arrears + that month's fee (never below 0). Skips students with no voucher for the month, nothing to pay, or who have left (each can be included).
More than 11 lines are merged ("Earlier dues (n items)") so a challan always fits one page. Wording, top box, notes, fine and copies are remembered.
Files: js/pages/challan.js, assets/logo.png (taken from the school's sample challan), fees.html (button + popup).
Note: the students table has no father's-name column, so the challan shows the contact number instead.

## Speed regression fix (every page slow again, switching pages reloaded everything)
Found in the repository as uploaded:
1. `js/core/auth.js` treated EVERY non-GET request as a write and emptied the whole data cache. Reports, Audit, Follow-ups and the new
   Payroll Waivers list call server functions with POST although they only read, so opening Accounts / Reports / Audit wiped the cached
   students, fees, accounts and books, and the next page started from zero. Read-only server functions (`list_*`, `get_*`, `read_*`,
   `search_*`, `app_audit_events`, `app_business_reports`, `app_followup_data`) now leave the cache alone and are not blocked by "close previous days".
   Real changes (save / review / schedule ...) still clear it.
2. Accounts waited for the waiver data (1 table + 1 server function) on every load. It now loads when the Waivers tab is opened.
3. The pages carried 8 different `?v=` numbers for the same scripts, so each page switch downloaded the scripts again. All pages now share one (`20261110-1`).
4. `.github/workflows/build-css.yml` was the old one (scans only nav.js / config.js), so every rebuild of `styles.css` lost 121 classes used in `js/`
   (sidebar layout, buttons ...). The corrected workflow scans `*.html` and `js/**/*.js`.
5. Staff schema checks run once a day (`sbProbe`) again; accounts.html and staff.html lost the old "hide page while loading" script.
