        let allStudentsCache = [];
        let incrementsCache = [];
        let currentSortColumn = '';
        let sortDirection = 'asc';

        const FIX_SQL = `alter table public.increments
  add column if not exists fee_type text,
  add column if not exists new_fee numeric,
  add column if not exists old_fee numeric,
  add column if not exists fee_increament numeric,
  add column if not exists effective_period text,
  add column if not exists annual_fund numeric,
  add column if not exists remarks text;
notify pgrst, 'reload schema';`;
        let resultSql = '';

        const enc = encodeURIComponent;
        const num = v => parseFloat(v) || 0;
        const rawTrim = v => String(v ?? '').trim();

        function showLoading(text = "Processing...") {
            document.getElementById('loadingText').innerText = text;
            document.getElementById('loadingOverlay').classList.remove('hidden');
        }
        function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

        /* ---------- result popup ---------- */
        function showResult(title, lines, sql) {
            document.getElementById('resTitle').innerHTML = title;
            document.getElementById('resBody').innerHTML = lines.map(l => `<div style="margin-bottom:6px">${l}</div>`).join('');
            resultSql = sql || '';
            const pre = document.getElementById('resSql');
            pre.style.display = sql ? 'block' : 'none'; pre.innerText = sql || '';
            document.getElementById('resCopy').style.display = sql ? 'inline-block' : 'none';
            document.getElementById('resultModal').style.display = 'flex';
        }
        function closeResult() { document.getElementById('resultModal').style.display = 'none'; }
        function copyResultSql() { navigator.clipboard.writeText(resultSql).then(() => UI.notify('SQL copied. Paste it in Supabase → SQL Editor and run it.')); }

        let incrementSchoolYear = new Date().getFullYear();

        function setIncrementPeriods(year) {
            incrementSchoolYear = year;
            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const select = document.getElementById('bulkIncPeriod');
            select.innerHTML = months.map(month => `<option value="${month} ${year}">${month} ${year}</option>`).join('');
            select.value = `March ${year}`;
        }

        async function initPage() {
            let config = getSupabaseConfig();
            if(!config.url || !config.key) { }
            else {
                showLoading("Loading Increments & Students Data...");
                try {
                    const dataPromise = Promise.all([fetchIncrementsCache(), fetchStudents()]);
                    setIncrementPeriods(await getSchoolYear());
                    await dataPromise;
                    filterIncrementStudents();
                } catch (e) {
                    console.error("Could not initialize increments:", e);
                    UI.notify(e.message || 'Could not load increments data.');
                } finally {
                    hideLoading();
                }
            }
        }

        // fresh = true bypasses the shared cache (used right after saving / deleting)
        async function fetchIncrementsCache(fresh) {
            incrementsCache = [];
            try {
                if(fresh && typeof sbCacheClear === 'function') await sbCacheClear('increments');
                let res = await ERP.db.request('increments', 'select=*');
                let data = await res.json();
                if(Array.isArray(data)) incrementsCache = data;
            } catch(e) { console.error("Error fetching increments:", e); }
        }

        async function fetchStudents() {
            try {
                let res = await ERP.db.request('students', 'select=*');
                let data = await res.json();
                if(Array.isArray(data)) {
                    allStudentsCache = data;
                    populateClassDropdown(data);
                    filterIncrementStudents();
                }
            } catch(e) { console.error("Error fetching students:", e); }
        }

        async function reloadFromDatabase() {
            showLoading("Reloading from the database...");
            await fetchIncrementsCache(true);
            filterIncrementStudents();
            hideLoading();
        }

        function populateClassDropdown(data) {
            let classSet = new Set();
            data.forEach(row => { if(row.class) classSet.add(row.class.trim()); });
            let classFilter = document.getElementById('classFilter');
            let currentSelected = classFilter.value;
            classFilter.innerHTML = `<option value="ALL">🔍 All Classes</option>`;
            Array.from(classSet).sort().forEach(cls => {
                let opt = document.createElement('option');
                opt.value = cls; opt.innerText = cls;
                classFilter.appendChild(opt);
            });
            if(classSet.has(currentSelected)) classFilter.value = currentSelected;
        }

        function filterIncrementStudents() {
            let q = document.getElementById('incSearchInput').value.trim().toLowerCase();
            let selectedClass = document.getElementById('classFilter').value;

            let filtered = allStudentsCache.filter(st => {
                let adm = (st.admis_no || '').toString().toLowerCase();
                let name = (st.student_name || '').toLowerCase();
                let cls = (st.class || '').trim();
                let matchesQuery = adm.includes(q) || name.includes(q);
                let matchesClass = selectedClass === 'ALL' || cls === selectedClass;
                return matchesQuery && matchesClass;
            });

            if (currentSortColumn) {
                filtered.sort((a, b) => {
                    let valA = (a[currentSortColumn] || '').toString().toLowerCase();
                    let valB = (b[currentSortColumn] || '').toString().toLowerCase();
                    if (!isNaN(valA) && !isNaN(valB)) {
                        valA = parseFloat(valA);
                        valB = parseFloat(valB);
                    }
                    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
                    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
                    return 0;
                });
            }

            renderIncrementTable(filtered);
        }

        function sortTable(column) {
            if (currentSortColumn === column) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = column;
                sortDirection = 'asc';
            }
            filterIncrementStudents();
        }

        function toggleSelectAll(source) {
            let checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => cb.checked = source.checked);
        }

        function calculateNewFee(idx) {
            let oldFee = parseFloat(document.getElementById(`oldfee_${idx}`).value) || 0;
            let feeInc = parseFloat(document.getElementById(`feeinc_${idx}`).value) || 0;
            document.getElementById(`newfee_${idx}`).value = oldFee + feeInc;
        }

        // the saved increment row of a student (matched on the trimmed admission number)
        function findExisting(admNo) { return incrementsCache.find(i => rawTrim(i.admis_no) === admNo); }

        function renderIncrementTable(studentsList) {
            let tbody = document.getElementById('incrementTableBody');
            tbody.innerHTML = '';
            document.getElementById('selectAllCheckbox').checked = false;

            if(studentsList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="12" class="p-6 text-center text-slate-400">No student records found.</td></tr>`;
                document.getElementById('incCountInfo').innerText = `Total Students: 0`;
                return;
            }

            let defaultFeeType = document.getElementById('bulkFeeType').value;

            studentsList.forEach((st, idx) => {
                let admNo = rawTrim(st.admis_no || st.sr_no);
                let sName = (st.student_name || '').trim();
                let sClass = (st.class || '').trim();
                let existingInc = findExisting(admNo);

                let feeType = existingInc ? (existingInc.fee_type || defaultFeeType) : defaultFeeType;
                let oldFee = existingInc ? (existingInc.old_fee || st.monthly_tution_fee || 0) : (st.monthly_tution_fee || 0);
                let feeInc = existingInc ? (existingInc.fee_increament || '') : '';
                let newFee = existingInc ? (existingInc.new_fee || (num(oldFee) + num(feeInc))) : '';
                let effPeriod = existingInc ? (existingInc.effective_period || `March ${incrementSchoolYear}`) : `March ${incrementSchoolYear}`;
                let annualFund = existingInc ? (existingInc.annual_fund || st.annual_fund || '') : (st.annual_fund || '');
                let remarks = existingInc ? (existingInc.remarks || '') : '';
                let fromStudent = !(existingInc && existingInc.annual_fund) && st.annual_fund;

                let tr = document.createElement('tr');
                tr.className = "border-b hover:bg-slate-50 inc-row";
                tr.dataset.admNo = admNo;
                tr.dataset.sName = sName;
                tr.innerHTML = `
                    <td class="p-2.5 text-center"><input type="checkbox" class="row-checkbox" data-index="${idx}"></td>
                    <td class="p-2.5 font-mono text-indigo-900">${esc(admNo)}</td>
                    <td class="p-2.5 font-semibold">${esc(sName)}</td>
                    <td class="p-2.5 text-slate-600">${esc(sClass)}</td>
                    <td class="p-2.5"><input type="text" id="ftype_${idx}" value="${esc(feeType)}" class="w-24 border rounded p-1 text-xs bg-white outline-none"></td>
                    <td class="p-2.5"><input type="number" id="newfee_${idx}" value="${newFee}" placeholder="New Fee" class="w-24 border rounded p-1 text-xs bg-white outline-none font-bold text-indigo-700"></td>
                    <td class="p-2.5"><input type="text" id="eff_${idx}" value="${esc(effPeriod)}" class="w-24 border rounded p-1 text-xs bg-white outline-none"></td>
                    <td class="p-2.5 font-bold text-slate-700">PKR <input type="number" id="oldfee_${idx}" value="${oldFee}" class="w-20 border rounded p-1 text-xs bg-slate-100 font-bold" readonly></td>
                    <td class="p-2.5"><input type="number" id="feeinc_${idx}" value="${feeInc}" placeholder="Increment" oninput="calculateNewFee(${idx})" class="w-24 border rounded p-1 text-xs bg-white outline-none font-bold text-indigo-700"></td>
                    <td class="p-2.5"><input type="number" id="annualfund_${idx}" value="${annualFund}" placeholder="Annual Fund" ${fromStudent ? 'title="Value taken from the student record - not saved in increments yet"' : ''} class="w-24 border rounded p-1 text-xs bg-white outline-none font-bold text-emerald-700"></td>
                    <td class="p-2.5"><input type="text" id="remarks_${idx}" value="${esc(remarks)}" placeholder="Remarks" class="w-28 border rounded p-1 text-xs bg-white outline-none"></td>
                    <td class="p-2.5 text-center">
                        <button onclick="saveByIdx(${idx})" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1 rounded font-semibold transition text-[11px] border border-indigo-200">💾 Save</button>
                        <div style="font-size:10px;margin-top:3px;font-weight:600;color:${existingInc ? '#047857' : '#94a3b8'}">${existingInc ? '✔ saved in database' : 'not saved yet'}</div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            document.getElementById('incCountInfo').innerText = `Total Students: ${studentsList.length}`;
        }

        function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
        function saveByIdx(i) { const tr = document.querySelectorAll('.inc-row')[i]; if(tr) saveRows([i]); }

        async function applyBulkToCheckedRows() {
            let checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            if(checkedBoxes.length === 0) { UI.notify("Please check at least one student row!"); return; }

            let feeType = document.getElementById('bulkFeeType').value;
            let incType = document.getElementById('bulkIncType').value;
            let incVal = parseFloat(document.getElementById('bulkIncVal').value) || 0;
            let effectivePeriod = document.getElementById('bulkIncPeriod').value;

            const run = () => {
                checkedBoxes.forEach(cb => {
                    let idx = cb.getAttribute('data-index');
                    document.getElementById(`ftype_${idx}`).value = feeType;
                    document.getElementById(`eff_${idx}`).value = effectivePeriod;

                    let oldFee = parseFloat(document.getElementById(`oldfee_${idx}`).value) || 0;
                    if(incVal > 0) {
                        let calculatedInc = incType === 'percentage' ? Math.round(oldFee * incVal / 100) : incVal;
                        if(feeType === 'tution fee') {
                            document.getElementById(`feeinc_${idx}`).value = calculatedInc;
                            document.getElementById(`newfee_${idx}`).value = oldFee + calculatedInc;
                        } else if(feeType === 'annual fund') {
                            document.getElementById(`annualfund_${idx}`).value = calculatedInc;
                        }
                    }
                });
                UI.notify("Bulk values applied to checked rows. Now press 'Save Checked Changes' to store them in the database.");
            };

            // one row holds one fee type + one effective period: an annual-fund entry replaces a tuition increment of the same student
            if(feeType === 'annual fund') {
                let clash = 0;
                checkedBoxes.forEach(cb => { let tr = cb.closest('tr'); let ex = findExisting(tr.dataset.admNo); if(ex && num(ex.new_fee) > 0 && String(ex.fee_type || '').toLowerCase().includes('tution') ) clash++; });
                if(clash > 0 && !await UI.confirm(`${clash} selected student(s) already have a TUITION increment.\n\nA student has only one increment row, so the fee type and effective period of that row will change to the annual fund values.\n\nContinue?`)) return;
            }
            run();
        }

        /* ------------------------------------------------------------------
           SAVING - every request is checked, nothing is reported as saved
           unless the database sent the row back.
        ------------------------------------------------------------------ */
        function readRow(idx) {
            const tr = document.querySelectorAll('.inc-row')[idx];
            const g = id => document.getElementById(`${id}_${idx}`).value;
            return {
                admNo: tr.dataset.admNo,
                payload: {
                    admis_no: tr.dataset.admNo,
                    student_name: tr.dataset.sName,
                    fee_type: g('ftype').trim(),
                    new_fee: num(g('newfee')),
                    effective_period: g('eff').trim(),
                    old_fee: num(g('oldfee')),
                    fee_increament: num(g('feeinc')),
                    annual_fund: num(g('annualfund')),
                    remarks: g('remarks').trim()
                }
            };
        }

        async function saveRecords(items, onProgress) {
            const c = getSupabaseConfig(), base = `${c.url}/rest/v1/increments`;
            const hdr = { "apikey": c.key, "Authorization": `Bearer ${c.key}`, "Content-Type": "application/json", "Prefer": "return=representation" };
            const results = [], ups = [], ins = [];
            items.forEach(it => { const ex = findExisting(it.admNo); (ex ? ups : ins).push({ ...it, ex }); });
            let done = 0; const tick = () => { done++; if(onProgress) onProgress(done, items.length); };

            const insertOne = async it => {
                try {
                    const r = await fetch(base, { method: 'POST', headers: hdr, body: JSON.stringify(it.payload) });
                    if(r.ok) { const rows = await r.json(); results.push({ ...it, ok: true, row: rows[0] || null }); }
                    else results.push({ ...it, ok: false, error: await r.text() });
                } catch(e) { results.push({ ...it, ok: false, error: String(e.message || e) }); }
                tick();
            };

            // existing rows: update by id (or by the exact stored admission number); if nothing matched, create the row
            for(let i = 0; i < ups.length; i += 8) {
                await Promise.all(ups.slice(i, i + 8).map(async it => {
                    try {
                        const f = (it.ex.id !== undefined && it.ex.id !== null) ? `id=eq.${enc(it.ex.id)}` : `admis_no=eq.${enc(it.ex.admis_no)}`;
                        const r = await fetch(`${base}?${f}`, { method: 'PATCH', headers: hdr, body: JSON.stringify(it.payload) });
                        if(!r.ok) { results.push({ ...it, ok: false, error: await r.text() }); tick(); return; }
                        const rows = await r.json();
                        if(rows.length) { results.push({ ...it, ok: true, row: rows[0] }); tick(); }
                        else await insertOne(it);
                    } catch(e) { results.push({ ...it, ok: false, error: String(e.message || e) }); tick(); }
                }));
            }
            // new rows: in chunks; if a chunk fails, retry row by row to see exactly which ones fail
            for(let i = 0; i < ins.length; i += 100) {
                const chunk = ins.slice(i, i + 100);
                try {
                    const r = await fetch(base, { method: 'POST', headers: hdr, body: JSON.stringify(chunk.map(x => x.payload)) });
                    if(r.ok) {
                        const rows = await r.json();
                        chunk.forEach(it => { results.push({ ...it, ok: true, row: rows.find(x => rawTrim(x.admis_no) === it.admNo) || null }); tick(); });
                        continue;
                    }
                } catch(e) { /* fall through to row-by-row */ }
                await Promise.all(chunk.map(insertOne));
            }
            return results;
        }

        function reportSave(results) {
            const ok = results.filter(r => r.ok), bad = results.filter(r => !r.ok);
            const diff = ok.filter(r => r.row && (
                num(r.row.annual_fund) !== r.payload.annual_fund ||
                num(r.row.new_fee) !== r.payload.new_fee ||
                rawTrim(r.row.fee_type) !== r.payload.fee_type ||
                rawTrim(r.row.effective_period) !== r.payload.effective_period));
            const noEcho = ok.filter(r => !r.row);
            const lines = [];
            let title = '✅ Saved in the database';
            lines.push(`<b>${ok.length - diff.length - noEcho.length}</b> record(s) saved and confirmed by the database.`);
            if(diff.length) {
                title = '⚠️ Saved, but the database kept different values';
                lines.push(`<b style="color:#b45309">${diff.length}</b> record(s) were stored with different values than entered, for example: ` +
                    diff.slice(0, 5).map(r => `Adm ${esc(r.admNo)} (annual fund entered ${r.payload.annual_fund}, stored ${num(r.row.annual_fund)})`).join('; ') +
                    '. This usually means the column is missing or has a different type.');
            }
            if(noEcho.length) lines.push(`${noEcho.length} record(s) were accepted but the database did not send them back. Press 🔄 Reload and check the “saved in database” label.`);
            let sql = '';
            if(bad.length) {
                title = '❌ Some records were NOT saved';
                const errs = [...new Set(bad.map(b => b.error))].slice(0, 3);
                lines.push(`<b style="color:#be123c">${bad.length}</b> record(s) failed. Database message:`);
                errs.forEach(e => lines.push(`<code style="display:block;background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:6px 8px;font-size:12px;word-break:break-word">${esc(String(e).slice(0, 400))}</code>`));
                if(errs.some(e => /column|schema cache|PGRST204|42703/i.test(e))) { lines.push('A column is missing in the <b>increments</b> table. Run this SQL once in Supabase → SQL Editor, then save again:'); sql = FIX_SQL; }
                else if(errs.some(e => /row-level security|42501/i.test(e))) {
                    lines.push('The database rejected this change under Row Level Security. Ask an administrator to verify your Increments permissions and the policies in supabase_roles.sql. Do not disable RLS.');
                }
            } else if(diff.length) sql = FIX_SQL;
            showResult(title, lines, sql);
        }

        async function saveRows(indexes) {
            showLoading("Saving...");
            try {
                const items = indexes.map(readRow);
                const results = await saveRecords(items, (d, t) => { document.getElementById('loadingText').innerText = `Saving ${d} / ${t}...`; });
                await fetchIncrementsCache(true);
                filterIncrementStudents();
                hideLoading();
                reportSave(results);
            } catch(e) { hideLoading(); console.error(e); showResult('❌ Error', [esc(String(e.message || e))]); }
        }

        async function saveAllIncrementsBatch() {
            let checked = [...document.querySelectorAll('.row-checkbox:checked')].map(cb => parseInt(cb.getAttribute('data-index')));
            if(checked.length === 0) { UI.notify("Please check at least one student row to save!"); return; }
            await saveRows(checked);
        }

        async function bulkDeleteSelected() {
            let checkedBoxes = [...document.querySelectorAll('.row-checkbox:checked')];
            if(checkedBoxes.length === 0) { UI.notify("Please select at least one row to delete!"); return; }
            if(!await UI.confirm("Delete the saved increments of the selected students?")) return;

            showLoading("Deleting Selected Records...");
            const c = getSupabaseConfig();
            let deleted = 0, failed = [], none = 0;
            try {
                for(let cb of checkedBoxes) {
                    const admNo = cb.closest('tr').dataset.admNo, ex = findExisting(admNo);
                    if(!ex) { none++; continue; }
                    const f = (ex.id !== undefined && ex.id !== null) ? `id=eq.${enc(ex.id)}` : `admis_no=eq.${enc(ex.admis_no)}`;
                    const r = await fetch(`${c.url}/rest/v1/increments?${f}`, { method: 'DELETE', headers: { "apikey": c.key, "Authorization": `Bearer ${c.key}`, "Prefer": "return=representation" } });
                    if(r.ok) { const rows = await r.json(); if(rows.length) deleted++; else none++; }
                    else failed.push(await r.text());
                }
                await fetchIncrementsCache(true);
                filterIncrementStudents();
                hideLoading();
                const lines = [`<b>${deleted}</b> increment record(s) deleted.`];
                if(none) lines.push(`${none} selected student(s) had no saved increment.`);
                if(failed.length) lines.push(`<b style="color:#be123c">${failed.length}</b> failed: <code>${esc(failed[0].slice(0, 300))}</code>`);
                showResult(failed.length ? '⚠️ Delete finished with errors' : '✅ Delete finished', lines);
            } catch(e) {
                hideLoading();
                console.error(e);
                showResult('❌ Error', [esc(String(e.message || e))]);
            }
        }
    
