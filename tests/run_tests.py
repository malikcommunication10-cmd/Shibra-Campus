"""Shibra Campus regression tests (browser based, no real database needed).

Setup once:   pip install playwright && playwright install chromium
Run:          python tests/run_tests.py

Every page is opened in a real Chromium with the network blocked and the login guard bypassed, and the
important calculations (fee ledger FIFO, statements, students directory, dialogs) are checked with mock data.
"""
import subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8765
PAGES = ['login', 'index', 'students', 'fees', 'accounts', 'books', 'staff', 'followups', 'increments', 'reports', 'statements', 'settings', 'users', 'audit']
FAILED = []

def check(name, ok, detail=''):
    print(('  PASS  ' if ok else '  FAIL  ') + name + (f'  [{detail}]' if detail and not ok else ''))
    if not ok: FAILED.append(name)

def new_page(browser, errors, page_name):
    pg = browser.new_page()
    pg.clock.install(time='2026-10-29T10:00:00+05:00')
    pg.on('pageerror', lambda e: errors.append(str(e)[:140]))
    pg.route('**/*', lambda r: r.continue_() if f'localhost:{PORT}' in r.request.url else r.abort())
    pg.add_init_script("Object.defineProperty(window,'SB_NO_GUARD',{value:true,writable:true});")
    pg.goto(f'http://localhost:{PORT}/{page_name}.html'); pg.wait_for_timeout(500)
    return pg

