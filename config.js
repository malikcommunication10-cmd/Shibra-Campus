// ============================================================================
//  Shared settings + helpers for every page (change the Supabase project HERE only)
// ============================================================================
const SB_URL = "https://tsnfwebctvjnmmweepiu.supabase.co";
const SB_KEY = "sb_publishable_mQcfSTQd8nca5xzbT1q6dw_aRvOHIYh";
function getSupabaseConfig() { return { url: SB_URL, key: SB_KEY }; }

// Supabase returns max 1000 rows per request: this loads every page of a table.
// Returns an object that behaves like a fetch Response ({ok, status, json()}).
async function sbFetchAll(table, query) {
    query = query || 'select=*';
    const c = getSupabaseConfig();
    let useOrder = !/(^|&)order=/.test(query), rows = [], from = 0;
    const get = (f, ord) => fetch(`${c.url}/rest/v1/${table}?${query}${ord ? '&order=id.asc' : ''}`,
        { headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, Range: `${f}-${f + 999}`, 'Range-Unit': 'items' } });
    for (;;) {
        let r = await get(from, useOrder);
        if (!r.ok && useOrder && from === 0) { useOrder = false; r = await get(from, false); }
        if (r.status === 416 && from > 0) break;
        if (!r.ok) return { ok: false, status: r.status, json: async () => r.json().catch(() => ({})), text: async () => r.text().catch(() => '') };
        const a = await r.json();
        if (!Array.isArray(a)) return { ok: false, status: 200, json: async () => a, text: async () => '' };
        if (!a.length) break;
        rows = rows.concat(a); from += a.length;
    }
    return { ok: true, status: 200, json: async () => rows, text: async () => '' };
}

// Dropdown lists + rules maintained on the System Settings page (with sensible defaults)
const SETTING_DEFAULTS = {
    'Class': ['Playgroup', 'Pre-Nursery', 'Nursery', 'Prep', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'],
    'Section': ['A', 'B', 'C'],
    'Designation': ['Principal', 'Vice Principal', 'Teacher', 'Coordinator', 'Accountant', 'Clerk', 'Computer Operator', 'Driver', 'Guard', 'Peon', 'Aya / Helper'],
    'Income Head': ['Admission / Registration Fee', 'Annual Fund', 'Book Store Sale', 'Uniform / Stationery Sale', 'Transport Fee', 'Donation', 'Other Income'],
    'Expense Head': ['Salaries', 'Utility Bills', 'Rent', 'Stationery', 'Repair & Maintenance', 'Fuel / Transport', 'Events / Functions', 'Books Purchase', 'Printing', 'Internet / Phone', 'Refreshments', 'Misc Expense'],
    'Book Vendor': []
};
let _settingLists = null;
async function loadSettingLists() {
    if (_settingLists) return _settingLists;
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
    return out;
}
