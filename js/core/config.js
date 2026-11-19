// ============================================================================
//  Shared connection helpers. Use the configured default when no browser override is saved.
// ============================================================================
const SB_CONFIG_STORAGE_KEY = 'shibra_supabase_config_v1';
const DEFAULT_SUPABASE_CONFIG = Object.freeze({
    url: 'https://lhhwvlaexuxnlyqyvner.supabase.co',
    key: 'sb_publishable_-1P9Wh6P5_LNWAy_xcoigQ_ogY6XAK1'
});
function normalizeSupabaseConfig(config) {
    const url = String(config && config.url || '').trim().replace(/\/+$/, '');
    const key = String(config && config.key || '').trim();
    let parsed;
    try {
        parsed = new URL(url);
    } catch (error) {
        throw new Error('Enter a valid Supabase project URL.');
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.pathname !== '/' || parsed.search || parsed.hash)
        throw new Error('Enter the HTTPS Supabase project URL without a path.');
    if (!key) throw new Error('Enter the Supabase publishable/anon key.');
    return { url: parsed.origin, key };
}
function readSupabaseConfig() {
    try {
        const saved = JSON.parse(localStorage.getItem(SB_CONFIG_STORAGE_KEY) || 'null');
        return saved ? normalizeSupabaseConfig(saved) : null;
    } catch (error) {
        console.warn('Could not read the saved Supabase connection settings:', error);
        return null;
    }
}
const _initialSupabaseConfig = readSupabaseConfig() || DEFAULT_SUPABASE_CONFIG;
let SB_URL = _initialSupabaseConfig ? _initialSupabaseConfig.url : '';
let SB_KEY = _initialSupabaseConfig ? _initialSupabaseConfig.key : '';
let SB_CONFIG_READY = !!_initialSupabaseConfig;
function getSupabaseConfig() { return { url: SB_URL, key: SB_KEY }; }
function isSupabaseConfigCurrent() {
    if (!SB_CONFIG_READY) return false;
    try {
        const saved = JSON.parse(localStorage.getItem(SB_CONFIG_STORAGE_KEY) || 'null');
        if (!saved) return SB_URL === DEFAULT_SUPABASE_CONFIG.url && SB_KEY === DEFAULT_SUPABASE_CONFIG.key;
        const normalized = normalizeSupabaseConfig(saved);
        return normalized.url === SB_URL && normalized.key === SB_KEY;
    } catch (error) {
        return false;
    }
}
function persistSupabaseConfig(config) {
    const normalized = normalizeSupabaseConfig(config);
    localStorage.setItem(SB_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    SB_URL = normalized.url;
    SB_KEY = normalized.key;
    SB_CONFIG_READY = true;
    return normalized;
}
function clearSupabaseConfig() {
    localStorage.removeItem(SB_CONFIG_STORAGE_KEY);
    SB_URL = DEFAULT_SUPABASE_CONFIG.url;
    SB_KEY = DEFAULT_SUPABASE_CONFIG.key;
    SB_CONFIG_READY = true;
}
window.addEventListener('storage', event => {
    if (event.key !== SB_CONFIG_STORAGE_KEY) return;
    if (typeof sbClearAuth === 'function') sbClearAuth();
    location.replace('login.html');
});
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
const SB_IDLE_TIMEOUT = 60 * 60 * 1000;