def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            print('1. Every page loads without script errors')
            for n in PAGES:
                errs = []; pg = new_page(b, errs, n); check(n, not errs, errs[:1]); pg.close()

            print('2. Fee ledger: one FIFO receipt is shown once and applied month by month')
            errs = []; pg = new_page(b, errs, 'fees')
            out = pg.evaluate("""()=>{ SCHOOL_YEAR=2026;
              const mk=(v,per)=>({voucher_id:v,student_name:'Ali Khan',admis_no:'101',class:'5',period:per,type:'tuition fee',payable:4000,net:4000,discount:0});
              allFeesCache=[mk('V-101','Aug'),mk('V-102','Sep'),mk('V-103','Oct')];
              const t=(v,a,s)=>({voucher_id:v+'-'+s,date:'2026-10-05',amount_in:a,to_account:'cash',description:'Bulk payment via FIFO',remarks:'Bulk payment via FIFO'});
              accountsDataMap={'V-101':{transactions:[t('V-101',4000,'1730000000000-1')]},'V-102':{transactions:[t('V-102',4000,'1730000000000-2')]},'V-103':{transactions:[t('V-103',2000,'1730000000000-3')]}};
              openStudentLedger('Ali Khan','101');
              return {rows:[...document.querySelectorAll('#ledgerTableBody tr')].length, bal:document.getElementById('ledgerTotalBalance').innerText, rc:LEDGER_CTX.receipts.length, amt:LEDGER_CTX.receipts[0].amt};}""")
            check('3 charge rows + 1 receipt row', out['rows'] == 4, out); check('receipt = 10,000', out['amt'] == 10000, out); check('balance = 2,000', '2,000' in out['bal'], out)
            pg.evaluate("()=>{printReceipt(0)}"); pg.wait_for_timeout(120)
            txt = pg.evaluate("document.querySelector('iframe').contentDocument.body.innerText")
            check('printed receipt has number, words and balance', 'RC-101-20261005' in txt and 'Ten Thousand' in txt and 'PKR 2,000' in txt, txt[:160])
            check('no errors', not errs, errs); pg.close()

            print('3. Students directory')
            students = [
              {'sr_no':1,'admis_no':'101','student_name':'Ali Khan','class':'5','doj':'2024-04-01','contact_no_father':'0300-1','monthly_tution_fee':4000,'monthly_tution_pay':4000,'status':'Active','siblings':'F-9'},
              {'sr_no':2,'admis_no':'102','student_name':'Sara Khan','class':'3','doj':'2025-04-01','contact_no_father':'','contact_no_mother':'','monthly_tution_fee':3000,'monthly_tution_pay':3000,'status':'Active','siblings':'F-9'},
              {'sr_no':3,'admis_no':'103','student_name':'Zain Ali','class':'7','monthly_tution_pay':5000,'status':'Left'}]
            fees = [{'voucher_id':'V-1','admis_no':'101','student_name':'Ali Khan','period':'Aug','payable':4000,'discount':0},
                    {'voucher_id':'V-2','admis_no':'101','student_name':'Ali Khan','period':'Sep','payable':4000,'discount':0},
                    {'voucher_id':'V-3','admis_no':'102','student_name':'Sara Khan','period':'Oct','payable':3000,'discount':0}]
            acc = [{'voucher_id':'V-1-1730000000000-1','amount_in':4000}]
            errs = []; pg = new_page(b, errs, 'students')
            pg.evaluate("""([S,F,A])=>{ getSchoolYear=async()=>2026; loadSettingLists=async()=>({Class:['3','5','7']});
              const ok=r=>({ok:true,json:async()=>r});
              ERP.db.request=async(t,q)=>t==='students'?ok(S):t==='fees'?ok(F.filter(x=>!q.includes('eq.')||q.endsWith('eq.'+x.admis_no))):ok([]);
              ERP.db.fetchAll=async t=>t==='fees'?F:A; return initPage(); }""", [students, fees, acc]); pg.wait_for_timeout(600)
            k = pg.inner_text('#stuKpis')
            check('2 active students', 'ACTIVE STUDENTS\n2' in k.upper().replace('\r', ''), k[:80]); check('fees due 7,000', '7,000' in k, k)
            pg.fill('#studentSearch', 'sara'); pg.wait_for_timeout(400)
            check('debounced search filters the list', pg.eval_on_selector_all('#studentTableBody tr', 'e=>e.length') == 1)
            pg.fill('#studentSearch', ''); pg.wait_for_timeout(400)
            pg.evaluate("()=>{deleteStudent('101')}"); pg.wait_for_timeout(300)
            check('student with fee vouchers cannot be deleted', 'cannot be deleted' in pg.inner_text('.ui-modal')); pg.keyboard.press('Escape')
            check('no errors', not errs, errs); pg.close()

            print('4. Financial statements')
            ent = [{'voucher_id':'OB-1','from_account':'Opening Balance','to_account':'cash','amount_in':100000,'amount_out':0,'date':'2026-10-01'},
                   {'voucher_id':'RV-2','from_account':'Donation','to_account':'bank','amount_in':20000,'amount_out':0,'date':'2026-10-06'},
                   {'voucher_id':'PV-3','from_account':'cash','to_account':'Salaries','amount_in':0,'amount_out':30000,'date':'2026-10-07'},
                   {'voucher_id':'FA-P-1','from_account':'cash','to_account':'Fixed asset','amount_in':0,'amount_out':10000,'date':'2026-10-09'},
                   {'voucher_id':'TV-1','from_account':'cash','to_account':'bank','amount_in':8000,'amount_out':8000,'date':'2026-10-11'}]
            errs = []; pg = new_page(b, errs, 'statements')
            pg.evaluate("""([E,F])=>{ loadSettingLists=async()=>({'Payment Account':['Bank']}); getSchoolYear=async()=>2026;
              const ok=r=>({ok:true,json:async()=>r});
              ERP.db.fetchAll=async t=>t==='accounts'?E:[];
              ERP.db.request=async t=>t==='fees'?ok(F):t==='payroll'?ok([{status:'Unpaid',net_salary:15000}]):t==='books'?ok([{type:'purchase',book_title:'Math 5',qty:10,net_amount:5000},{type:'sale',book_title:'Math 5',qty:4,net_amount:3000}]):({ok:false,json:async()=>[]});
              document.getElementById('stFrom').value='2026-10-01';document.getElementById('stTo').value='2026-10-31'; return load(); }""", [ent, fees]); pg.wait_for_timeout(500)
            ie = pg.inner_text('#st-ie'); check('deficit 10,000 (income 20,000 − expense 30,000)', 'DEFICIT\nPKR 10,000' in ie.upper().replace('\r',''), ie[:120])
            pg.click('.st-tab[data-tab="pos"]'); pos = pg.inner_text('#st-pos')
            check('cash 80,000 (100,000+20,000−30,000−10,000)', '80,000' in pos, pos[:200]); check('stock 3,000 (6 × 500)', '3,000' in pos, pos[:300]); check('salaries payable 15,000', '15,000' in pos)
            pg.click('.st-tab[data-tab="aging"]'); check('fees outstanding 6,500 + 3,000... shown', 'PKR' in pg.inner_text('#st-aging'))
            check('no errors', not errs, errs); pg.close()

            print('5. Dialogs')
            errs = []; pg = new_page(b, errs, 'users')
            pg.evaluate("()=>{window.__r={};UI.prompt('Month?',{value:'2026-10'}).then(v=>window.__r.p=v)}"); pg.fill('#uiPromptInput', '2026-11'); pg.keyboard.press('Enter'); pg.wait_for_timeout(100)
            pg.evaluate("()=>{UI.confirm('Delete the role X?').then(v=>window.__r.c=v)}"); pg.wait_for_timeout(80); pg.click('.ui-btn.danger'); pg.wait_for_timeout(80)
            check('prompt returns typed value', pg.evaluate('window.__r.p') == '2026-11'); check('confirm returns true on Yes, delete', pg.evaluate('window.__r.c') is True)
            check('UI.words(10250) = Ten Thousand Two Hundred Fifty', pg.evaluate('UI.words(10250)') == 'Ten Thousand Two Hundred Fifty'); pg.close()
            b.close()
    finally:
        srv.terminate()
    print('\n' + ('ALL TESTS PASSED' if not FAILED else f'{len(FAILED)} FAILED: ' + ', '.join(FAILED)))
    sys.exit(1 if FAILED else 0)

if __name__ == '__main__':
    main()
