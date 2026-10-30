/* Shared UI helpers: UI.toast / UI.alert / UI.confirm / UI.notify / UI.csv  (replaces native alert/confirm) */
const UI = (() => {
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US');
    let toastTimer;
    function toast(message, ok = true) {
        let t = document.getElementById('uiToast');
        if (!t) { t = document.createElement('div'); t.id = 'uiToast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
        t.className = 'ui-toast ' + (ok ? 'ok' : 'bad'); t.textContent = message; t.hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
    }
    // buttons: [{label, value, kind}] -> resolves with the clicked button's value (Esc / backdrop = null)
    function dialog({ title, message, html, buttons, wide }) {
        return new Promise(resolve => {
            const back = document.createElement('div'); back.className = 'ui-back';
            back.innerHTML = `<div class="ui-modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="ui-modal-head"><h3>${esc(title || '')}</h3><button type="button" class="ui-x" aria-label="Close">×</button></div>
                <div class="ui-modal-body ${html ? 'free' : ''}">${html || esc(message || '')}</div><div class="ui-modal-foot"></div></div>`;
            const foot = back.querySelector('.ui-modal-foot');
            const done = v => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
            const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
            (buttons || [{ label: 'OK', value: true, kind: 'pri' }]).forEach(b => {
                const el = document.createElement('button'); el.type = 'button'; el.className = 'ui-btn ' + (b.kind || ''); el.textContent = b.label;
                el.addEventListener('click', () => done(b.value)); foot.appendChild(el);
            });
            back.querySelector('.ui-x').addEventListener('click', () => done(null));
            back.addEventListener('mousedown', e => { if (e.target === back) done(null); });
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(back);
            const last = foot.querySelector('.ui-btn.pri, .ui-btn.danger') || foot.lastElementChild; if (last) last.focus();
        });
    }
    const alert = (message, title = 'Please note') => dialog({ title, message });
    const confirm = (message, o = {}) => {
        const m = String(message || ''), del = /\bdelete\b/i.test(m), rem = /\bremove\b/i.test(m);
        const danger = o.danger !== undefined ? o.danger : (del || rem);
        return dialog({ title: o.title || 'Please confirm', message: m, buttons: [{ label: o.cancel || 'Cancel', value: false },
            { label: o.ok || (del ? 'Yes, delete' : rem ? 'Yes, remove' : 'Yes, continue'), value: true, kind: danger ? 'danger' : 'pri' }] }).then(v => v === true);
    };
    function prompt(message, { title = 'Enter a value', value = '', ok = 'Save', placeholder = '' } = {}) {
        const p = dialog({ title, html: `<p style="margin:0 0 10px;white-space:pre-line">${esc(message)}</p><input id="uiPromptInput" class="ui-input" style="width:100%" value="${esc(value)}" placeholder="${esc(placeholder)}">`,
            buttons: [{ label: 'Cancel', value: null }, { label: ok, value: 'ok', kind: 'pri' }] });
        const input = document.getElementById('uiPromptInput');
        if (input) { input.focus(); input.select(); input.addEventListener('keydown', e => { if (e.key === 'Enter') input.closest('.ui-modal').querySelector('.ui-btn.pri').click(); }); }
        return p.then(v => (v === 'ok' && input ? input.value : null));
    }
    // success-looking messages become a toast, anything that needs reading becomes a dialog
    function notify(message) {
        const m = String(message || '');
        if (/could not|cannot|can't|failed|error|note:|\bbut\b|not be|required|already|exists|must|invalid|no column|permission/i.test(m)) return alert(m, 'Please note');
        toast(m.split('\n')[0]); return Promise.resolve();
    }
    function csv(name, head, rows) {
        const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const text = '\uFEFF' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
        a.download = `${name}-${new Date().toLocaleDateString('en-CA')}.csv`; document.body.appendChild(a); a.click(); a.remove();
    }
    function words(n) {                       // Pakistani numbering (Lakh / Crore) for receipts and vouchers
        n = Math.floor(Math.abs(Number(n) || 0)); if (n === 0) return 'Zero';
        const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
        const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
        const two = x => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
        const three = x => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
        const out = []; const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
        if (cr) out.push(three(cr) + ' Crore'); if (lk) out.push(two(lk) + ' Lakh'); if (th) out.push(two(th) + ' Thousand'); if (n) out.push(three(n));
        return out.join(' ');
    }
    function debounce(fn, ms = 180) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
    // Search boxes that re-render a big table on every key press are delayed slightly, so typing stays smooth
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('input[oninput]').forEach(el => {
            const type = (el.getAttribute('type') || 'text').toLowerCase(), code = el.getAttribute('oninput');
            if (!['text', 'search'].includes(type) || !/render|filter|search|reset/i.test(code)) return;
            el.removeAttribute('oninput');
            const run = debounce(() => { try { new Function(code).call(el); } catch (e) { console.error(e); } });
            el.addEventListener('input', run);
        });
    });
    return { esc, fmt, toast, dialog, alert, confirm, prompt, notify, csv, words, debounce };
})();
