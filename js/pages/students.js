        let allStudentsCache = [];

        function showLoading(text = "Processing...") {
            document.getElementById('loadingText').innerText = text;
            document.getElementById('loadingOverlay').classList.remove('hidden');
        }
        function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }



        async function initPage() {
            showLoading("Loading Students Record...");
            try {
                const [year, lists] = await Promise.all([getSchoolYear(), loadSettingLists(), fetchStudents()]);
                SCHOOL_YEAR = year;
                document.getElementById('classList').innerHTML = lists['Class'].map(x => `<option value="${esc(x)}">`).join('');
                document.getElementById('tuitionYearLabel').innerText = SCHOOL_YEAR;
                const add = document.getElementById('addStudentBtn'); if(add && typeof can === 'function' && ME && ME.perms) add.hidden = !can('students', 'a');
            } finally {
                hideLoading();
            }
            loadFeePosition();          // fills the "Fee position" column after the list is already on screen
        }

        function calculatePayables() {
            let mFee = parseFloat(document.getElementById('monthly_tution_fee').value) || 0;
            let mDisc = parseFloat(document.getElementById('monthly_tution_disc').value) || 0;
            document.getElementById('monthly_tution_pay').value = Math.max(0, mFee - mDisc);

            let rFee = parseFloat(document.getElementById('regritation_fee').value) || 0;
            let rDisc = parseFloat(document.getElementById('regritation_disc').value) || 0;
            document.getElementById('regritation_pay').value = Math.max(0, rFee - rDisc);

            let aFee = parseFloat(document.getElementById('admission_fee').value) || 0;
            let aDisc = parseFloat(document.getElementById('admission_disc').value) || 0;
            document.getElementById('admission_pay').value = Math.max(0, aFee - aDisc);

            let annFee = parseFloat(document.getElementById('annual_fund').value) || 0;
            let annDisc = parseFloat(document.getElementById('annual_fund_disc').value) || 0;
            document.getElementById('annual_fund_pay').value = Math.max(0, annFee - annDisc);
            if(typeof refreshVouch === 'function') refreshVouch();
        }

        // ====================================================================================
        // DIRECTORY: load, KPIs, filters, table, profile, export
        // ====================================================================================
        let FEE_BY_ADM = new Map(), FEES_OK = false, ISSUES_ONLY = false, SHOWN = 300, VIEW = [];
        const r2 = n => Math.round((Number(n) || 0) * 100) / 100, money = n => UI.fmt(n);
        const admKey = a => String(a ?? '').trim().toLowerCase();
        const todayIso = () => (typeof todayYmd === 'function' ? todayYmd() : new Date().toLocaleDateString('en-CA'));
        const isActive = row => { const s = String(row.status || 'Active').trim().toLowerCase(); return s === 'active' || s === ''; };
        const tuitionOf = row => feeOf(row, ['monthly_tution_pay', 'monthly_tution_fee']);
        const otherOf = row => feeOf(row, ['regritation_fee', 'registration_fee', 'reg_fee']) + feeOf(row, ['admission_fee']) + feeOf(row, ['annual_fund']);
        const phone = v => String(v || '').trim();
        const telLink = v => phone(v) ? `<a href="tel:${esc(phone(v).replace(/[^\d+]/g, ''))}" class="ui-link" style="font-weight:600">${esc(phone(v))}</a>` : '';

        function issuesOf(row) {
            const out = [];
            if(!isActive(row)) return out;
            if(!phone(row.contact_no_father) && !phone(row.contact_no_mother)) out.push('No phone number');
            if(!row.doj) out.push('No joining date');
            if(!tuitionOf(row)) out.push('No monthly fee');
            if(!String(row.class || '').trim()) out.push('No class');
            if(dupAdm.has(admKey(row.admis_no))) out.push('Duplicate admission no');
            return out;
        }
        let dupAdm = new Set();

        async function fetchStudents() {
            const tbody = document.getElementById('studentTableBody');
            tbody.innerHTML = `<tr><td colspan="9" class="ui-empty">Loading records…</td></tr>`;
            try {
                const response = await ERP.db.request('students', 'select=*');
                const data = await response.json();
                if(!response.ok || !Array.isArray(data)) throw new Error('bad response');
                allStudentsCache = data;
                const seen = new Map(); data.forEach(r => { const k = admKey(r.admis_no); if(k) seen.set(k, (seen.get(k) || 0) + 1); });
                dupAdm = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
                populateClassDropdown(data);
                filterStudents();
            } catch (error) {
                console.error("Error:", error);
                allStudentsCache = [];
                tbody.innerHTML = `<tr><td colspan="9" class="ui-empty" style="color:var(--bad)">Could not load the student list. Check your internet connection and press Refresh.</td></tr>`;
            }
        }

        async function loadFeePosition() {
            FEES_OK = false; FEE_BY_ADM = new Map();
            try {
                if(typeof can === 'function' && ME && ME.perms && !(can('fees', 'v') && can('accounts', 'v'))) throw new Error('no access');
                const [fees, acc] = await Promise.all([
                    ERP.db.fetchAll('fees', 'select=voucher_id,admis_no,student_name,class,period,type,payable,discount'),
                    ERP.db.fetchAll('accounts', 'select=voucher_id,amount_in&voucher_id=like.V-*')
                ]);
                const t = todayIso();
                buildFeeVouchers(fees, acc, SCHOOL_YEAR).forEach(v => {
                    const k = admKey(v.adm); if(!k) return;
                    const s = FEE_BY_ADM.get(k) || { vouchers: [], due: 0, adv: 0, months: 0, oldest: '' };
                    s.vouchers.push(v);
                    if(v.due && v.due <= t) {
                        const bal = r2(v.net - v.paid);
                        if(bal > 0.5) { s.due += bal; s.months++; if(!s.oldest || v.due < s.oldest) s.oldest = v.due; } else if(bal < -0.5) s.adv += -bal;
                    } else s.adv += v.paid;
                    FEE_BY_ADM.set(k, s);
                });
                FEES_OK = true;
            } catch (e) { console.warn('Fee position not available:', e.message || e); }
            renderKpis(); filterStudents();
        }

        function populateClassDropdown(data) {
            const sel = document.getElementById('classFilter'), cur = sel.value;
            const set = new Set(); data.forEach(row => { if(row.class) set.add(String(row.class).trim()); });
            sel.innerHTML = '<option value="ALL">All classes</option>' + [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
            if(set.has(cur)) sel.value = cur;
        }

        function renderKpis() {
            const active = allStudentsCache.filter(isActive), left = allStudentsCache.length - active.length;
            const monthly = active.reduce((s, r) => s + tuitionOf(r), 0);
            const issues = allStudentsCache.filter(r => issuesOf(r).length).length;
            let due = 0, owing = 0; if(FEES_OK) active.forEach(r => { const s = FEE_BY_ADM.get(admKey(r.admis_no)); if(s && s.due > 0.5) { due += s.due; owing++; } });
            const k = (label, value, note, cls, extra = '') => `<${extra ? 'button type="button"' : 'div'} class="ui-kpi ${cls}" ${extra}><small>${label}</small><b>${value}</b><i>${note}</i></${extra ? 'button' : 'div'}>`;
            document.getElementById('stuKpis').innerHTML =
                k('Active students', money(active.length), `${money(new Set(active.map(r => String(r.class || '').trim()).filter(Boolean)).size)} classes`, 'good')
                + k('Left students', money(left), 'Kept for fee history', '')
                + k('Monthly tuition', 'PKR ' + money(monthly), 'All active students, after discount', '')
                + k('Fees due now', FEES_OK ? 'PKR ' + money(due) : '—', FEES_OK ? `${money(owing)} student${owing === 1 ? '' : 's'} owe fees` : 'Fee data not available for your role', FEES_OK && due > 0 ? 'bad' : 'good')
                + k('Needs attention', money(issues), issues ? 'Click to review missing details' : 'All records complete', issues ? 'warn' : 'good', issues ? 'onclick="toggleIssues()"' : '');
        }
        function toggleIssues() { ISSUES_ONLY = !ISSUES_ONLY; if(ISSUES_ONLY) document.getElementById('statusFilter').value = 'ACTIVE'; filterStudents(); }

        function filterStudents() {
            const cls = document.getElementById('classFilter').value, stf = document.getElementById('statusFilter').value, sort = document.getElementById('sortBy').value;
            const toks = (document.getElementById('studentSearch').value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
            const t = allStudentsCache.filter(row => {
                if(cls !== 'ALL' && String(row.class || '').trim() !== cls) return false;
                if(stf === 'ACTIVE' && !isActive(row)) return false;
                if(stf === 'LEFT' && isActive(row)) return false;
                if(ISSUES_ONLY && !issuesOf(row).length) return false;
                if(toks.length) { const hay = [row.student_name, row.admis_no, row.class, row.contact_no_father, row.contact_no_mother, row.siblings, row.sr_no].map(x => String(x ?? '').toLowerCase()).join(' | '); if(!toks.every(k => hay.includes(k))) return false; }
                return true;
            });
            const dueOf = r => (FEE_BY_ADM.get(admKey(r.admis_no)) || { due: 0 }).due;
            const cmp = {
                sr: (a, b) => (parseFloat(a.sr_no) || 0) - (parseFloat(b.sr_no) || 0),
                name: (a, b) => String(a.student_name || '').localeCompare(String(b.student_name || '')),
                class: (a, b) => String(a.class || '').localeCompare(String(b.class || ''), undefined, { numeric: true }) || String(a.student_name || '').localeCompare(String(b.student_name || '')),
                doj: (a, b) => String(b.doj || '').localeCompare(String(a.doj || '')),
                due: (a, b) => dueOf(b) - dueOf(a)
            }[sort] || (() => 0);
            t.sort(cmp); VIEW = t; SHOWN = 300;
            const note = document.getElementById('stuFilterNote');
            note.innerHTML = ISSUES_ONLY ? `Showing only records with missing details. <button type="button" class="ui-link" style="color:var(--action)" onclick="toggleIssues()">Show all</button>` : '';
            renderTable(t);
        }

        function feeOf(row, names) { for(const n of names) { const v = parseFloat(row[n]); if(!isNaN(v)) return v; } return 0; }
        function feeBadge(adm) {
            if(!FEES_OK) return '<span class="ui-muted">—</span>';
            const s = FEE_BY_ADM.get(admKey(adm));
            if(!s) return '<span class="ui-badge mute">No vouchers</span>';
            if(s.due > 0.5) return `<span class="ui-badge bad">PKR ${money(s.due)} due</span><div class="ui-muted">${s.months} month${s.months === 1 ? '' : 's'} unpaid</div>`;
            if(s.adv > 0.5) return `<span class="ui-badge info">Advance PKR ${money(s.adv)}</span>`;
            return '<span class="ui-badge ok">Paid up</span>';
        }
        function renderTable(data) {
            const tbody = document.getElementById('studentTableBody'), tf = document.getElementById('studentTableFoot');
            const canEdit = typeof can !== 'function' || !ME || !ME.perms || can('students', 'e'), canDel = typeof can !== 'function' || !ME || !ME.perms || can('students', 'd');
            const T = { tu: 0, ot: 0, ar: 0, due: 0 };
            data.forEach(row => { T.tu += tuitionOf(row); T.ot += otherOf(row); T.ar += parseFloat(row.arrears2025) || 0; T.due += (FEE_BY_ADM.get(admKey(row.admis_no)) || { due: 0 }).due; });
            tbody.innerHTML = data.length ? data.slice(0, SHOWN).map(row => {
                const adm = row.admis_no || '', st = String(row.status || 'Active').trim() || 'Active', ar = parseFloat(row.arrears2025) || 0, iss = issuesOf(row);
                const parts = [['Registration', feeOf(row, ['regritation_fee', 'registration_fee', 'reg_fee'])], ['Admission', feeOf(row, ['admission_fee'])], ['Annual fund', feeOf(row, ['annual_fund'])]].filter(p => p[1]);
                const other = otherOf(row);
                return `<tr>
                    <td style="font-family:ui-monospace,monospace;white-space:nowrap">${esc(adm) || '-'}</td>
                    <td><button type="button" class="ui-link" data-a="${esc(adm)}" onclick="openProfile(this.dataset.a)">${esc(row.student_name || '-')}</button>${row.siblings ? `<div class="ui-muted">Family: ${esc(row.siblings)}</div>` : ''}${iss.length ? `<div><span class="ui-badge warn" title="${esc(iss.join(', '))}">⚠ ${esc(iss[0])}${iss.length > 1 ? ' +' + (iss.length - 1) : ''}</span></div>` : ''}</td>
                    <td>${esc(row.class || '-')}</td>
                    <td>${telLink(row.contact_no_father) || '<span class="ui-muted">No phone</span>'}${phone(row.contact_no_mother) ? `<div class="ui-muted">${telLink(row.contact_no_mother)}</div>` : ''}</td>
                    <td class="n"><b>${money(tuitionOf(row))}</b></td>
                    <td class="n" title="${esc(parts.map(p => p[0] + ' ' + money(p[1])).join(' · '))}">${other ? money(other) : '<span class="ui-muted">-</span>'}${ar ? `<div style="color:var(--bad);font-size:11px;font-weight:700">Arrears ${money(ar)}</div>` : ''}</td>
                    <td>${feeBadge(adm)}</td>
                    <td>${isActive(row) ? '<span class="ui-badge ok">Active</span>' : `<span class="ui-badge bad">${esc(st)}</span>${row.left_date ? `<div class="ui-muted">${esc(row.left_date)}</div>` : ''}`}</td>
                    <td class="no-print" style="text-align:right;white-space:nowrap">
                        <button type="button" class="ui-btn sm" data-a="${esc(adm)}" onclick="openProfile(this.dataset.a)" title="Open profile">👁</button>
                        ${canEdit ? `<button type="button" class="ui-btn sm" data-a="${esc(adm)}" onclick="editStudentByAdm(this.dataset.a)" title="Edit">✏️</button>` : ''}
                        ${canDel ? `<button type="button" class="ui-btn sm" data-a="${esc(adm)}" onclick="deleteStudent(this.dataset.a)" title="Delete">🗑️</button>` : ''}
                    </td></tr>`;
            }).join('') : `<tr><td colspan="9" class="ui-empty">${allStudentsCache.length ? 'No students match these filters.' : 'No student records yet. Use “Add student” to create the first one.'}</td></tr>`;
            tf.innerHTML = data.length ? `<tr><td colspan="4">Total · ${money(data.length)} student${data.length === 1 ? '' : 's'}</td><td class="n">${money(T.tu)}</td><td class="n">${money(T.ot + T.ar)}</td><td colspan="3">${FEES_OK ? 'Due: PKR ' + money(T.due) : ''}</td></tr>` : '';
            document.getElementById('totalTuitionFee').innerText = `PKR ${money(T.tu + T.ot + T.ar)}`;
            document.getElementById('stuMore').innerHTML = data.length > SHOWN ? `<button type="button" class="ui-btn" onclick="SHOWN+=300;renderTable(VIEW)">Show more (${money(data.length - SHOWN)} remaining)</button>` : '';
            renderKpis();
        }

        function exportStudents() {
            if(!VIEW.length) { UI.toast('There are no students to export.', false); return; }
            UI.csv('students', ['Sr no', 'Admission no', 'Name', 'Class', 'Status', 'Father contact', 'Mother contact', 'Date of joining', 'Left date', 'Family code', 'Monthly fee (after discount)', 'Registration fee', 'Admission fee', 'Annual fund', 'Arrears 2025', 'Fee due now', 'Remarks'],
                VIEW.map(r => [r.sr_no, r.admis_no, r.student_name, r.class, r.status || 'Active', r.contact_no_father, r.contact_no_mother, r.doj, r.left_date, r.siblings, tuitionOf(r), feeOf(r, ['regritation_fee', 'registration_fee', 'reg_fee']), feeOf(r, ['admission_fee']), feeOf(r, ['annual_fund']), r.arrears2025, FEES_OK ? (FEE_BY_ADM.get(admKey(r.admis_no)) || { due: 0 }).due : '', r.remarks]));
        }

        async function openProfile(adm) {
            const r = allStudentsCache.find(x => admKey(x.admis_no) === admKey(adm)); if(!r) return;
            const s = FEE_BY_ADM.get(admKey(adm)), t = todayIso();
            const family = r.siblings ? allStudentsCache.filter(x => x !== r && String(x.siblings || '').trim().toLowerCase() === String(r.siblings).trim().toLowerCase()) : [];
            const dd = (label, value) => `<div><dt>${label}</dt><dd>${value || '<span class="ui-muted">-</span>'}</dd></div>`;
            const vouchers = s ? [...s.vouchers].sort((a, b) => String(a.due).localeCompare(String(b.due)) || a.id.localeCompare(b.id)) : [];
            const vrow = v => { const bal = r2(v.net - v.paid), upcoming = v.due && v.due > t;
                const badge = upcoming ? (v.paid > 0 ? '<span class="ui-badge info">Advance</span>' : '<span class="ui-badge mute">Upcoming</span>') : bal <= 0.5 ? '<span class="ui-badge ok">Cleared</span>' : v.paid > 0 ? '<span class="ui-badge warn">Part paid</span>' : '<span class="ui-badge bad">Unpaid</span>';
                return `<tr><td>${esc(v.period || '-')}</td><td style="font-family:ui-monospace,monospace">${esc(v.id)}</td><td class="n">${money(v.net)}</td><td class="n">${money(v.paid)}</td><td class="n"><b>${bal > 0.5 && !upcoming ? money(bal) : '-'}</b></td><td>${badge}</td></tr>`; };
            const html = `
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">${isActive(r) ? '<span class="ui-badge ok">Active</span>' : `<span class="ui-badge bad">${esc(r.status)}</span>`}<span class="ui-badge info">Class ${esc(r.class || '-')}</span>${FEES_OK ? (s && s.due > 0.5 ? `<span class="ui-badge bad">PKR ${money(s.due)} fees due</span>` : '<span class="ui-badge ok">No fees due</span>') : ''}${issuesOf(r).map(i => `<span class="ui-badge warn">⚠ ${esc(i)}</span>`).join('')}</div>
                <div class="ui-sec" style="margin-top:0">Student &amp; family</div>
                <dl class="ui-dl">${dd('Admission no', esc(r.admis_no))}${dd('Serial no', esc(r.sr_no))}${dd('Date of joining', esc(r.doj))}${r.left_date ? dd('Left date', esc(r.left_date)) : ''}${dd('Father contact', telLink(r.contact_no_father))}${dd('Mother contact', telLink(r.contact_no_mother))}${dd('Family code', esc(r.siblings))}${dd('Remarks', esc(r.remarks))}</dl>
                ${family.length ? `<div class="ui-sec">Brothers &amp; sisters (${family.length})</div><div class="ui-scroll"><table class="ui-table"><tbody>${family.map(f => { const fs = FEE_BY_ADM.get(admKey(f.admis_no)); return `<tr><td><b>${esc(f.student_name)}</b></td><td>Adm ${esc(f.admis_no)}</td><td>Class ${esc(f.class || '-')}</td><td class="n">${FEES_OK ? (fs && fs.due > 0.5 ? `<span class="ui-badge bad">PKR ${money(fs.due)} due</span>` : '<span class="ui-badge ok">Paid up</span>') : ''}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
                <div class="ui-sec">Fee structure (per student)</div>
                <dl class="ui-dl">${dd('Monthly tuition (after discount)', 'PKR ' + money(tuitionOf(r)))}${dd('Registration fee', 'PKR ' + money(feeOf(r, ['regritation_fee', 'registration_fee', 'reg_fee'])))}${dd('Admission fee', 'PKR ' + money(feeOf(r, ['admission_fee'])))}${dd('Annual fund', 'PKR ' + money(feeOf(r, ['annual_fund'])))}${dd('Arrears from ' + ARREARS_SOURCE_YEAR, r.arrears2025 ? 'PKR ' + money(r.arrears2025) : '')}</dl>
                <div class="ui-sec">Fee position${s ? ` · billed PKR ${money(vouchers.reduce((a, v) => a + v.net, 0))} · received PKR ${money(vouchers.reduce((a, v) => a + v.paid, 0))}` : ''}</div>
                ${!FEES_OK ? '<p class="ui-muted">Fee details are not available for your role.</p>' : !vouchers.length ? '<p class="ui-muted">No fee vouchers have been created for this student yet.</p>' : `<div class="ui-scroll" style="max-height:260px"><table class="ui-table"><thead><tr><th>Month</th><th>Voucher</th><th class="n">Net fee</th><th class="n">Received</th><th class="n">Pending</th><th>Status</th></tr></thead><tbody>${vouchers.map(vrow).join('')}</tbody></table></div>`}`;
            const canEdit = typeof can !== 'function' || !ME || !ME.perms || can('students', 'e'), canLedger = typeof can === 'function' && ME && ME.perms ? can('fees', 'v') : true;
            const choice = await UI.dialog({ title: `${r.student_name || 'Student'} · Adm ${r.admis_no || '-'}`, html, wide: true,
                buttons: [{ label: 'Close', value: null }, ...(canEdit ? [{ label: '✏️ Edit', value: 'edit' }] : []), ...(canLedger ? [{ label: '📒 Open fee ledger', value: 'ledger', kind: 'pri' }] : [])] });
            if(choice === 'edit') editStudentByAdm(adm);
            if(choice === 'ledger') location.href = 'fees.html?student=' + encodeURIComponent(adm);
        }

        // ====================================================================================
        // UNPAID FEE VOUCHERS CREATED TOGETHER WITH A NEW STUDENT
        // ====================================================================================
        const VM = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const ARREARS_SOURCE_YEAR = 2025;
        let SCHOOL_YEAR = new Date().getFullYear();
        const OT = [['regCk', 'regritation_fee', 'regritation_disc', 'registration fee', 'Registration fee'], ['admCk', 'admission_fee', 'admission_disc', 'admission fee', 'Admission fee'], ['annCk', 'annual_fund', 'annual_fund_disc', 'annual fund', 'Annual fund']];
        let vmSel = Array(12).fill(false), otOn = {};
        const gv = id => document.getElementById(id);
        const numOf = id => parseFloat((gv(id) || {}).value) || 0;
        function dojVal() { const m = String(gv('doj').value || '').match(/^(\d{4})-(\d{2})/); return m ? (+m[1]) * 12 + (+m[2]) : null; }
        function leftEndVal() { const m = String(gv('left_date').value || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if(gv('status').value === 'Active' || !m) return null; return (+m[1]) * 12 + (+m[2]) - (+m[3] > 15 ? 0 : 1); }
        function monthOk(i) { const dv = dojVal(); if(dv === null) return false; const v = SCHOOL_YEAR * 12 + i + 1, e = leftEndVal(); return v >= dv && (e === null || v <= e); }
        function resetMonthDefaults() {
            vmSel = VM.map((_, i) => monthOk(i));
            const dv = dojVal(); gv('oneMonth').value = dv !== null && Math.floor((dv - 1) / 12) === SCHOOL_YEAR ? (dv - 1) % 12 : 0;
            refreshVouch();
        }
        function pickMonths(on) { vmSel = VM.map((_, i) => on && monthOk(i)); refreshVouch(); }
        function refreshVouch() {
            if(!gv('vouchSection')) return;
            gv('vouchBody').classList.toggle('hidden', !gv('vouchOn').checked);
            gv('monthChips').innerHTML = VM.map((m, i) => { const ok = monthOk(i); return `<label class="flex items-center justify-center gap-1.5 text-xs font-semibold border rounded-lg px-2 py-1.5 ${ok ? 'bg-white cursor-pointer hover:border-indigo-300 has-[:checked]:bg-indigo-100 has-[:checked]:border-indigo-400 has-[:checked]:text-indigo-800' : 'opacity-40 bg-slate-50'}"><input type="checkbox" ${vmSel[i] && ok ? 'checked' : ''} ${ok ? '' : 'disabled'} onchange="vmSel[${i}] = this.checked; refreshVouch()">${m.slice(0, 3)}</label>`; }).join('');
            gv('oneTime').innerHTML = OT.map(o => { const amt = numOf(o[1]), on = otOn[o[0]] !== undefined ? otOn[o[0]] : amt > 0; return `<label class="flex items-center gap-2 text-xs border rounded-lg px-3 py-2 bg-white cursor-pointer has-[:checked]:bg-emerald-50 has-[:checked]:border-emerald-400"><input type="checkbox" id="${o[0]}" ${on ? 'checked' : ''} onchange="otOn['${o[0]}'] = this.checked; refreshVouch()"> ${o[4]} <b>${amt.toLocaleString()}</b></label>`; }).join('');
            const plan = vouchPlan(), grp = vouchGroups(plan);
            gv('vouchSummary').innerText = dojVal() === null ? 'Select the date of joining (DOJ) first.' : (plan.length ? `${plan.length} fee item(s) in ${grp.length} voucher(s)` + (grp.length && grp[0].length > 1 ? ` (one admission voucher with ${grp[0].length} items)` : '') + `, total PKR ${plan.reduce((s, r) => s + r.payable - r.discount, 0).toLocaleString()} after discount.` : 'No voucher selected.');
        }
        function initVouchSection() {
            gv('vouchSection').classList.remove('hidden'); gv('vouchOn').checked = true; otOn = {};
            if(!gv('oneMonth').options.length) gv('oneMonth').innerHTML = VM.map((m, i) => `<option value="${i}">${m} ${SCHOOL_YEAR}</option>`).join('');
            resetMonthDefaults();
        }
        // the list of vouchers to create from the current form values
        // every month has ONE voucher number: the items of the same month (tuition, registration, admission, annual fund...) share it
        function vouchGroups(plan) {
            const m = {};
            plan.forEach(v => { (m[v.period] = m[v.period] || []).push(v); });
            return Object.keys(m).sort((x, y) => VM.indexOf(x.split(' ')[0]) - VM.indexOf(y.split(' ')[0])).map(k => m[k]);
        }
        function vouchPlan() {
            if(!gv('vouchOn').checked || dojVal() === null) return [];
            const plan = [], tPay = numOf('monthly_tution_fee'), tDisc = Math.min(numOf('monthly_tution_disc'), tPay), one = VM[+gv('oneMonth').value] + ` ${SCHOOL_YEAR}`;
            VM.forEach((m, i) => { if(vmSel[i] && monthOk(i) && tPay > 0) plan.push({ type: 'tuition fee', period: `${m} ${SCHOOL_YEAR}`, payable: tPay, discount: tDisc, remarks: tDisc > 0 ? `Discount ${tDisc}: at admission` : '' }); });
            OT.forEach(o => {
                const el = gv(o[0]); if(!el || !el.checked) return;
                const pay = o[0] === 'arrCk' ? (parseFloat(gv('arrears2025').value) || 0) : numOf(o[1]);
                if(pay <= 0) return;
                const disc = o[2] ? Math.min(numOf(o[2]), pay) : 0;
                plan.push(o[0] === 'arrCk' ? { type: 'arrears', period: `January ${SCHOOL_YEAR}`, payable: pay, discount: 0, remarks: `${ARREARS_SOURCE_YEAR} arrears (one-time carry-forward)`, arrears: String(pay) }
                    : { type: o[3], period: one, payable: pay, discount: disc, remarks: disc > 0 ? `Discount ${disc}: at admission` : '' });
            });
            return plan;
        }
        async function createStudentVouchers(p) {
            const plan = vouchPlan(); if(!plan.length) return '';
            const exResponse = await ERP.db.request('fees', 'select=voucher_id,admis_no,period,type');
            if(!exResponse.ok) throw new Error('Could not check existing fee vouchers. No new vouchers were created.');
            const ex = await exResponse.json();
            if(!Array.isArray(ex)) throw new Error('Could not verify existing fee vouchers. No new vouchers were created.');
            const used = new Set(), keys = new Set(), arrearsAlreadyBilled = new Set(); let max = 100000;
            (Array.isArray(ex) ? ex : []).forEach(r => {
                const m = String(r.voucher_id || '').match(/^V-(\d+)/i); if(m) { used.add(+m[1]); if(+m[1] > max) max = +m[1]; }
                const adm = String(r.admis_no || '').trim().toLowerCase(), type = String(r.type || '').trim().toLowerCase();
                keys.add(`${adm}_${String(r.period || '').trim()}_${type}`);
                if(type === 'arrears' && adm) arrearsAlreadyBilled.add(adm);
            });
            const adm = String(p.admis_no || '').trim().toLowerCase(), today = new Date().toISOString().split('T')[0], tc = t => String(t).replace(/\b\w/g, c => c.toUpperCase());
            let n = max, dup = 0, arrearsSkipped = 0; const rows = [], made = [];
            vouchGroups(plan).forEach(g => {
                const items = g.filter(v => {
                    if(v.type === 'arrears' && arrearsAlreadyBilled.has(adm)) { dup++; arrearsSkipped++; return false; }
                    if(keys.has(`${adm}_${v.period}_${v.type}`)) { dup++; return false; }
                    return true;
                });
                if(!items.length) return;
                do { n++; } while(used.has(n)); used.add(n);
                const vid = 'V-' + n;                                   // all items of a group are saved as separate rows with the SAME voucher number
                items.forEach(v => rows.push({ sr_no: p.sr_no || '', voucher_id: vid, admis_no: p.admis_no, student_name: p.student_name, type: v.type, period: v.period, payable: v.payable, discount: v.discount || 0, class: p.class, status: 'Unpaid', date: today, remarks: v.remarks, siblings: p.siblings, arrears2025: v.arrears || null }));
                made.push({ vid, items });
            });
            const arrearsSkipMessage = arrearsSkipped ? `\n${arrearsSkipped} 2025 arrears item(s) skipped because an arrears voucher already exists; check its remaining balance.` : '';
            if(!rows.length) return `\n\nNo new vouchers: ${dup} already exist.` + arrearsSkipMessage;
            const c = getSupabaseConfig();
            const r = await fetch(`${c.url}/rest/v1/fees`, { method: 'POST', headers: { "apikey": c.key, "Authorization": `Bearer ${c.key}`, "Content-Type": "application/json", "Prefer": "return=minimal" }, body: JSON.stringify(rows) });
            if(!r.ok) throw new Error(await r.text());
            const total = rows.reduce((s, x) => s + x.payable - x.discount, 0), first = made[0];
            return `\n\n${made.length} voucher(s) created, total PKR ${total.toLocaleString()}.` + (first.items.length > 1 ? `\nAdmission voucher ${first.vid}: ${first.items.map(v => tc(v.type) + (v.type === 'tuition fee' ? ' (' + v.period.split(' ')[0] + ')' : '')).join(' + ')}.` : `\nVoucher ${first.vid}.`) + (made.length > 1 ? `\nMonthly vouchers: ${made.slice(1).map(m => m.vid).join(', ')}.` : '') + (dup ? `\n${dup} item(s) already existed.` : '') + arrearsSkipMessage;
        }
        window.addEventListener('load', () => {
            ['doj', 'left_date', 'status'].forEach(id => gv(id).addEventListener('change', resetMonthDefaults));
            gv('oneMonth').addEventListener('change', refreshVouch); gv('vouchOn').addEventListener('change', refreshVouch);
            initVouchSection();
        });

        function openStudentModal() { document.getElementById('studentModal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
        function closeStudentModal() { document.getElementById('studentModal').classList.add('hidden'); document.body.style.overflow = ''; }
        // next Sr No / Admission No = the last number + 1 (keeps a prefix, suffix and leading zeros, e.g. A-0099 -> A-0100)
        function nextNum(list) {
            let best = null;
            list.forEach(v => { const m = String(v ?? '').trim().match(/^(\D*?)(\d+)(\D*)$/); if(!m) return; const n = parseInt(m[2], 10); if(!best || n > best.n) best = { n, pre: m[1], suf: m[3], len: m[2].length, pad: m[2].length > 1 && m[2].startsWith('0') }; });
            if(!best) return '';
            const nx = String(best.n + 1);
            return best.pre + (best.pad ? nx.padStart(best.len, '0') : nx) + best.suf;
        }
        function fillNextNumbers(rows) {
            const sr = document.getElementById('sr_no'), ad = document.getElementById('admis_no');
            if(document.getElementById('editOriginalAdm').value !== '') return;
            if(!sr.dataset.touched) sr.value = nextNum(rows.map(r => r.sr_no));
            if(!ad.dataset.touched) ad.value = nextNum(rows.map(r => r.admis_no));
        }
        function setNewMode(isNew) {
            // a new admission has no leaving date, no old arrears and is always Active: grey those boxes out
            ['left_date', 'arrears2025', 'status'].forEach(id => { const el = document.getElementById(id), box = el.parentElement; el.disabled = isNew; box.classList.toggle('opacity-40', isNew); box.title = isNew ? 'Not needed for a new admission' : ''; });
            if(isNew) { document.getElementById('status').value = 'Active'; document.getElementById('left_date').value = ''; document.getElementById('arrears2025').value = ''; }
        }
        async function addStudentClick() {
            resetForm(); openStudentModal(); setNewMode(true);
            ['sr_no', 'admis_no'].forEach(id => { const el = document.getElementById(id); delete el.dataset.touched; el.oninput = () => { el.dataset.touched = '1'; }; });
            fillNextNumbers(allStudentsCache);                       // instantly from the loaded list
            try { const r = await ERP.db.request('students', 'select=sr_no,admis_no'); const rows = r.ok ? await r.json() : null; if(Array.isArray(rows) && rows.length) fillNextNumbers(rows); } catch (e) { /* keep the cached values */ }
            setTimeout(() => document.getElementById('student_name').focus(), 60);
        }
        function cancelStudentForm() { resetForm(); closeStudentModal(); }
        document.addEventListener('keydown', e => { if(e.key === 'Escape') cancelStudentForm(); });

        async function saveStudent(event) {
            event.preventDefault();
            let config = getSupabaseConfig();
            let payloadData = {
                sr_no: parseInt(document.getElementById('sr_no').value) || 0,
                admis_no: document.getElementById('admis_no').value.trim(),
                student_name: document.getElementById('student_name').value.trim(),
                doj: document.getElementById('doj').value || null,
                contact_no_father: document.getElementById('contact_no_father').value.trim(),
                contact_no_mother: document.getElementById('contact_no_mother').value.trim(),
                class: document.getElementById('class').value.trim(),
                monthly_tution_fee: parseFloat(document.getElementById('monthly_tution_fee').value) || 0,
                regritation_fee: parseFloat(document.getElementById('regritation_fee').value) || 0,
                admission_fee: parseFloat(document.getElementById('admission_fee').value) || 0,
                annual_fund: parseFloat(document.getElementById('annual_fund').value) || 0,
                status: document.getElementById('status').value,
                siblings: document.getElementById('siblings').value.trim() || null,
                arrears2025: document.getElementById('arrears2025').value.trim() || null,
                left_date: document.getElementById('left_date').value || null,
                remarks: document.getElementById('remarks').value.trim()
            };

            if(!payloadData.doj) { UI.notify('DOJ (date of joining) is required: fee vouchers start from the joining month.'); return; }
            if(payloadData.status !== 'Active' && !payloadData.left_date) { UI.notify('Left date is required when the status is not Active.'); return; }
            if(payloadData.status === 'Active') payloadData.left_date = null;
            let editOriginalAdm = document.getElementById('editOriginalAdm').value;
            if(editOriginalAdm === '' && allStudentsCache.some(x => String(x.admis_no || '').trim().toLowerCase() === payloadData.admis_no.toLowerCase())) { UI.notify('This admission number already exists. Please use a different one.'); return; }
            const vouchP = { ...payloadData };
            let dropped = [];
            if(allStudentsCache.length) {          // only send columns that really exist in the students table
                const cols = new Set(Object.keys(allStudentsCache[0])), ALIAS = { regritation_fee: ['regritation_fee', 'registration_fee', 'reg_fee'] };
                Object.keys(payloadData).forEach(k => { const c = (ALIAS[k] || [k]).find(x => cols.has(x)); if(!c) { dropped.push(k); delete payloadData[k]; } else if(c !== k) { payloadData[c] = payloadData[k]; delete payloadData[k]; } });
            }
            showLoading("Saving Student Record...");
            try {
                let res;
                if(editOriginalAdm !== "") {
                    res = await fetch(`${config.url}/rest/v1/students?admis_no=eq.${encodeURIComponent(editOriginalAdm)}`, {
                        method: 'PATCH',
                        headers: { "apikey": config.key, "Authorization": `Bearer ${config.key}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                        body: JSON.stringify(payloadData)
                    });
                    if(res.ok) UI.notify("Student Updated Successfully!" + (dropped.length ? "\n\nNote: the students table has no column for " + dropped.join(", ") + "." : ""));
                } else {
                    res = await fetch(`${config.url}/rest/v1/students`, {
                        method: 'POST',
                        headers: { "apikey": config.key, "Authorization": `Bearer ${config.key}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                        body: JSON.stringify(payloadData)
                    });
                    if(res.ok) {
                    let msg = "Student Saved Successfully!";
                    try { msg += await createStudentVouchers(vouchP); } catch(e) { console.error(e); msg += "\n\nBut the fee vouchers could NOT be created (" + (/fees_pkey|23505/.test(e.message) ? "the fees table still has voucher_id as its primary key: run the SQL from the chat to move it to the seq column" : e.message) + "). Create them from Fee Vouchers -> Generate."; }
                    UI.notify(msg + (dropped.length ? "\n\nNote: the students table has no column for " + dropped.join(", ") + " (these amounts were used for the vouchers only)." : ""));
                }
            }
            if(res && !res.ok) { hideLoading(); UI.notify("Could not save: " + await res.text()); return; }
            hideLoading();
            resetForm(); closeStudentModal();
            fetchStudents();
            } catch (error) {
                hideLoading();
                console.error("Error:", error);
                UI.notify("Error saving record.");
            }
        }

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
        function editStudentByAdm(a) { const r = allStudentsCache.find(x => String(x.admis_no || '') === String(a)); if(r) editStudent(r); }
        function editStudent(row) {
            openStudentModal(); setNewMode(false);
            document.getElementById('editOriginalAdm').value = row.admis_no || '';
            document.getElementById('sr_no').value = row.sr_no || '';
            document.getElementById('admis_no').value = row.admis_no || '';
            { const a = document.getElementById('admis_no'); a.readOnly = true; a.title = 'The admission number cannot be changed: fee records are linked to it.'; }
            document.getElementById('student_name').value = row.student_name || '';
            document.getElementById('doj').value = row.doj || '';
            document.getElementById('contact_no_father').value = row.contact_no_father || '';
            document.getElementById('contact_no_mother').value = row.contact_no_mother || '';
            document.getElementById('class').value = row.class || '';
            document.getElementById('monthly_tution_fee').value = row.monthly_tution_fee || 0;
            document.getElementById('regritation_fee').value = (row.regritation_fee ?? row.registration_fee) || 0;
            document.getElementById('admission_fee').value = row.admission_fee || 0;
            document.getElementById('annual_fund').value = row.annual_fund || 0;
            calculatePayables();
            document.getElementById('status').value = row.status || 'Active';
            document.getElementById('remarks').value = row.remarks || '';
            document.getElementById('siblings').value = row.siblings || '';
            document.getElementById('arrears2025').value = row.arrears2025 || '';
            document.getElementById('left_date').value = row.left_date || '';
            document.getElementById('vouchSection').classList.add('hidden'); document.getElementById('vouchOn').checked = false;
            document.getElementById('formTitle').innerText = "Edit Student Record";
            document.getElementById('saveBtn').innerText = "Update Student";
            document.getElementById('cancelBtn').classList.remove('hidden');
        }

        async function deleteStudent(admisNo) {
            const row = allStudentsCache.find(x => admKey(x.admis_no) === admKey(admisNo)) || {}, name = row.student_name || 'this student';
            const config = getSupabaseConfig();
            showLoading("Checking fee records...");
            let vouchers = 0;
            try {
                const res = await ERP.db.request('fees', 'select=voucher_id&admis_no=eq.' + encodeURIComponent(admisNo));
                const rows = res.ok ? await res.json() : null;
                if(!Array.isArray(rows)) throw new Error('fee check failed');
                vouchers = new Set(rows.map(x => x.voucher_id)).size;
            } catch (e) {
                hideLoading(); console.error(e);
                UI.alert(`Could not check ${name}'s fee records, so the delete was stopped for safety. Check your connection and try again.`);
                return;
            }
            hideLoading();
            if(vouchers > 0) {
                const pick = await UI.dialog({ title: 'This student cannot be deleted',
                    message: `${name} has ${vouchers} fee voucher${vouchers === 1 ? '' : 's'}. Deleting the student would leave their fee history and payments without an owner.\n\nMark the student as Left instead: all history stays and no new fees are expected.`,
                    buttons: [{ label: 'Cancel', value: null }, { label: 'Mark as Left', value: 'left', kind: 'pri' }] });
                if(pick === 'left') { editStudent(row); document.getElementById('status').value = 'Left'; document.getElementById('left_date').value = todayIso(); }
                return;
            }
            if(!await UI.confirm(`Delete ${name} (Adm ${admisNo})? This cannot be undone.`, { title: 'Delete student', ok: 'Delete', danger: true })) return;
            showLoading("Deleting Student...");
            try {
                const res = await fetch(`${config.url}/rest/v1/students?admis_no=eq.${encodeURIComponent(admisNo)}`, { method: 'DELETE', headers: { "apikey": config.key, "Authorization": `Bearer ${config.key}`, "Prefer": "return=representation" } });
                hideLoading();
                const gone = res.ok ? await res.json().catch(() => []) : [];
                if(res.ok && Array.isArray(gone) && gone.length) { UI.toast(`${name} deleted.`); fetchStudents().then(renderKpis); }
                else UI.alert('The student was not deleted. You may not have permission to delete students.');
            } catch (error) { hideLoading(); console.error(error); UI.alert('Could not connect to the database. Nothing was deleted.'); }
        }

        function resetForm() {
            document.getElementById('studentForm').reset();
            { const a = document.getElementById('admis_no'); a.readOnly = false; a.title = ''; }
            if(typeof initVouchSection === 'function') initVouchSection();
            document.getElementById('editOriginalAdm').value = '';
            calculatePayables();
            document.getElementById('formTitle').innerText = "Add New Student";
            document.getElementById('saveBtn').innerText = "Save Student";
        }




    
