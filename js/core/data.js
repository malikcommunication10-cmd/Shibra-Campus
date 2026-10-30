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
        const previous = _sbDataMemory.get(key), changed = !previous || previous.packed !== value;
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
        if (background && changed) window.dispatchEvent(new CustomEvent('sb:data-cache-updated', { detail: { table, query } }));   // only when the data really changed
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
async function sbFetchAllDirect(table, query) {
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

// ====================================================================================
// SHARED TABLE CACHE – every page used to download the same big table in a different shape.
// A "column subset" query (select=a,b,c) is now served from ONE cached copy of the table, so the
// first page pays the download and every other page opens from memory.
// If the full copy cannot be read (e.g. permissions), the original query is used instead.
// ====================================================================================
const SB_SHARED_TABLES = new Set(['students', 'fees', 'accounts', 'books', 'staff', 'payroll', 'staff_salary_increments', 'staff_security_ledger', 'increments', 'settings']);
const SB_CANON_QUERY = { accounts: 'select=*&order=date.asc,voucher_id.asc' };
const _sbCanonFailed = new Set();
const SB_PERF = (() => { try { return /[?&]perf\b/.test(location.search) || localStorage.getItem('sb_debug_perf') === '1'; } catch (e) { return false; } })();
function sbShareable(table, query) {
    if (!SB_SHARED_TABLES.has(table) || _sbCanonFailed.has(table)) return null;
    const m = String(query || 'select=*').match(/^select=([A-Za-z0-9_,*]+)(&voucher_id=like\.V-\*)?$/);
    if (!m || (m[2] && table !== 'accounts')) return null;
    const canon = SB_CANON_QUERY[table] || 'select=*';
    if (query === canon) return null;
    return { canon, cols: m[1] === '*' ? null : m[1].split(','), vOnly: !!m[2] };
}
async function sbFetchAll(table, query) {
    query = query || 'select=*';
    const t0 = performance.now(), share = sbShareable(table, query);
    let result = null, via = 'direct';
    if (share) {
        const full = await sbFetchAllDirect(table, share.canon);
        if (full.ok) {
            const all = await full.json();
            if (Array.isArray(all)) {
                let rows = all;
                if (share.vOnly) rows = rows.filter(r => String(r.voucher_id || '').startsWith('V-'));
                if (share.cols) rows = rows.map(r => { const o = {}; for (const c of share.cols) if (c in r) o[c] = r[c]; return o; });
                result = { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) };
                via = 'shared';
            }
        } else if (full.status === 401 || full.status === 403 || full.status === 400) _sbCanonFailed.add(table);
    }
    if (!result) result = await sbFetchAllDirect(table, query);
    if (SB_PERF) console.log(`[perf] ${table} ${query.slice(0, 60)} → ${via}, ${Math.round(performance.now() - t0)} ms`);
    return result;
}

// Schema probes ("does this column exist?") only need to succeed once a day, not on every page load
function sbProbe(url) {
    const key = 'sb_probe_' + String(url).replace(/^.*\/rest\/v1\//, '');
    try { if (Date.now() - Number(localStorage.getItem(key) || 0) < 24 * 60 * 60 * 1000) return Promise.resolve({ ok: true, status: 200 }); } catch (e) {}
    return fetch(url, { headers: sbHeaders() }).then(r => { if (r.ok) { try { localStorage.setItem(key, String(Date.now())); } catch (e) {} } return r; });
}

// Server functions that assemble big result sets (e.g. the Follow-up list) are cached the same way as tables:
// shown instantly from the saved copy, refreshed in the background, invalidated when the tables they read change.
async function sbRpcCached(name, tables) {
    const url = `${getSupabaseConfig().url}/rest/v1/rpc/${name}`, now = Date.now();
    const revision = (tables || []).map(sbDataRevision).join('~'), key = `${SB_DATA_CACHE_PREFIX}${sbDataCacheUser()}_rpc_${name}`;
    const wrap = text => ({ ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text });
    const network = async background => {
        const r = await fetch(url, { headers: sbHeaders() });
        if (!r.ok) return r;
        const text = await r.text(), prev = _sbDataMemory.get(key);
        const entry = { revision, expires: Date.now() + SB_DATA_CACHE_TTL, staleUntil: Date.now() + SB_DATA_CACHE_STALE, packed: text };
        _sbDataMemory.set(key, entry);
        sbWritePersistentData(Object.assign({ key }, entry)).catch(() => {});
        if (background && (!prev || prev.packed !== text)) window.dispatchEvent(new CustomEvent('sb:data-cache-updated', { detail: { table: 'rpc:' + name } }));
        return wrap(text);
    };
    let cached = _sbDataMemory.get(key);
    if (!cached || cached.revision !== revision) {
        cached = null;
        try { const saved = await sbReadPersistentData(key); if (saved && saved.revision === revision && saved.staleUntil > now && typeof saved.packed === 'string') { cached = saved; _sbDataMemory.set(key, saved); } } catch (e) {}
    }
    if (cached && cached.staleUntil > now) {
        if (cached.expires <= now) network(true).catch(() => {});
        return wrap(cached.packed);
    }
    return network(false);
}

// When fresh data arrives in the background and it is different, redraw the page quietly
// (no loading wheel). It waits while a form/dialog is open, rows are ticked, or the user is typing.
let _sbSilentTimer = 0, _sbSilentTries = 0;
function sbSilentRefresh() {
    const code = (document.body && document.body.getAttribute('onload')) || '';
    if (!code || /^\s*initDashboard/.test(code) || document.visibilityState === 'hidden') return;
    const modalOpen = [...document.querySelectorAll('.fixed.inset-0, .ui-back, .modal, [role="dialog"]')]
        .some(el => el.id !== 'loadingOverlay' && el.id !== 'appBackdrop' && el.id !== 'toast' && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
    const ticked = document.querySelector('tbody input[type="checkbox"]:checked');
    const ae = document.activeElement, typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.closest('form, [id$="Modal"]');
    if (modalOpen || ticked || typing) { if (_sbSilentTries++ < 8) _sbSilentTimer = setTimeout(sbSilentRefresh, 5000); return; }
    _sbSilentTries = 0;
    const realShow = window.showLoading; window.showLoading = () => {};
    let run; try { run = new Function('return (' + code.replace(/;\s*$/, '') + ')')(); } catch (e) { window.showLoading = realShow; return; }
    Promise.resolve(run).catch(() => {}).finally(() => { window.showLoading = realShow; });
}
window.addEventListener('sb:data-cache-updated', () => {
    if (!document.body || !document.body.getAttribute('onload')) return;
    clearTimeout(_sbSilentTimer); _sbSilentTimer = setTimeout(sbSilentRefresh, 700);
});

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
