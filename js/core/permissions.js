// ---- pages, actions and special permissions --------------------------------
const PAGES = [['dashboard', 'Dashboard', 'index.html'], ['students', 'Students Directory', 'students.html'], ['increments', 'Bulk Updation', 'increments.html'], ['fees', 'Fee Vouchers', 'fees.html'],
    ['followups', 'Follow-up Calls', 'followups.html'], ['books', 'Book Store', 'books.html'], ['accounts', 'Accounts & Daybook', 'accounts.html'], ['staff', 'Staff & Payroll', 'staff.html'],
    ['reports', 'Business Reports', 'reports.html'], ['audit', 'Audit Trail', 'audit.html'],
    ['settings', 'System Settings', 'settings.html'], ['users', 'Users & Roles', 'users.html']];
const PAGE_ACTS = [['v', 'View'], ['a', 'Add'], ['e', 'Edit'], ['d', 'Delete']];
const READ_ONLY_PAGES = new Set(['reports', 'audit']);
const PERM_FLAGS = [['money', 'See money totals on the dashboard'], ['export', 'Download CSV / backup'], ['assign', 'Assign follow-ups for any family or student'], ['allfollow', 'See ALL follow-up families (not only the assigned ones)'],
    ['closeday', 'Close / reopen the day'], ['requiredayclose', 'Require closing all previous days before working today'], ['editclosed', 'Change entries of closed or old days'], ['todayonly', 'Change (edit / delete) only the entries of the current open day']];
const PAGE_FILE = {}; PAGES.forEach(p => { PAGE_FILE[p[2]] = p[0]; });
PAGE_FILE['statements.html'] = 'reports';   // Financial Statements share the Business Reports permission
const currentPageKey = () => PAGE_FILE[(location.pathname.split('/').pop() || 'index.html').toLowerCase()] || null;
let ME = null;
const can = (page, act) => !!(ME && ME.perms && String((ME.perms.pages || {})[page] || '').includes(act));
const flag = f => !!(ME && ME.perms && (ME.perms.flags || []).includes(f));
const todayYmd = () => sbPakistanDate(0);
function sbFirstPage(me) { const m = me || ME; for (const p of PAGES) if (m && m.perms && String((m.perms.pages || {})[p[0]] || '').includes('v')) return p[2]; return null; }
async function sbFetchMe() {
    const s = sbSession(); if (!s) return null;
    const get = async path => { try { const r = await _sbFetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + (await sbFreshToken()) } }); const j = await r.json(); return r.ok ? j : null; } catch (e) { return null; } };
    const u = await get(`app_users?select=name,role,active,perms&email=eq.${encodeURIComponent(String(s.email || '').toLowerCase())}`);
    if (!Array.isArray(u)) return { error: 'setup', email: s.email };
    if (!u[0]) return { noaccess: true, email: s.email };
    let perms = u[0].perms;
    const [roleRows, dc] = await Promise.all([
        perms ? Promise.resolve(null) : get(`app_roles?select=perms&name=eq.${encodeURIComponent(u[0].role || '')}`),
        get('day_close?select=closed_date&order=closed_date.desc&limit=1')
    ]);
    if (!perms) perms = (Array.isArray(roleRows) && roleRows[0] && roleRows[0].perms) || { pages: {}, flags: [] };
    return { email: s.email, name: u[0].name || s.email, role: u[0].role || '', active: u[0].active !== false, perms, closedThrough: (Array.isArray(dc) && dc[0] && dc[0].closed_date) || '', ts: Date.now() };
}
function sbSaveMe(m) { try { localStorage.setItem(SB_ME_KEY, JSON.stringify(m)); } catch (e) {} }
function sbLoadMeCache() { try { const c = JSON.parse(localStorage.getItem(SB_ME_KEY) || 'null'); const s = sbSession(); if (c && s && c.email === s.email && c.perms && Date.now() - c.ts < 8 * 3600e3) return c; } catch (e) {} return null; }

function sbQueueDataPreload() {
    if (!ME || ME.error || ME.noaccess || !sbSession()) return;
    const preloadKey = `sb_data_preload_v1_${sbDataCacheUser()}`;
    try {
        const last = Number(sessionStorage.getItem(preloadKey) || 0);
        if (Date.now() - last < 60000) return;
        sessionStorage.setItem(preloadKey, String(Date.now()));
    } catch (e) {}

    const jobs = [];
    const canUseSettings = ['settings', 'books', 'fees', 'accounts', 'staff', 'dashboard'].some(page => can(page, 'v'));
    const canUseStudents = ['books', 'fees', 'dashboard'].some(page => can(page, 'v'));
    if (canUseSettings) jobs.push(['settings', 'select=setting_key,setting_value']);
    if (canUseStudents && currentPageKey() !== 'dashboard') jobs.push(['students', 'select=admis_no,student_name,class,status']);
    if (!jobs.length) return;

    const run = () => {
        Promise.all(jobs.map(async ([table, query]) => {
            const response = await sbFetchAll(table, query);
            if (!response.ok) throw new Error(`${table} preload failed with HTTP ${response.status}`);
        })).catch(error => console.error('Background data preload failed:', error));
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 300);
}

