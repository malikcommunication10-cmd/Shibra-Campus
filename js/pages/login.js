    document.getElementById('copyrightYear').textContent = new Date().getFullYear();
    const $ = id => document.getElementById(id);
    const savedConnection = getSupabaseConfig();
    $('loginConnectionUrl').value = savedConnection.url;
    $('loginConnectionKey').value = savedConnection.key;
    $('connectionSetupForm').classList.toggle('hidden', SB_CONFIG_READY);
    $('loginForm').classList.toggle('hidden', !SB_CONFIG_READY);
    $('changeConnectionButton').classList.toggle('hidden', !SB_CONFIG_READY);
    $('cancelConnectionSetupButton').classList.toggle('hidden', !SB_CONFIG_READY);
    if (!SB_CONFIG_READY) {
        $('connectionSetupHint').textContent = 'No database connection is saved. The app will not use a default project; enter the correct project URL and key to continue.';
        showConnectionSetupMessage('Connection required before sign-in.', false);
    }
    const recoveryParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const isRecoveryLink = recoveryParams.get('type') === 'recovery';
    if (isRecoveryLink && SB_CONFIG_READY) {
        const accessToken = recoveryParams.get('access_token');
        const refreshToken = recoveryParams.get('refresh_token');
        history.replaceState(null, document.title, location.pathname + location.search);
        sbClearAuth();
        if (accessToken) {
            sbSaveSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: Number(recoveryParams.get('expires_in')) || 3600 });
            $('loginForm').classList.add('hidden');
            $('recoveryForm').classList.remove('hidden');
            $('newPassword').focus();
        } else {
            $('err').textContent = 'This reset link is invalid or expired. Request a new link and try again.';
            $('err').classList.remove('hidden');
        }
    }
    function showConnectionSetupMessage(message, isError = false) {
        const el = $('connectionSetupMessage');
        el.textContent = message;
        el.className = `text-xs font-semibold rounded-lg px-3 py-2 ${isError ? 'text-rose-700 bg-rose-50' : 'text-slate-600 bg-slate-50'}`;
        el.classList.remove('hidden');
    }
    function openLoginConnection() {
        $('loginForm').classList.add('hidden');
        $('recoveryForm').classList.add('hidden');
        $('connectionSetupForm').classList.remove('hidden');
        $('connectionSetupTitle').textContent = 'Database connection';
        $('connectionSetupHint').textContent = 'Enter the project URL and publishable/anon key. Saving signs you out and reloads the app.';
        const config = getSupabaseConfig();
        $('loginConnectionUrl').value = config.url;
        $('loginConnectionKey').value = config.key;
        $('connectionSetupMessage').classList.add('hidden');
    }
    function closeLoginConnection() {
        if (!SB_CONFIG_READY) return;
        $('connectionSetupForm').classList.add('hidden');
        $('loginForm').classList.remove('hidden');
    }
    async function testLoginConnection() {
        let config;
        try {
            config = normalizeSupabaseConfig({ url: $('loginConnectionUrl').value, key: $('loginConnectionKey').value });
        } catch (error) {
            showConnectionSetupMessage(error.message, true);
            return;
        }
        const button = $('testLoginConnectionButton');
        button.disabled = true;
        button.textContent = 'Testing...';
        try {
            const response = await fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.key } });
            showConnectionSetupMessage(response.ok
                ? 'Connection accepted. Save it to use this database.'
                : `Connection rejected (HTTP ${response.status}). Check the project URL and publishable key.`,
            !response.ok);
        } catch (error) {
            showConnectionSetupMessage(`Could not reach this project: ${error.message}`, true);
        } finally {
            button.disabled = false;
            button.textContent = 'Test connection';
        }
    }
    function saveLoginConnection(event) {
        event.preventDefault();
        try {
            const config = normalizeSupabaseConfig({ url: $('loginConnectionUrl').value, key: $('loginConnectionKey').value });
            sbCacheClear();
            persistSupabaseConfig(config);
            localStorage.setItem('sb_data_rev_all', `${Date.now()}_${Math.random()}`);
            sbClearAuth();
            location.replace(location.pathname + location.search + location.hash);
        } catch (error) {
            showConnectionSetupMessage(`Could not save the connection: ${error.message}`, true);
        }
    }
    function togglePw() { const p = $('password'), show = p.type === 'password'; p.type = show ? 'text' : 'password'; $('pwBtn').innerText = show ? 'Hide' : 'Show'; }
    function showErr(m) { $('err').innerText = m; $('err').className = 'text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2'; }
    async function sendPasswordReset() {
        if (!SB_CONFIG_READY) { openLoginConnection(); return; }
        const email = $('email').value.trim();
        if (!email) { showErr('Enter your email address first.'); $('email').focus(); return; }
        if (location.protocol === 'file:') { showErr('Open the school app from its HTTPS website before requesting a reset link.'); return; }
        const btn = $('forgotBtn'); btn.disabled = true; btn.innerText = 'Sending reset link...';
        $('err').classList.add('hidden');
        try {
            const redirectTo = `${location.origin}${location.pathname}`;
            const r = await fetch(`${SB_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
                method: 'POST',
                headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                throw new Error(j.msg || j.message || 'Could not send the reset email. Check Supabase email settings and redirect URLs.');
            }
            $('err').textContent = 'If this email belongs to an account, a password reset link has been sent. Check your inbox and spam folder.';
            $('err').className = 'text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2';
        } catch (err) {
            console.error('Password reset request failed:', err);
            showErr(err.message || 'Could not send the reset email. Please try again.');
        } finally {
            btn.disabled = false; btn.innerText = 'Forgot password? Send a reset link to my email';
        }
    }
    async function saveRecoveredPassword(e) {
        e.preventDefault();
        if (!SB_CONFIG_READY) { openLoginConnection(); return; }
        const password = $('newPassword').value;
        if (password.length < 8) return showRecoveryMessage('Use at least 8 characters.', false);
        if (password !== $('confirmPassword').value) return showRecoveryMessage('The passwords do not match.', false);
        const btn = $('recoveryBtn'); btn.disabled = true; btn.innerText = 'Saving password...';
        try {
            const error = await sbChangePassword(password);
            if (error) throw new Error(error);
            sbClearAuth();
            $('recoveryForm').classList.add('hidden');
            $('loginForm').classList.remove('hidden');
            $('password').value = '';
            $('email').value = '';
            $('newPassword').value = '';
            $('confirmPassword').value = '';
            showErr('Password updated. Sign in with your new password.');
            $('email').focus();
        } catch (err) {
            console.error('Password update failed:', err);
            showRecoveryMessage(err.message || 'Could not update the password. The reset link may have expired.', false);
        } finally {
            btn.disabled = false; btn.innerText = 'Save new password';
        }
    }
    function showRecoveryMessage(message, success) {
        const el = $('recoveryMsg');
        el.textContent = message;
        el.className = `text-xs font-semibold rounded-lg px-3 py-2 ${success ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`;
    }
    function cancelRecovery() { sbClearAuth(); location.replace(location.pathname); }
    async function doLogin(e) {
        e.preventDefault();
        if (!SB_CONFIG_READY) { openLoginConnection(); return; }
        $('err').classList.add('hidden');
        const btn = $('loginBtn'); btn.disabled = true; btn.innerText = 'Signing in...';
        try {
            const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.access_token) {
                const detail = [j.message, j.msg, j.error_description, j.error].find(value => typeof value === 'string' && value.trim()) || '';
                const message = detail.trim().slice(0, 200);
                const lower = `${j.code || ''} ${message}`.toLowerCase();
                if (/invalid api key|api key.*invalid|no api key/.test(lower))
                    showErr('Supabase rejected this project key. Check that the URL and publishable key belong to the same project.');
                else if (/invalid login credentials|invalid_credentials|invalid email or password/.test(lower))
                    showErr('The email or password is incorrect for the selected Supabase project.');
                else if (/confirm/.test(lower))
                    showErr('This account is not confirmed yet. Ask the administrator.');
                else
                    showErr(`Sign-in failed (HTTP ${r.status})${message ? `: ${message}` : '. Check the project URL/key and the selected project’s Auth users.'}`);
                console.error('Supabase sign-in rejected:', { status: r.status, code: j.code || '', message });
                btn.disabled = false; btn.innerText = 'Sign in'; return;
            }
            sbSaveSession(j, true);
            const me = await sbFetchMe();
            if (!me || me.error) { sbClearAuth(); showErr('The users table is not set up yet. Run supabase_roles.sql in Supabase, then try again.'); btn.disabled = false; btn.innerText = 'Sign in'; return; }
            if (me.noaccess || me.active === false) { sbClearAuth(); showErr(me.noaccess ? 'Your account has no role yet. Please ask the administrator.' : 'This account is switched off. Please ask the administrator.'); btn.disabled = false; btn.innerText = 'Sign in'; return; }
            sbSaveMe(me);
            location.replace(sbFirstPage(me) || 'index.html');
        } catch (err) { console.error(err); sbClearAuth(); showErr('No connection. Check your internet and try again.'); btn.disabled = false; btn.innerText = 'Sign in'; }
    }
    if (SB_CONFIG_READY && !isRecoveryLink) $('email').focus();
    const logoutReason = sessionStorage.getItem(SB_LOGOUT_REASON_KEY);
    if (logoutReason) {
        sessionStorage.removeItem(SB_LOGOUT_REASON_KEY);
        showErr(logoutReason === 'idle'
            ? 'You were signed out after 5 minutes without activity.'
            : 'You have been signed out.');
    }

// ---- sign-in conveniences: remembered email, Caps Lock warning ----
(function () {
    const KEY = 'shibra_login_email';
    try { const saved = localStorage.getItem(KEY); if (SB_CONFIG_READY && saved && !$('email').value) { $('email').value = saved; $('password').focus(); } } catch (e) {}
    $('loginForm').addEventListener('submit', () => {
        try { if ($('rememberEmail').checked) localStorage.setItem(KEY, $('email').value.trim()); else localStorage.removeItem(KEY); } catch (e) {}
    });
    const caps = e => { if (e.getModifierState) $('capsWarn').classList.toggle('hidden', !e.getModifierState('CapsLock')); };
    ['keydown', 'keyup'].forEach(ev => $('password').addEventListener(ev, caps));
    $('password').addEventListener('blur', () => $('capsWarn').classList.add('hidden'));
})();
