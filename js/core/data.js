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