// ---- checks used by the pages ----------------------------------------------
function deny(msg) { const m = msg || 'You do not have permission for this action.'; const f = window.toast ? (x => window.toast(x, false)) : (window.showCustomAlert || window.showAlert || window.alert); f(m); }
function dayAllowed(date, changing) {
    const d = String(date || '').slice(0, 10); if (!d || !ME) return true;
    if (flag('editclosed')) return true;
    if (ME.closedThrough && d <= ME.closedThrough) return false;
    if (changing && flag('todayonly') && d !== todayYmd()) return false;
    return true;
}
function denyDay(date, changing) {
    if (dayAllowed(date, changing)) return false;
    const d = String(date || '').slice(0, 10);
    deny(ME.closedThrough && d <= ME.closedThrough ? `This day is closed (everything up to ${ME.closedThrough}). It can no longer be changed.` : 'You can change only the entries of the current open day.');
    return true;
}
// which function needs which permission (string = a/e/d on this page, '@flag' = special permission, function = decided at call time)
const PAGE_GUARDS = {
    students: { addStudentClick: 'a', saveStudent: () => (document.getElementById('editOriginalAdm') && document.getElementById('editOriginalAdm').value ? 'e' : 'a'), editStudentByAdm: 'e', editStudent: 'e', deleteStudent: 'd' },
    increments: { saveOrUpdateIncrement: 'e', saveByIdx: 'e', saveAllIncrementsBatch: 'e', applyBulkToCheckedRows: 'e', bulkDeleteSelected: 'd' },
    fees: { generateVouchers: 'a', generateAnnualFund: 'a', openAddItem: 'a', saveAddItem: 'a', openBulkPayModal: 'a', submitBulkFifoPayment: 'a', openPayModal: 'a', submitPayment: 'a', deleteSelectedVouchers: 'd', openSync: 'e', applySync: 'e', openDiscount: 'e', saveDiscount: 'e', openImport: 'a', confirmImport: 'a', downloadVouchersCsv: '@export', downloadArrearsReconciliation: '@export' },
    followups: { saveCall: 'a', openCallModal: 'a', deleteLog: 'd', exportHistoryCsv: '@export', openAssignmentModal: '@assign', saveFamilyAssignments: '@assign' },
    books: { openTx: 'a', saveTx: 'a', deleteTx: 'd', openStudentSale: 'a', saveStudentSale: 'a', openImport: 'a', saveImp: 'a', openNewItem: 'a', saveNewItem: 'a', deleteMasterItem: 'd', openSettle: 'a', saveSettle: 'a', openPromise: 'a', savePromise: 'a', exportCsv: '@export', exportInventoryCsv: '@export', exportTxCsv: '@export' },
    accounts: { openEntry: 'a', startSettle: 'a', saveAgainstBills: 'a', saveEntry: () => (typeof editingId !== 'undefined' && editingId ? 'e' : 'a'), editEntry: 'e', quickEdit: 'e', saveQuickEdit: 'e', deleteEntry: 'd', exportCsv: '@export', exportDaybookCsv: '@export', exportFeeCsv: '@export' },
    staff: { openStaff: 'a', saveStaff: 'a', deleteStaff: 'd', generatePayroll: 'a', openAdjust: 'e', saveAdjust: 'e', openRules: 'e', saveRules: 'e', openPay: 'a', paySalary: 'a', confirmPay: 'a', undoPay: 'd', removePayrollRow: 'd', exportCsv: '@export', exportStaffCsv: '@export', exportPayrollCsv: '@export', exportHistoryCsv: '@export' },
    settings: { addItem: 'a', addDefaults: 'a', addOther: 'a', deleteItem: 'd', deleteOther: 'd', openRename: 'e', saveRename: 'e', saveRules: 'e', saveLowStock: 'e', saveSchoolYear: 'e', upsertSingle: 'e', downloadBackup: '@export' },
    users: {
        openUser: () => (document.getElementById('uEditing') && document.getElementById('uEditing').value ? 'e' : 'a'),
        saveUser: () => (document.getElementById('uEditing') && document.getElementById('uEditing').value ? 'e' : 'a'),
        deleteUser: 'd', openRoleNew: 'a', createRole: 'a', deleteRole: 'd', openPerms: 'e', savePerms: 'e',
        resetUserPerms: 'e', closeDay: '@closeday', reopenDay: '@closeday'
    }
};
function installGuards() {
    const page = currentPageKey(), map = PAGE_GUARDS[page]; if (!map || !ME) return;
    const hide = [];
    Object.keys(map).forEach(name => {
        const need = map[name], orig = window[name]; if (typeof orig !== 'function') return;
        const ok = act => (typeof act === 'string' && act[0] === '@') ? flag(act.slice(1)) : can(page, act);
        if (typeof need === 'string' && !ok(need)) hide.push(`[onclick*="${name}("]`);
        window[name] = function (...a) {
            const act = typeof need === 'function' ? need() : need;
            if (!ok(act)) { if (a[0] && typeof a[0].preventDefault === 'function') a[0].preventDefault(); deny(); return; }
            return orig.apply(this, a);
        };
    });
    if (hide.length) document.head.insertAdjacentHTML('beforeend', `<style>${hide.join(',')}{display:none!important}</style>`);
}
function sbShowBlock(title, msg, withLogout) {
    document.documentElement.style.visibility = 'visible';
    document.body.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#f1f5f9;font-family:system-ui,sans-serif"><div style="max-width:380px;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.12);text-align:center"><div style="font-size:34px">🔒</div><h2 style="margin:8px 0 6px;color:#1e1b4b">${title}</h2><p style="color:#475569;font-size:14px;line-height:1.5">${msg}</p>${withLogout ? '<button onclick="sbLogout()" style="margin-top:14px;background:#4338ca;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:600;cursor:pointer">Back to login</button>' : ''}</div></div>`;
}
function sbApplyMe() {
    if (!ME) return;
    if (ME.error === 'setup') { sbShowBlock('Setup needed', 'The users table does not exist yet. Run supabase_roles.sql in the Supabase SQL Editor, then refresh.', true); return; }
    if (ME.noaccess || ME.active === false) { sbShowBlock('No access', ME.noaccess ? `${ME.email} has not been given a role yet. Please ask the administrator.` : 'This account is switched off. Please ask the administrator.', true); return; }
    const key = currentPageKey();
    if (key && !can(key, 'v')) { const f = sbFirstPage(); if (f && f !== (location.pathname.split('/').pop() || 'index.html')) { location.replace(f); return; } sbShowBlock('No access', 'You are not allowed to open this page.', true); return; }
    document.documentElement.style.visibility = 'visible';
    const go = () => {
        try { installGuards(); } catch (e) { console.error(e); }
        document.dispatchEvent(new CustomEvent('shibra:me-ready', { detail: ME }));
        sbUpdateDayCloseDateLimits();
        if (typeof window.shibraDayCloseRefresh === 'function') window.shibraDayCloseRefresh();
        sbQueueDataPreload();
        if (!window.__sbDayCloseObserver) {
            window.__sbDayCloseObserver = new MutationObserver(sbUpdateDayCloseDateLimits);
            window.__sbDayCloseObserver.observe(document.body, { childList: true, subtree: true });
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
}
if (!window.SB_NO_GUARD) {
    if (!sbSession()) location.replace('login.html');
    else {
        sbStartIdleMonitor();
        ME = sbLoadMeCache();
        if (ME) {
            sbApplyMe();
            sbFetchMe().then(m => {            // check in the background: if the administrator changed something, reload once
                if (!m || m.error || m.noaccess) { if (m && (m.noaccess)) { sbCacheClear(); sbSaveMe(m); location.reload(); } return; }
                const same = JSON.stringify([m.perms, m.closedThrough, m.active, m.role]) === JSON.stringify([ME.perms, ME.closedThrough, ME.active, ME.role]);
                sbSaveMe(m); if (typeof window.shibraDayCloseRefresh === 'function') window.shibraDayCloseRefresh();
                if (!same && !sessionStorage.getItem('sb_me_reloaded')) { sbCacheClear(); sessionStorage.setItem('sb_me_reloaded', '1'); location.reload(); } else if (same) sessionStorage.removeItem('sb_me_reloaded');
            });
        } else {
            try { document.documentElement.style.visibility = 'hidden'; } catch (e) {}
            sbFetchMe().then(m => { ME = m || { error: 'setup', email: (sbSession() || {}).email }; if (!ME.error && !ME.noaccess) sbSaveMe(ME); const run = () => sbApplyMe(); if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run(); });
        }
    }
}
async function sbChangePassword(pw) {
    const tok = await sbFreshToken(); if (!tok) return 'Please log in again.';
    const r = await _sbFetch(`${SB_URL}/auth/v1/user`, { method: 'PUT', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (r.ok) return ''; const j = await r.json().catch(() => ({})); return j.msg || j.message || 'Could not change the password.';
}

