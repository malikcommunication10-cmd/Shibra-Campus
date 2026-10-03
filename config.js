// ============================================================================
//  Shared settings + helpers for every page (change the Supabase project HERE only)
// ============================================================================
const SB_URL = "https://tsnfwebctvjnmmweepiu.supabase.co";
const SB_KEY = "sb_publishable_mQcfSTQd8nca5xzbT1q6dw_aRvOHIYh";
function getSupabaseConfig() { return { url: SB_URL, key: SB_KEY }; }

// Supabase returns max 1000 rows per request. The first request also returns the total row count
// (Content-Range), then ALL remaining pages are fetched in parallel. Behaves like a fetch Response.
async function _sbFetchAllNet(table, query) {
    query = query || 'select=*';
    const c = getSupabaseConfig(), ordKey = 'sb_ord_' + table;
    let ord = !/(^|&)order=/.test(query);
    try { if (sessionStorage.getItem(ordKey) === '0') ord = false; } catch (e) {}
    const hdr = (f, t, count) => Object.assign({ apikey: c.key, Authorization: `Bearer ${c.key}`, Range: `${f}-${t}`, 'Range-Unit': 'items' }, count ? { Prefer: 'count=exact' } : {});
    const get = (f, t, o, count) => fetch(`${c.url}/rest/v1/${table}?${query}${o ? '&order=id.asc' : ''}`, { headers: hdr(f, t, count) });
    const fail = r => ({ ok: false, status: r.status, json: async () => r.json().catch(() => ({})), text: async () => r.text().catch(() => '') });
    let r = await get(0, 999, ord, true);
    if (!r.ok && ord) { ord = false; try { sessionStorage.setItem(ordKey, '0'); } catch (e) {} r = await get(0, 999, false, true); }
    if (!r.ok) return fail(r);
    let rows = await r.json();
    if (!Array.isArray(rows)) return { ok: false, status: 200, json: async () => rows, text: async () => '' };
    const cr = r.headers.get('content-range') || '', total = cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN, size = rows.length;
    if (size && !isNaN(total) && total > size) {
        const jobs = [];
        for (let f = size; f < total; f += size) jobs.push(get(f, f + size - 1, ord, false).then(x => x.ok ? x.json() : Promise.reject(x)));
        try { (await Promise.all(jobs)).forEach(a => { rows = rows.concat(a); }); }
        catch (x) { return fail(x && x.status ? x : { status: 500, json: async () => ({}), text: async () => '' }); }
    } else if (size && isNaN(total)) {                       // header not available: fall back to sequential paging
        for (let f = size; ; f += size) {
            const x = await get(f, f + size - 1, ord, false);
            if (!x.ok) break;
            const a = await x.json(); if (!Array.isArray(a) || !a.length) break;
            rows = rows.concat(a);
        }
    }
    return { ok: true, status: 200, json: async () => rows, text: async () => '' };
}


// ============================================================================
//  SPEED: shared cache (IndexedDB + memory) so switching tabs does not re-download every table
//  - Data is reused for SB_CACHE_TTL ms, across ALL pages.
//  - Any save / edit / delete (POST, PATCH, DELETE) clears the cache of that table automatically.
//  - The Refresh buttons and the browser reload (F5) always fetch fresh data.
// ============================================================================
const SB_CACHE_TTL = 90 * 1000;                       // change here: how long data may be reused (milliseconds)
const _sbMem = new Map(), _sbInflight = new Map();
let _sbDb = null;
function _sbIdb() {
    if (_sbDb) return _sbDb;
    _sbDb = new Promise(res => {
        try {
            const rq = indexedDB.open('sb_cache_v1', 1);
            rq.onupgradeneeded = () => rq.result.createObjectStore('rows');
            rq.onsuccess = () => res(rq.result);
            rq.onerror = () => res(null);
        } catch (e) { res(null); }
    });
    return _sbDb;
}
async function _sbIdbGet(key) {
    const db = await _sbIdb(); if (!db) return null;
    return new Promise(res => { try { const r = db.transaction('rows').objectStore('rows').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); } catch (e) { res(null); } });
}
async function _sbIdbSet(key, val) {
    const db = await _sbIdb(); if (!db) return;
    try { db.transaction('rows', 'readwrite').objectStore('rows').put(val, key); } catch (e) {}
}
async function sbCacheClear(table) {
    const match = k => !table || k.split('|')[0] === table;
    for (const k of [..._sbMem.keys()]) if (match(k)) _sbMem.delete(k);
    for (const k of [..._sbInflight.keys()]) if (match(k)) _sbInflight.delete(k);
    const db = await _sbIdb(); if (!db) return;
    try {
        const st = db.transaction('rows', 'readwrite').objectStore('rows');
        if (!table) st.clear();
        else { const rq = st.openKeyCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { if (match(String(c.key))) st.delete(c.key); c.continue(); } }; }
    } catch (e) {}
}
// any write through fetch() to the REST api invalidates that table (before AND after the request)
(function () {
    const _fetch = window.fetch.bind(window), base = SB_URL + '/rest/v1/';
    window.fetch = function (input, init) {
        let table = null;
        try {
            const m = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            const u = typeof input === 'string' ? input : (input && input.url) || '';
            if (m !== 'GET' && m !== 'HEAD' && u.startsWith(base)) table = u.slice(base.length).split('?')[0];
        } catch (e) {}
        if (!table) return _fetch(input, init);
        sbCacheClear(table);
        const p = _fetch(input, init);
        p.then(() => sbCacheClear(table), () => sbCacheClear(table));
        return p;
    };
    // F5 / reload = fresh data
    try { const nav = performance.getEntriesByType('navigation')[0]; if (nav && nav.type === 'reload') sbCacheClear(); } catch (e) {}
})();

