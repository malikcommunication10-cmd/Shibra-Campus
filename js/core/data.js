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

// Keep data in this browser tab's cache until refresh, a write, or sign-out.
function sbFetchAllNetwork(table, query, key, revision, background) {
    const existing = _sbDataPending.get(key);
    if (existing && existing.revision === revision) return existing.promise;
    const request = (async () => {
        const response = await sbFetchAllUncached(table, query);
        if (!response.ok) return response;
        const rows = await response.json();
        if (!Array.isArray(rows)) return { ok: false, status: response.status, json: async () => rows, text: async () => '' };
        if (sbDataRevision(table) !== revision) return { ok: true, status: response.status, json: async () => rows, text: async () => '' };
        const value = JSON.stringify(rows), expires = SB_DATA_CACHE_EXPIRY, staleUntil = SB_DATA_CACHE_EXPIRY;
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
function sbCachedProjection(table, query, revision) {
    const parse = value => {
        const params = new URLSearchParams(value);
        const select = params.get('select') || '*';
        params.delete('select');
        const signature = JSON.stringify([...params.entries()].sort((a, b) =>
            a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])));
        const fields = select === '*' ? null : select.split(',').map(field => field.trim());
        if (fields && fields.some(field => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))) return null;
        return { signature, fields };
    };
    const target = parse(query);
    if (!target) return null;
    const prefix = `${sbDataCacheScope()}${table}_`;
    const candidates = new Map();
    for (const [key, entry] of _sbDataMemory) {
        if (key.startsWith(prefix) && entry.revision === revision)
            candidates.set(key, entry);
    }
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (!key || !key.startsWith(prefix) || candidates.has(key)) continue;
            const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
            if (saved && saved.revision === revision && Array.isArray(saved.rows)) {
                candidates.set(key, {
                    revision,
                    expires: Number(saved.expires) || 0,
                    staleUntil: Number(saved.staleUntil || saved.expires) || 0,
                    packed: JSON.stringify(saved.rows)
                });
            }
        }
    } catch (error) {
        console.warn(`Could not inspect cached ${table} projections:`, error);
    }

    let best = null;
    for (const [key, entry] of candidates) {
        if (key === sbDataCacheKey(table, query)) continue;
        let sourceQuery;
        try { sourceQuery = decodeURIComponent(key.slice(prefix.length)); }
        catch (error) { continue; }
        const source = parse(sourceQuery);
        if (!source || source.signature !== target.signature) continue;
        if (source.fields && (!target.fields || target.fields.some(field => !source.fields.includes(field)))) continue;
        const width = source.fields ? source.fields.length : Infinity;
        if (!best || width < best.width || (width === best.width && entry.expires > best.entry.expires))
            best = { entry, width };
    }
    if (!best) return null;

    const sourceRows = JSON.parse(best.entry.packed);
    const rows = target.fields
        ? sourceRows.map(row => Object.fromEntries(target.fields.map(field => [field, row[field]])))
        : sourceRows;
    return {
        rows,
        entry: { ...best.entry, packed: JSON.stringify(rows) }
    };
}
async function sbFetchAllFromCache(table, query, key, revision) {
    let cached = _sbDataMemory.get(key);
    if (!cached || cached.revision !== revision) {
        cached = null;
        try {
            const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
            if (saved && saved.revision === revision && Array.isArray(saved.rows)) {
                cached = { revision, expires: SB_DATA_CACHE_EXPIRY, staleUntil: SB_DATA_CACHE_EXPIRY, packed: JSON.stringify(saved.rows) };
                _sbDataMemory.set(key, cached);
            }
        } catch (e) {}
        if (!cached) {
            try {
                const saved = await sbReadPersistentData(key);
                if (saved && saved.revision === revision && Array.isArray(saved.rows)) {
                    cached = { revision, expires: SB_DATA_CACHE_EXPIRY, staleUntil: SB_DATA_CACHE_EXPIRY, packed: JSON.stringify(saved.rows) };
                    _sbDataMemory.set(key, cached);
                }
            } catch (error) {
                console.warn(`Could not read persistent ${table} cache:`, error);
            }
        }
        if (!cached) {
            const projection = sbCachedProjection(table, query, revision);
            if (projection) {
                cached = projection.entry;
                _sbDataMemory.set(key, cached);
                sbWritePersistentData({ key, revision, ...cached, rows: projection.rows })
                    .catch(error => console.warn(`Could not persist cached ${table} projection:`, error));
                try {
                    if (cached.packed.length < 1800000)
                        sessionStorage.setItem(key, JSON.stringify({ ...cached, rows: projection.rows }));
                } catch (error) {}
            }
        }
    }
    if (cached) {
        const rows = JSON.parse(cached.packed);
        return { ok: true, status: 200, json: async () => rows, text: async () => cached.packed };
    }
    return sbFetchAllNetwork(table, query, key, revision);
}
function sbFetchAll(table, query) {
    query = query || 'select=*';
    const key = sbDataCacheKey(table, query), revision = sbDataRevision(table);
    const existing = _sbDataLookupPending.get(key);
    if (existing && existing.revision === revision) return existing.promise;
    let tracked;
    tracked = sbFetchAllFromCache(table, query, key, revision).finally(() => {
        const pending = _sbDataLookupPending.get(key);
        if (pending && pending.promise === tracked) _sbDataLookupPending.delete(key);
    });
    _sbDataLookupPending.set(key, { revision, promise: tracked });
    return tracked;
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
