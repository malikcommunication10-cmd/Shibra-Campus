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

