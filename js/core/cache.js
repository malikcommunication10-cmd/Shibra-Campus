const SB_DATA_CACHE_PREFIX = 'sb_data_v1_', SB_DATA_CACHE_EXPIRY = Number.MAX_SAFE_INTEGER;
const SB_DATA_DB_NAME = 'shibra_data_cache_v1', SB_DATA_DB_STORE = 'responses';
const _sbDataMemory = new Map(), _sbDataPending = new Map(), _sbDataLookupPending = new Map();
let _sbDataDbPromise = null, _sbDataTabId = '';
let _sbLoadingTimer = 0;
function sbShowLoadingIndicator(text) {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;
    const label = document.getElementById('loadingText');
    if (label) label.textContent = text || 'Loading...';
    clearTimeout(_sbLoadingTimer);
    _sbLoadingTimer = setTimeout(() => {
        overlay.classList.add('flex');
        overlay.classList.remove('hidden');
    }, 250);
}
function sbHideLoadingIndicator() {
    clearTimeout(_sbLoadingTimer);
    _sbLoadingTimer = 0;
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.add('hidden');
}
function sbSession() { try { return JSON.parse(localStorage.getItem(SB_SESSION_KEY) || 'null'); } catch (e) { return null; } }
function sbDataCacheUser() { return `${encodeURIComponent(SB_URL.toLowerCase())}_${encodeURIComponent(String((sbSession() || {}).email || 'anonymous').toLowerCase())}`; }
function sbDataCacheTab() {
    if (_sbDataTabId) return _sbDataTabId;
    try {
        _sbDataTabId = sessionStorage.getItem('sb_data_tab_v1') || '';
        if (!_sbDataTabId) {
            _sbDataTabId = window.crypto && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            sessionStorage.setItem('sb_data_tab_v1', _sbDataTabId);
        }
    } catch (error) {
        _sbDataTabId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    return _sbDataTabId;
}
function sbDataCacheScope() { return `${SB_DATA_CACHE_PREFIX}${sbDataCacheUser()}_${sbDataCacheTab()}__`; }
function sbDataCacheKey(table, query) {
    return `${sbDataCacheScope()}${table}_${encodeURIComponent(query)}`;
}
function sbDataCacheMatches(key, userPrefix, tableName) {
    if (!key.startsWith(userPrefix)) return false;
    if (!tableName) return true;
    const suffix = key.slice(userPrefix.length), scopeEnd = suffix.indexOf('__');
    const tableQuery = scopeEnd >= 0 ? suffix.slice(scopeEnd + 2) : suffix;
    return tableQuery.startsWith(`${tableName}_`);
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
            if (sbDataCacheMatches(key, userPrefix, tableName))
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
        if (sbDataCacheMatches(key, userPrefix, tableName)) _sbDataMemory.delete(key);
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(SB_DATA_CACHE_PREFIX)
                && sbDataCacheMatches(key, userPrefix, tableName))
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
function sbResetTabDataCacheOnReload() {
    if (window.SB_NO_GUARD || !sbSession()) return;
    let isReload = false;
    try {
        const navigation = performance.getEntriesByType('navigation');
        isReload = navigation.length
            ? navigation[0].type === 'reload'
            : !!(performance.navigation && performance.navigation.type === 1);
    } catch (error) {}
    if (!isReload) return;

    const userPrefix = `${SB_DATA_CACHE_PREFIX}${sbDataCacheUser()}_`;
    const oldScope = sbDataCacheScope();
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(userPrefix)) sessionStorage.removeItem(key);
        }
        sessionStorage.removeItem('sb_data_tab_v1');
        sessionStorage.removeItem(`sb_data_preload_v1_${sbDataCacheUser()}`);
        sessionStorage.removeItem('sb_settings_v2');
        sessionStorage.removeItem('sb_settings_v3');
    } catch (error) {}
    _sbDataTabId = '';
    sbDeletePersistentData(oldScope).catch(error => console.warn('Could not clear the previous tab data cache:', error));
}
sbResetTabDataCacheOnReload();