const _clone = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const _okResp = rows => ({ ok: true, status: 200, json: async () => _clone(rows), text: async () => '' });

// Same behaviour as before (returns a fetch-like Response with ALL rows), but cached + de-duplicated.
async function sbFetchAll(table, query) {
    query = query || 'select=*';
    const key = table + '|' + query;
    const hit = _sbMem.get(key);
    if (hit && Date.now() - hit.t < SB_CACHE_TTL) return _okResp(hit.rows);
    const stored = await _sbIdbGet(key);
    if (stored && Date.now() - stored.t < SB_CACHE_TTL) { _sbMem.set(key, stored); return _okResp(stored.rows); }
    if (_sbInflight.has(key)) { const r = await _sbInflight.get(key); return r.ok ? _okResp(r.rows) : r.resp; }
    const job = (async () => {
        const resp = await _sbFetchAllNet(table, query);
        if (!resp.ok) return { ok: false, resp };
        const rows = await resp.json();
        if (Array.isArray(rows)) { const rec = { t: Date.now(), rows }; _sbMem.set(key, rec); _sbIdbSet(key, rec); }
        return { ok: true, rows };
    })();
    _sbInflight.set(key, job);
    try { const r = await job; return r.ok ? _okResp(r.rows) : r.resp; }
    finally { _sbInflight.delete(key); }
}

// Load the (large) Excel library only when an import is really used
let _xlsxP = null;
function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_xlsxP) return _xlsxP;
    _xlsxP = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = () => res(window.XLSX); s.onerror = () => { _xlsxP = null; rej(new Error('Could not load the Excel library (check internet).')); };
        document.head.appendChild(s);
    });
    return _xlsxP;
}

// Dropdown lists + rules maintained on the System Settings page (with sensible defaults)
const SETTING_DEFAULTS = {
    'Class': ['Playgroup', 'Pre-Nursery', 'Nursery', 'Prep', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'],
    'Section': ['A', 'B', 'C'],
    'Designation': ['Principal', 'Vice Principal', 'Teacher', 'Coordinator', 'Accountant', 'Clerk', 'Computer Operator', 'Driver', 'Guard', 'Peon', 'Aya / Helper'],
    'Income Head': ['Admission / Registration Fee', 'Annual Fund', 'Book Store Sale', 'Uniform / Stationery Sale', 'Transport Fee', 'Donation', 'Other Income'],
    'Expense Head': ['Salaries', 'Utility Bills', 'Rent', 'Stationery', 'Repair & Maintenance', 'Fuel / Transport', 'Events / Functions', 'Books Purchase', 'Printing', 'Internet / Phone', 'Refreshments', 'Misc Expense'],
    'Book Vendor': [],
    'Book Category': ['Books', 'Notebooks', 'Study Planner', 'Lamination Paper']
};
let _settingLists = null;
async function loadSettingLists() {
    if (_settingLists) return _settingLists;
    try { const c = JSON.parse(sessionStorage.getItem('sb_settings_v1') || 'null'); if (c && Date.now() - c.t < 120000) { _settingLists = c.d; return c.d; } } catch (e) {}
    const out = { rules: {} };
    Object.keys(SETTING_DEFAULTS).forEach(k => out[k] = [...SETTING_DEFAULTS[k]]);
    try {
        const rows = await (await sbFetchAll('settings', 'select=setting_key,setting_value')).json();
        if (Array.isArray(rows)) {
            const by = {};
            rows.forEach(x => { const k = String(x.setting_key || '').trim(), v = String(x.setting_value ?? '').trim(); if (k && v !== '') (by[k] = by[k] || []).push(v); });
            Object.keys(SETTING_DEFAULTS).forEach(k => { if (by[k] && by[k].length) out[k] = by[k]; });
            ['Payroll Working Days', 'Payroll Free Leaves', 'Low Stock Limit'].forEach(k => { if (by[k]) out.rules[k] = by[k][0]; });
        }
    } catch (e) { console.error('Settings lists', e); }
    // rules saved on the Settings page also drive the Staff / Book Store pages
    try {
        if (out.rules['Payroll Working Days'] !== undefined) localStorage.setItem('payroll_days', out.rules['Payroll Working Days']);
        if (out.rules['Payroll Free Leaves'] !== undefined) localStorage.setItem('payroll_free', out.rules['Payroll Free Leaves']);
        if (out.rules['Low Stock Limit'] !== undefined) localStorage.setItem('books_low_stock', out.rules['Low Stock Limit']);
    } catch (e) {}
    _settingLists = out;
    try { sessionStorage.setItem('sb_settings_v1', JSON.stringify({ t: Date.now(), d: out })); } catch (e) {}
    return out;
}
