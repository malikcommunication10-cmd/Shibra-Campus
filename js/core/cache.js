const SB_DATA_CACHE_PREFIX = 'sb_data_v1_', SB_DATA_CACHE_TTL = 60000, SB_DATA_CACHE_STALE = 12 * 60 * 60 * 1000;   // fresh for 1 min; instantly usable for 12 h while it refreshes in the background
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
