// ============================================================================
//  Shared defaults + helpers for every page (Admins can override the project in Users & Roles)
// ============================================================================
const SB_DEFAULT_URL = "https://tsnfwebctvjnmmweepiu.supabase.co";
const SB_DEFAULT_KEY = "sb_publishable_mQcfSTQd8nca5xzbT1q6dw_aRvOHIYh";
const SB_CONFIG_STORAGE_KEY = 'shibra_supabase_config_v1';
function readSupabaseConfig() {
    try {
        const saved = JSON.parse(localStorage.getItem(SB_CONFIG_STORAGE_KEY) || 'null');
        if (saved && /^https:\/\/.+/.test(String(saved.url || '')) && String(saved.key || '').trim())
            return { url: String(saved.url).replace(/\/+$/, ''), key: String(saved.key).trim() };
    } catch (error) {
        console.warn('Could not read the saved Supabase connection settings:', error);
    }
    return { url: SB_DEFAULT_URL, key: SB_DEFAULT_KEY };
}
const _initialSupabaseConfig = readSupabaseConfig();
let SB_URL = _initialSupabaseConfig.url;
let SB_KEY = _initialSupabaseConfig.key;
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
const SB_IDLE_TIMEOUT = 60 * 60 * 1000;
