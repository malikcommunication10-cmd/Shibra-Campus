// ============================================================================
//  Shared settings + helpers for every page (change the Supabase project HERE only)
// ============================================================================
const SB_URL = "https://tsnfwebctvjnmmweepiu.supabase.co";
const SB_KEY = "sb_publishable_mQcfSTQd8nca5xzbT1q6dw_aRvOHIYh";
function getSupabaseConfig() { return { url: SB_URL, key: SB_KEY }; }
let _sbXlsxLoading = null;
function sbLoadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!_sbXlsxLoading) {
        _sbXlsxLoading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            script.async = true;
            script.onload = () => window.XLSX
                ? resolve(window.XLSX)
                : reject(new Error('The Excel reader loaded without its required API.'));
            script.onerror = () => reject(new Error('Excel support could not load. Check your internet connection and try again.'));
            document.head.appendChild(script);
        }).catch(error => {
            _sbXlsxLoading = null;
            throw error;
        });
    }
    return _sbXlsxLoading;
}

// ============================================================================
//  LOGIN + USERS & ROLES.  Every page needs a session; every data request carries the user's token.
//  login.html sets  window.SB_NO_GUARD = true  before loading this file.
// ============================================================================
const SB_SESSION_KEY = 'sb_session_v1', SB_ME_KEY = 'sb_me_v1', SB_LOGOUT_REASON_KEY = 'sb_logout_reason_v1';
const SB_IDLE_TIMEOUT = 5 * 60 * 1000;
const SB_DATA_CACHE_PREFIX = 'sb_data_v1_', SB_DATA_CACHE_TTL = 20000, SB_DATA_CACHE_STALE = 5 * 60 * 1000;
const SB_DATA_DB_NAME = 'shibra_data_cache_v1', SB_DATA_DB_STORE = 'responses';
const _sbDataMemory = new Map(), _sbDataPending = new Map();
let _sbDataDbPromise = null;
function sbSession() { try { return JSON.parse(localStorage.getItem(SB_SESSION_KEY) || 'null'); } catch (e) { return null; } }
function sbDataCacheUser() { return encodeURIComponent(String((sbSession() || {}).email || 'anonymous').toLowerCase()); }
function sbDataCacheKey(table, query) {
    return `${SB_DATA_CACHE_PREFIX}${sbDataCacheUser()}_${table}_${encodeURIComponent(query)}`;
}
function sbOpenDataCache() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (!_sbDataDbPromise) {
        _sbDataDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(SB_DATA_DB_NAME, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(SB_DATA_DB_STORE))
                    request.result.createObjectStore(SB_DATA_DB_STORE, { keyPath: 'key' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Could not open the local data cache.'));
            request.onblocked = () => reject(new Error('The local data cache is blocked by another tab.'));
        }).catch(error => {
            _sbDataDbPromise = null;
            throw error;
        });
    }
    return _sbDataDbPromise;
}
async function sbReadPersistentData(key) {
    const db = await sbOpenDataCache();
    if (!db) return null;
    return new Promise((resolve, reject) => {
        const request = db.transaction(SB_DATA_DB_STORE, 'readonly').objectStore(SB_DATA_DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Could not read the local data cache.'));
    });
}
async function sbWritePersistentData(value) {
    const db = await sbOpenDataCache();
    if (!db) return;
    await new Promise((resolve, reject) => {
        const request = db.transaction(SB_DATA_DB_STORE, 'readwrite').objectStore(SB_DATA_DB_STORE).put(value);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('Could not save the local data cache.'));
    });
}
async function sbDeletePersistentData(userPrefix, tableName) {
    const db = await sbOpenDataCache();
    if (!db) return;
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(SB_DATA_DB_STORE, 'readwrite');
        const request = transaction.objectStore(SB_DATA_DB_STORE).openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const key = String(cursor.key || '');
            if (key.startsWith(userPrefix) && (!tableName || key.startsWith(`${userPrefix}${tableName}_`)))
                cursor.delete();
            cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not clear the local data cache.'));
        transaction.onabort = () => reject(transaction.error || new Error('Could not clear the local data cache.'));
    });
}
function sbDataRevision(table) {
    try { return `${localStorage.getItem('sb_data_rev_all') || ''}|${localStorage.getItem(`sb_data_rev_${table}`) || ''}`; }
    catch (e) { return ''; }
}
function sbCacheClear(table) {
    const tableName = table ? String(table) : '';
    const userPrefix = `${SB_DATA_CACHE_PREFIX}${sbDataCacheUser()}_`;
    for (const key of _sbDataMemory.keys())
        if (!tableName || key.startsWith(`${userPrefix}${tableName}_`)) _sbDataMemory.delete(key);
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(SB_DATA_CACHE_PREFIX)
                && (!tableName || key.startsWith(`${userPrefix}${tableName}_`)))
                sessionStorage.removeItem(key);
        }
        const revision = `${Date.now()}_${Math.random()}`;
        localStorage.setItem(tableName ? `sb_data_rev_${tableName}` : 'sb_data_rev_all', revision);
        if (!tableName) sessionStorage.removeItem(`sb_data_preload_v1_${sbDataCacheUser()}`);
        if ((!tableName || tableName === 'settings') && typeof _settingLists !== 'undefined') {
            _settingLists = null;
            _settingListsRevision = '';
            sessionStorage.removeItem('sb_settings_v2');
        }
    } catch (e) {}
    sbDeletePersistentData(userPrefix, tableName).catch(error => console.warn('Could not clear the persistent data cache:', error));
}
function sbSaveSession(j, resetIdle = false) {
    const old = sbSession() || {};
    const email = String((j.user && j.user.email) || old.email || '').toLowerCase();
    const sameAccount = email && email === String(old.email || '').toLowerCase();
    const s = {
        access_token: j.access_token,
        refresh_token: j.refresh_token || old.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
        email,
        last_activity: resetIdle || !sameAccount || !old.last_activity ? Date.now() : old.last_activity
    };
    localStorage.setItem(SB_SESSION_KEY, JSON.stringify(s)); return s;
}
function sbClearAuth() { try { sbCacheClear(); localStorage.removeItem(SB_SESSION_KEY); localStorage.removeItem(SB_ME_KEY); } catch (e) {} }
function sbLogout(reason) {
    if (reason) {
        try { sessionStorage.setItem(SB_LOGOUT_REASON_KEY, reason); } catch (e) {}
    }
    sbClearAuth();
    location.replace('login.html');
}
let _sbIdleMonitor = null, _sbLastActivityWrite = 0, _sbLoggingOut = false;
function sbCheckIdleSession() {
    const session = sbSession();
    if (!session || _sbLoggingOut) return;
    const lastActivity = Number(session.last_activity) || 0;
    if (!lastActivity || Date.now() - lastActivity >= SB_IDLE_TIMEOUT) {
        _sbLoggingOut = true;
        sbLogout('idle');
    }
}
function sbRecordUserActivity() {
    const session = sbSession();
    if (!session || _sbLoggingOut) return;
    const now = Date.now();
    if (Number(session.last_activity) && now - Number(session.last_activity) >= SB_IDLE_TIMEOUT) {
        sbCheckIdleSession();
        return;
    }
    if (now - _sbLastActivityWrite < 10000) return;
    session.last_activity = now;
    try {
        localStorage.setItem(SB_SESSION_KEY, JSON.stringify(session));
        _sbLastActivityWrite = now;
    } catch (error) {
        console.error('Could not update the inactivity timer:', error);
    }
}
function sbStartIdleMonitor() {
    if (window.SB_NO_GUARD || !sbSession() || _sbIdleMonitor) return;
    const session = sbSession();
    if (!Number(session.last_activity)) {
        session.last_activity = Date.now();
        try { localStorage.setItem(SB_SESSION_KEY, JSON.stringify(session)); }
        catch (error) { console.error('Could not initialize the inactivity timer:', error); }
    }
    ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll', 'click', 'input'].forEach(eventName =>
        document.addEventListener(eventName, sbRecordUserActivity, { passive: true })
    );
    _sbIdleMonitor = setInterval(sbCheckIdleSession, 5000);
    window.addEventListener('storage', event => {
        if (event.key !== SB_SESSION_KEY) return;
        if (!event.newValue && sbSession()) {
            sbLogout('signed-out');
            return;
        }
        try {
            const updated = JSON.parse(event.newValue || 'null');
            const current = sbSession();
            if (updated && current && updated.email === current.email
                && Number(updated.last_activity) > Number(current.last_activity || 0)) {
                current.last_activity = Number(updated.last_activity);
                localStorage.setItem(SB_SESSION_KEY, JSON.stringify(current));
            }
        } catch (error) {
            console.error('Could not synchronize the inactivity timer:', error);
        }
    });
}
const _sbFetch = window.fetch.bind(window);
let _sbRefreshing = null;
function sbPakistanDate(offsetDays) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = key => parts.find(x => x.type === key).value;
    const day = new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')) + (offsetDays || 0)));
    return day.toISOString().slice(0, 10);
}
function sbDayClosePending() {
    return !!(ME && ME.perms && (ME.perms.flags || []).includes('requiredayclose')
        && String(ME.closedThrough || '') < sbPakistanDate(-1));
}
function sbUpdateDayCloseDateLimits() {
    if (!document.body) return;
    const pending = sbDayClosePending();
    document.querySelectorAll('#emDate, #qeDate, #mDate, #ssDate, #sdDate, #payDate, #bulkPayDate').forEach(input => {
        if (!input.dataset.dayCloseMaxSaved) {
            input.dataset.dayCloseMaxSaved = '1';
            input.dataset.dayCloseOriginalMax = input.getAttribute('max') || '';
        }
        if (pending) {
            const yesterday = sbPakistanDate(-1);
            const originalMax = input.dataset.dayCloseOriginalMax;
            input.max = originalMax && originalMax < yesterday ? originalMax : yesterday;
        } else if (input.dataset.dayCloseOriginalMax) input.max = input.dataset.dayCloseOriginalMax;
        else input.removeAttribute('max');
    });
}
async function sbFreshToken() {
    const s = sbSession(); if (!s) return null;
    if (s.expires_at - Date.now() / 1000 > 60) return s.access_token;
    if (!_sbRefreshing) _sbRefreshing = (async () => {
        try {
            const r = await _sbFetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
            if (!r.ok) throw new Error('refresh failed');
            return sbSaveSession(await r.json()).access_token;
        } catch (e) { sbClearAuth(); if (!window.SB_NO_GUARD) location.replace('login.html'); return null; }
        finally { _sbRefreshing = null; }
    })();
    return _sbRefreshing;
}
window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '');
    if (url.startsWith(SB_URL + '/rest/v1')) {
        const method = String((init && init.method) || (input instanceof Request && input.method) || 'GET').toUpperCase();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            const match = url.match(/\/rest\/v1\/([^/?]+)/);
            const resource = match ? decodeURIComponent(match[1]) : '';
            sbCacheClear(resource && resource !== 'rpc' ? resource : '');
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)
            && !/\/rest\/v1\/day_close(?:[/?]|$)/.test(url)
            && sbDayClosePending()) {
            const message = `Close all previous days through ${sbPakistanDate(-1)} before making changes for today.`;
            if (typeof deny === 'function') deny(message);
            return new Response(JSON.stringify({ message }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        const tok = await sbFreshToken();
        if (!tok) throw new Error('An active session is required to access school records.');
        init = Object.assign({}, init);
        const h = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        h.set('apikey', SB_KEY);
        h.set('Authorization', 'Bearer ' + tok);
        init.headers = h;
    }
    return _sbFetch(input, init);
};

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

// Supabase returns max 1000 rows per request. The first request also returns the total row count
// (Content-Range), then ALL remaining pages are fetched in parallel. Behaves like a fetch Response.
async function sbFetchAllUncached(table, query) {
    query = query || 'select=*';
    const c = getSupabaseConfig(), ordKey = 'sb_ord2_' + table;
    const hdr = (f, t, count) => Object.assign({ apikey: c.key, Authorization: `Bearer ${c.key}`, Range: `${f}-${t}`, 'Range-Unit': 'items' }, count ? { Prefer: 'count=exact' } : {});
    const get = (f, t, col, count) => fetch(`${c.url}/rest/v1/${table}?${query}${col ? '&order=' + col + '.asc' : ''}`, { headers: hdr(f, t, count) });
    const fail = r => ({ ok: false, status: r.status, json: async () => r.json().catch(() => ({})), text: async () => r.text().catch(() => '') });
    // stable paging needs a sort column: use the first of id / seq / created_at that the table has (remembered per tab)
    let col = null, r = null;
    if (!/(^|&)order=/.test(query)) {
        let cached = null; try { cached = sessionStorage.getItem(ordKey); } catch (e) {}
        const cands = cached === '-' ? [] : (cached ? [cached] : ['id', 'seq', 'created_at']);
        for (const cc of cands) { const x = await get(0, 999, cc, true); if (x.ok) { col = cc; r = x; break; } }
        try { sessionStorage.setItem(ordKey, col || '-'); } catch (e) {}
    }
    if (!r) r = await get(0, 999, null, true);
    if (!r.ok) return fail(r);
    let rows = await r.json();
    if (!Array.isArray(rows)) return { ok: false, status: 200, json: async () => rows, text: async () => '' };
    const cr = r.headers.get('content-range') || '', total = cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN, size = rows.length;
    if (size && !isNaN(total) && total > size) {
        const jobs = [];
        for (let f = size; f < total; f += size) jobs.push(get(f, f + size - 1, col, false).then(x => x.ok ? x.json() : Promise.reject(x)));
        try { (await Promise.all(jobs)).forEach(a => { rows = rows.concat(a); }); }
        catch (x) { return fail(x && x.status ? x : { status: 500, json: async () => ({}), text: async () => '' }); }
    } else if (size && isNaN(total)) {                       // header not available: fall back to sequential paging
        for (let f = size; ; f += size) {
            const x = await get(f, f + size - 1, col, false);
            if (!x.ok) return fail(x);
            const a = await x.json(); if (!Array.isArray(a) || !a.length) break;
            rows = rows.concat(a);
        }
    }
    return { ok: true, status: 200, json: async () => rows, text: async () => '' };
}

// Cache briefly per signed-in user; expired data stays visible while a background refresh runs.
function sbFetchAllNetwork(table, query, key, revision, background) {
    const existing = _sbDataPending.get(key);
    if (existing && existing.revision === revision) return existing.promise;
    const request = (async () => {
        const response = await sbFetchAllUncached(table, query);
        if (!response.ok) return response;
        const rows = await response.json();
        if (!Array.isArray(rows)) return { ok: false, status: response.status, json: async () => rows, text: async () => '' };
        if (sbDataRevision(table) !== revision) return { ok: true, status: response.status, json: async () => rows, text: async () => '' };
        const value = JSON.stringify(rows), expires = Date.now() + SB_DATA_CACHE_TTL, staleUntil = expires + SB_DATA_CACHE_STALE;
        _sbDataMemory.set(key, { revision, expires, staleUntil, packed: value });
        sbWritePersistentData({ key, revision, expires, staleUntil, rows })
            .catch(error => console.warn(`Could not persist cached ${table} data:`, error));
        try {
            if (value.length < 1800000)
                sessionStorage.setItem(key, JSON.stringify({ revision, expires, staleUntil, rows }));
        } catch (e) {}
        if (table === 'settings' && typeof _settingLists !== 'undefined') {
            _settingLists = null;
            _settingListsRevision = '';
            try { sessionStorage.removeItem('sb_settings_v2'); } catch (e) {}
        }
        if (background) window.dispatchEvent(new CustomEvent('sb:data-cache-updated', { detail: { table, query } }));
        return { ok: true, status: response.status, json: async () => rows, text: async () => '' };
    })();
    let tracked;
    tracked = request.finally(() => {
        const pending = _sbDataPending.get(key);
        if (pending && pending.promise === tracked) _sbDataPending.delete(key);
    });
    _sbDataPending.set(key, { revision, promise: tracked });
    return tracked;
}
async function sbFetchAll(table, query) {
    query = query || 'select=*';
    const key = sbDataCacheKey(table, query), revision = sbDataRevision(table), now = Date.now();
    for (const [cacheKey, entry] of _sbDataMemory)
        if (entry.staleUntil <= now) _sbDataMemory.delete(cacheKey);

    let cached = _sbDataMemory.get(key);
    if (!cached || cached.revision !== revision) {
        cached = null;
        try {
            const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
            if (saved && saved.revision === revision && Array.isArray(saved.rows)) {
                const staleUntil = Number(saved.staleUntil || saved.expires || 0);
                if (staleUntil > now) {
                    cached = { revision, expires: Number(saved.expires) || 0, staleUntil, packed: JSON.stringify(saved.rows) };
                    _sbDataMemory.set(key, cached);
                } else sessionStorage.removeItem(key);
            }
        } catch (e) {}
        if (!cached) {
            try {
                const saved = await sbReadPersistentData(key);
                if (saved && saved.revision === revision && Array.isArray(saved.rows)) {
                    const staleUntil = Number(saved.staleUntil || saved.expires || 0);
                    if (staleUntil > now) {
                        cached = {
                            revision,
                            expires: Number(saved.expires) || 0,
                            staleUntil,
                            packed: JSON.stringify(saved.rows)
                        };
                        _sbDataMemory.set(key, cached);
                    }
                }
            } catch (error) {
                console.warn(`Could not read persistent ${table} cache:`, error);
            }
        }
    }
    if (cached && cached.staleUntil > now) {
        const rows = JSON.parse(cached.packed);
        if (cached.expires <= now)
            sbFetchAllNetwork(table, query, key, revision, true).then(response => {
                if (!response.ok) console.warn(`Background refresh for ${table} failed with HTTP ${response.status}.`);
            }).catch(error => console.warn(`Background refresh for ${table} failed:`, error));
        return { ok: true, status: 200, json: async () => rows, text: async () => cached.packed };
    }
    return sbFetchAllNetwork(table, query, key, revision);
}

// Dropdown lists + rules maintained on the System Settings page (with sensible defaults)
const SETTING_DEFAULTS = {
    'Class': ['Playgroup', 'Pre-Nursery', 'Nursery', 'Prep', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'],
    'Section': ['A', 'B', 'C'],
    'Designation': ['Principal', 'Vice Principal', 'Teacher', 'Coordinator', 'Accountant', 'Clerk', 'Computer Operator', 'Driver', 'Guard', 'Peon', 'Aya / Helper'],
    'Income Head': ['Admission / Registration Fee', 'Annual Fund', 'Book Store Sale', 'Uniform / Stationery Sale', 'Transport Fee', 'Donation', 'Other Income'],
    'Expense Head': ['Salaries', 'Utility Bills', 'Rent', 'Stationery', 'Repair & Maintenance', 'Fuel / Transport', 'Events / Functions', 'Books Purchase', 'Printing', 'Internet / Phone', 'Refreshments', 'Misc Expense'],
    'Book Vendor': [],
    'Book Category': ['Books', 'Notebooks', 'Study Planner', 'Lamination Paper'],
    'Payment Account': [],
    'Business Partner': []
};
let _settingLists = null, _settingListsRevision = '';
async function loadSettingLists() {
    const revision = sbDataRevision('settings');
    if (_settingLists && _settingListsRevision === revision) return _settingLists;
    try {
        const c = JSON.parse(sessionStorage.getItem('sb_settings_v3') || 'null');
        if (c && c.r === revision && Date.now() - c.t < 120000) {
            _settingLists = c.d; _settingListsRevision = revision; return c.d;
        }
    } catch (e) {}
    const out = { rules: { 'School Year': String(new Date().getFullYear()) } };
    Object.keys(SETTING_DEFAULTS).forEach(k => out[k] = [...SETTING_DEFAULTS[k]]);
    try {
        const rows = await (await sbFetchAll('settings', 'select=setting_key,setting_value')).json();
        if (Array.isArray(rows)) {
            const by = {};
            const canon = k => String(k || '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
            const ALIAS = { 'Book Vendor': ['bookvendor', 'vendor', 'booksupplier', 'supplier'], 'Income Head': ['incomehead', 'income'], 'Expense Head': ['expensehead', 'expense'], 'Designation': ['designation'], 'Class': ['class'], 'Section': ['section'], 'Book Category': ['bookcategory', 'category'], 'Payment Account': ['paymentaccount', 'paymentmode', 'paymentaccounts'], 'Business Partner': ['businesspartner', 'partner', 'partners'] };
            const keyOf = raw => { const cn = canon(raw); for (const d of Object.keys(ALIAS)) if (ALIAS[d].includes(cn) || canon(d) === cn) return d; return String(raw || '').trim(); };
            rows.forEach(x => { const k = keyOf(x.setting_key), v = String(x.setting_value ?? '').trim(); if (k && v !== '') (by[k] = by[k] || []).push(v); });
            Object.keys(SETTING_DEFAULTS).forEach(k => { if (by[k] && by[k].length) out[k] = by[k]; });
            ['Payroll Working Days', 'Payroll Free Leaves', 'Low Stock Limit', 'School Year'].forEach(k => { if (by[k]) out.rules[k] = by[k][0]; });
        }
    } catch (e) { console.error('Settings lists', e); }
    // rules saved on the Settings page also drive the Staff / Book Store pages
    try {
        if (out.rules['Low Stock Limit'] !== undefined) localStorage.setItem('books_low_stock', out.rules['Low Stock Limit']);
    } catch (e) {}
    _settingLists = out;
    _settingListsRevision = revision;
    try { sessionStorage.setItem('sb_settings_v3', JSON.stringify({ t: Date.now(), r: revision, d: out })); } catch (e) {}
    return out;
}
async function getSchoolYear() {
    const lists = await loadSettingLists();
    const year = Number(lists.rules['School Year']);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw new Error('School Year in System Settings must be a year from 2000 to 2100.');
    }
    return year;
}

// ============================================================================
//  Book Store dues (what students owe / what is owed to vendors) - shared by
//  the Book Store, Accounts and Dashboard pages.
//  Credit entry  = a sale / purchase that was NOT recorded in Accounts (voucher BK-...).
//  Settlement    = an Accounts receipt (RV-, head "Book Store Sale") or payment (PV-, head "Books Purchase")
//                  whose particulars equal the party name. Settlements clear the oldest entries first (FIFO).
// ============================================================================
const BOOK_SALE_HEAD = 'Book Store Sale', BOOK_BUY_HEAD = 'Books Purchase';
const partyKey = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function normBookRow(row) {
    const t = String(row.type ?? row.tx_type ?? '').trim().toLowerCase();
    const kind = t.includes('return') ? (t.includes('sale') ? 'sale_return' : 'purchase_return') : (t.includes('sale') ? 'sale' : 'purchase');
    return { kind, party: String(row.party_name ?? row.party ?? '').trim(), net: parseFloat(row.net_amount ?? row.amount) || 0, voucher: String(row.voucher_no ?? '').trim(),
        notes: String(row.notes ?? '').trim(), date: String(row.date ?? '').slice(0, 10), title: String(row.book ?? row.book_title ?? row.title ?? '').trim(), qty: parseFloat(row.qty) || 0 };
}
function computeDues(txs, accRows, opts) {
    opts = opts || {};
    const P = {}, bills = {}, rows = accRows || [];
    const get = name => { const k = partyKey(name); return P[k] || (P[k] = { key: k, name: String(name).trim(), recvE: [], payE: [], recvS: [], payS: [] }); };
    (txs || []).forEach(t => {                                   // Book Store sales / purchases that were NOT recorded in Accounts
        if (!t.party) return;
        const v = String(t.voucher || '').toUpperCase();
        if (!v || v.startsWith('RV-') || v.startsWith('PV-') || v.startsWith('BK-IMP') || /^imported/i.test(t.notes || '')) return;
        const p = get(t.party);
        if (t.kind === 'sale' || t.kind === 'purchase') {
            const e = { date: t.date, amt: t.net, voucher: t.voucher, title: t.title, qty: t.qty, src: 'book', paid: 0, pk: p.key, side: t.kind === 'sale' ? 'recv' : 'pay' };
            (t.kind === 'sale' ? p.recvE : p.payE).push(e); bills[v] = e;
        } else if (t.kind === 'sale_return') p.recvS.push({ date: t.date, amt: t.net, voucher: t.voucher, label: 'Sale return', pool: true });
        else if (t.kind === 'purchase_return') p.payS.push({ date: t.date, amt: t.net, voucher: t.voucher, label: 'Purchase return', pool: true });
    });
    if (!opts.bookOnly) rows.forEach(r => {                      // bills raised (AR-) / received (AP-) in Accounts
        const v = String(r.voucher_id || '').trim().toUpperCase(), m = v.match(/^(AR|AP)-\d+$/);
        if (!m || !r.description) return;
        const recv = m[1] === 'AR', amt = parseFloat(recv ? r.amount_in : r.amount_out) || 0;
        if (amt <= 0) return;
        const p = get(r.description), e = { date: String(r.date || '').slice(0, 10), amt, voucher: v, title: String(r.remarks || '').trim(), qty: 0, src: 'acct', paid: 0, pk: p.key, side: recv ? 'recv' : 'pay' };
        (recv ? p.recvE : p.payE).push(e); bills[v] = e;
    });
    rows.forEach(r => {                                          // settlements: they carry the bill voucher (BK-123456-xxxx)
        const vid = String(r.voucher_id || '').trim(), up = vid.toUpperCase(), d = String(r.date || '').slice(0, 10);
        const inA = parseFloat(r.amount_in) || 0, outA = parseFloat(r.amount_out) || 0, ref = up.match(/^((?:AR|AP|BK)-\d+)-/);
        if (ref) {
            const b = bills[ref[1]]; if (!b) return;
            const amt = b.side === 'recv' ? inA : outA; if (amt <= 0) return;
            b.paid += amt;
            P[b.pk][b.side === 'recv' ? 'recvS' : 'payS'].push({ date: d, amt, voucher: vid, bill: b.voucher, label: b.side === 'recv' ? 'Receipt' : 'Payment' });
            return;
        }
        const p = P[partyKey(r.description)]; if (!p) return;     // older receipts / payments matched by party name
        if (up.startsWith('RV-') && partyKey(r.from_account) === partyKey(BOOK_SALE_HEAD) && inA > 0) p.recvS.push({ date: d, amt: inA, voucher: vid, label: 'Receipt', pool: true });
        else if (up.startsWith('PV-') && partyKey(r.to_account) === partyKey(BOOK_BUY_HEAD) && outA > 0) p.payS.push({ date: d, amt: outA, voucher: vid, label: 'Payment', pool: true });
    });
    const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || String(a.voucher).localeCompare(String(b.voucher));
    const r2 = n => Math.round(n * 100) / 100;
    const side = (E, S) => {
        E.sort(byDate); S.sort(byDate);
        let pool = S.filter(x => x.pool).reduce((t, x) => t + x.amt, 0);
        E.forEach(e => { const rem0 = Math.max(0, e.amt - e.paid), use = Math.min(pool, rem0); pool -= use; e.rem = r2(rem0 - use); e.paid = r2(e.amt - e.rem); });
        const total = E.reduce((t, e) => t + e.amt, 0), settled = S.reduce((t, x) => t + x.amt, 0);
        return { total: r2(total), settled: r2(settled), pending: r2(total - settled) };
    };
    return Object.values(P).filter(p => p.recvE.length || p.payE.length).map(p => {
        p.recv = side(p.recvE, p.recvS); p.pay = side(p.payE, p.payS);
        p.last = [...p.recvE, ...p.payE, ...p.recvS, ...p.payS].reduce((m, x) => ((x.date || '') > m ? x.date : m), '');
        return p;
    });
}
const computeBookDues = (txs, accRows) => computeDues(txs, accRows, { bookOnly: true });
// latest promise-to-pay per party, stored in the settings table (key "Book Promise")
function parsePromises(rows) {
    const out = {};
    (rows || []).forEach(x => { try { const o = JSON.parse(x.setting_value); if (o && o.k && (!out[o.k] || (o.ts || 0) >= (out[o.k].ts || 0))) out[o.k] = o; } catch (e) {} });
    Object.keys(out).forEach(k => { if (!out[k].d) delete out[k]; });
    return out;
}

// ============================================================================
//  One voucher can hold several fee rows (the admission voucher: registration + admission + annual fund + tuition).
//  The payments of a voucher are shared by its rows and clear them in this order.
// ============================================================================
const FEE_ORDER = ['arrears', 'registration fee', 'admission fee', 'annual fund', 'tuition fee'];
const feeRank = t => { const i = FEE_ORDER.indexOf(String(t || '').trim().toLowerCase()); return i < 0 ? 9 : i; };
// when the rows were created (columns tried in this order: seq, created_at, id); rows without any keep the loaded order
const rowOrder = r => { if (r.seq != null && isFinite(Number(r.seq))) return Number(r.seq); if (r.created_at) { const t = Date.parse(r.created_at); if (!isNaN(t)) return t; } const n = Number(r.id); return isFinite(n) && r.id !== '' && r.id != null ? n : 0; };
// returns the paid amount of every row (same order as rows); paidOf(row) is the TOTAL paid of the row's voucher.
// The payments of a voucher clear its rows OLDEST FIRST (orderOf), e.g. January tuition before an annual fund added later.
function splitVoucherPaid(rows, netOf, paidOf, typeOf, vidOf, orderOf) {
    const groups = {};
    rows.forEach((r, i) => { const v = String(vidOf(r) || '').trim(); (groups[v] = groups[v] || []).push(i); });
    const out = new Array(rows.length).fill(0);
    Object.keys(groups).forEach(v => {
        const idx = groups[v], total = paidOf(rows[idx[0]]) || 0;
        if (idx.length === 1) { out[idx[0]] = total; return; }
        let left = total;
        const key = i => orderOf ? orderOf(rows[i]) : feeRank(typeOf(rows[i]));
        const ord = idx.slice().sort((a, b) => key(a) - key(b) || a - b);
        ord.forEach((i, k) => { const use = k === ord.length - 1 ? left : Math.max(0, Math.min(left, netOf(rows[i]))); out[i] = Math.round(use * 100) / 100; left -= use; });
    });
    return out;
}

// ============================================================================
//  Payment accounts (Settings -> "Payment accounts"): Cash is always there; banks and wallets are added in Settings,
//  e.g. "ABL 0021252355" or "Online / JazzCash". The chosen text is what gets saved in Accounts.
// ============================================================================
function payBaseKey(t) {
    const s = String(t || '').trim().toLowerCase();
    if (s === 'cash' || s === 'cash in hand') return 'cash';
    if (s === 'bank') return 'bank';
    if (/^online(\s*\/\s*jazz\s*cash)?$/.test(s)) return 'online';
    return null;
}
const payEsc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function payAccountList(items) {
    const out = [{ value: 'cash', label: '💵 Cash in Hand' }], seen = new Set(['cash']);
    const src = (items && items.length) ? items : ['Bank', 'Online / JazzCash'];      // nothing in Settings yet: the old Cash / Bank / Online
    src.forEach(raw => {
        const t = String(raw || '').trim(); if (!t) return;
        const b = payBaseKey(t), value = b || t, k = value.toLowerCase();
        if (seen.has(k)) return; seen.add(k);
        out.push({ value, label: b === 'bank' ? '🏦 Bank' : b === 'online' ? '📱 Online / JazzCash' : (/online|jazz|easy|raast|wallet/i.test(t) ? '📱 ' : '🏦 ') + t });
    });
    return out;
}
const payOptionsHtml = (list, sel) => list.map(o => `<option value="${payEsc(o.value)}"${o.value === sel ? ' selected' : ''}>${payEsc(o.label)}</option>`).join('');
async function fillPaySelects(ids) {          // fills the <select>s and keeps whatever is already chosen
    const L = await loadSettingLists(), list = payAccountList(L['Payment Account']);
    ids.forEach(id => { const el = document.getElementById(id); if (!el) return; const cur = el.value; el.innerHTML = payOptionsHtml(list); if (cur && [...el.options].some(o => o.value === cur)) el.value = cur; });
    return list;
}
