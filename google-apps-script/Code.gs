/**
 * 健康台灣深耕計畫兒童醫院永續發展論壇｜報名資料同步至 Google 試算表
 *
 * 安裝方式（詳見 README.md「Google 雲端硬碟同步」）：
 *   1. 在 Google 雲端硬碟建立一份 Google 試算表
 *   2. 擴充功能 → Apps Script，刪除預設內容，貼上本檔全部內容並儲存
 *   3. 回到試算表重新整理，上方選單出現「論壇報名同步」
 *   4. 依序執行「1. 設定連線」「2. 立即同步」「3. 啟用自動同步」
 *
 * 本程式只讀取報名資料，不會修改網站或資料庫中的任何內容。
 */

const SHEET_DATA = '報名資料';
const SHEET_STATS = '統計摘要';
const SHEET_LOG = '同步紀錄';
const TZ = 'Asia/Taipei';
const AUTO_MINUTES = 5;

const CAT = { vip: '貴賓', speaker: '講者／座長', general: '一般', staff: '工作人員' };
const SRC = { online: '線上報名', import: '名單匯入', walkin: '現場登記', manual: '人工建檔' };
const MEAL = { meat: '葷食', veg: '素食' };
// 身分證字號只同步遮罩（例：A12****789）；完整號碼請由管理後台下載「積分申請名單」
const COLUMNS = [
  ['報到代碼', r => r.code],
  ['姓名', r => r.name],
  ['服務機構', r => r.org],
  ['單位', r => r.dept || ''],
  ['職稱', r => r.title || ''],
  ['聯絡電話', r => r.phone ? "'" + r.phone : ''],
  ['用餐', r => MEAL[r.meal] || ''],
  ['申請積分', r => r.need_credit ? '是' : '否'],
  ['身分證字號（遮罩）', r => r.id_masked || ''],
  ['電子郵件', r => r.email || ''],
  ['類別', r => CAT[r.category] || '一般'],
  ['來源', r => SRC[r.source] || r.source],
  ['報名時間', r => toDate(r.created_at)],
  ['同意個資告知時間', r => toDate(r.consent_at)],
  ['報到狀態', r => r.checked_in_at ? '已報到' : '未報到'],
  ['報到時間', r => toDate(r.checked_in_at)],
  ['備註', r => r.note || ''],
];

/* ---------------- 選單 ---------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('論壇報名同步')
    .addItem('1. 設定連線', 'setupConnection')
    .addItem('2. 立即同步', 'syncNow')
    .addItem('3. 啟用每 ' + AUTO_MINUTES + ' 分鐘自動同步', 'enableAutoSync')
    .addSeparator()
    .addItem('停用自動同步', 'disableAutoSync')
    .addItem('查看目前設定', 'showStatus')
    .addToUi();
}

/* ---------------- 設定 ---------------- */
function setupConnection() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const ask = (title, hint, current) => {
    const r = ui.prompt(title, hint + (current ? '\n\n（留白則沿用目前設定）' : ''), ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) throw new Error('CANCELLED');
    return r.getResponseText().trim() || current || '';
  };
  try {
    const url = ask('Supabase 專案網址', '例：https://abcdefgh.supabase.co\n（Supabase → Project Settings → API → Project URL）', props.getProperty('SUPABASE_URL'));
    const key = ask('Supabase 公開金鑰', '請貼上 anon public key（eyJ 開頭）或 publishable key（sb_publishable_ 開頭）。\n（Supabase → Project Settings → API Keys）\n請勿貼上 service_role 或 secret key。', props.getProperty('SUPABASE_ANON_KEY'));
    const secret = ask('同步金鑰', '請至論壇管理後台 →「報名概況」→「產生同步金鑰」取得，以 sync_ 開頭。', props.getProperty('SYNC_SECRET'));
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) return ui.alert('專案網址格式不正確，應為 https://xxxx.supabase.co');
    if (/service_role|^sb_secret_/i.test(key) || isServiceRoleKey(key)) return ui.alert('偵測到 service_role 或 secret key，基於安全考量不予儲存。請改貼 anon public key 或 publishable key。');
    if (!/^sync_[0-9a-f]{48}$/.test(secret)) return ui.alert('同步金鑰格式不正確，請重新從管理後台複製。');
    props.setProperties({ SUPABASE_URL: url.replace(/\/$/, ''), SUPABASE_ANON_KEY: key, SYNC_SECRET: secret });
    const rows = fetchRegistrations();
    ui.alert('連線成功', '目前共有 ' + rows.length + ' 筆報名資料。\n請接著執行「2. 立即同步」。', ui.ButtonSet.OK);
  } catch (e) {
    if (e.message !== 'CANCELLED') ui.alert('連線失敗', friendly(e), ui.ButtonSet.OK);
  }
}

function isServiceRoleKey(key) {
  try {
    const part = key.split('.')[1];
    const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(part + '==='.slice((part.length + 3) % 4))).getDataAsString();
    return JSON.parse(json).role === 'service_role';
  } catch (e) { return false; }
}

/* ---------------- 同步 ---------------- */
function syncNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  const ss = SpreadsheetApp.getActive();
  const started = new Date();
  try {
    ss.setSpreadsheetTimeZone(TZ);
    const rows = fetchRegistrations();
    writeData(ss, rows);
    writeStats(ss, rows);
    rpc('report_sync', { p_secret: prop('SYNC_SECRET'), p_count: rows.length, p_url: ss.getUrl() });
    log(ss, started, '成功', rows.length + ' 筆');
    if (isManual()) ss.toast('已同步 ' + rows.length + ' 筆報名資料', '論壇報名同步', 5);
  } catch (e) {
    log(ss, started, '失敗', friendly(e));
    if (isManual()) SpreadsheetApp.getUi().alert('同步失敗', friendly(e), SpreadsheetApp.getUi().ButtonSet.OK);
    else throw e;
  } finally {
    lock.releaseLock();
  }
}

function fetchRegistrations() {
  const data = rpc('export_registrations', { p_secret: prop('SYNC_SECRET') });
  if (!Array.isArray(data)) throw new Error('資料格式不正確');
  return data;
}

function writeData(ss, rows) {
  const sh = sheet(ss, SHEET_DATA);
  const values = [COLUMNS.map(c => c[0])].concat(rows.map(r => COLUMNS.map(c => c[1](r))));
  sh.clearContents();
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, values.length, COLUMNS.length).setValues(values);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold').setBackground('#13205A').setFontColor('#FFFFFF');
  COLUMNS.forEach((c, i) => { if (/時間$/.test(c[0])) sh.getRange(2, i + 1, Math.max(rows.length, 1), 1).setNumberFormat('yyyy/mm/dd hh:mm'); });
  sh.getRange(1, 1, values.length, COLUMNS.length).createFilter();
  if (rows.length) sh.autoResizeColumns(1, COLUMNS.length);
  sh.getRange(1, COLUMNS.length + 2).setValue('此工作表每次同步都會整張覆寫，請勿在此編輯；如需註記請另開工作表。').setFontColor('#B25E00');
}

function writeStats(ss, rows) {
  const sh = sheet(ss, SHEET_STATS);
  sh.clear();
  const pre = rows.filter(r => r.source !== 'walkin');
  const checked = pre.filter(r => r.checked_in_at).length;
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');
  const dayOf = r => Utilities.formatDate(new Date(r.created_at), TZ, 'yyyy/MM/dd');
  const out = [];
  const push = (a, b, c) => out.push([a, b === undefined ? '' : b, c === undefined ? '' : c]);

  push('最後同步時間', Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm'));
  push('');
  push('總覽', '人數', '備註');
  push('報名總數（不含現場登記）', pre.length);
  push('其中線上報名', rows.filter(r => r.source === 'online').length);
  push('今日新增', rows.filter(r => r.source === 'online' && dayOf(r) === today).length, today);
  push('已報到', checked, pre.length ? Math.round(checked / pre.length * 1000) / 10 + '%' : '');
  push('現場登記', rows.filter(r => r.source === 'walkin').length);
  push('申請繼續教育積分', pre.filter(r => r.need_credit).length);
  push('');
  push('用餐（含現場登記）', '報名', '已報到');
  [['meat', '葷食'], ['veg', '素食']].forEach(([k, n]) => {
    const x = rows.filter(r => r.meal === k);
    push(n, x.length, x.filter(r => r.checked_in_at).length);
  });
  push('未填', rows.filter(r => !r.meal).length, rows.filter(r => !r.meal && r.checked_in_at).length);
  push('');
  push('依類別', '報名', '已報到');
  Object.keys(CAT).forEach(k => {
    const x = pre.filter(r => r.category === k);
    push(CAT[k], x.length, x.filter(r => r.checked_in_at).length);
  });
  push('');
  push('依服務機構（前 15）', '人數');
  countBy(pre, r => r.org).slice(0, 15).forEach(([k, v]) => push(k, v));
  push('');
  push('每日報名人數', '當日', '累計');
  let cum = 0;
  countBy(pre, dayOf).sort((a, b) => a[0] < b[0] ? -1 : 1).forEach(([k, v]) => { cum += v; push(k, v, cum); });

  sh.getRange(1, 1, out.length, 3).setValues(out);
  out.forEach((r, i) => { if (['總覽', '用餐（含現場登記）', '依類別', '依服務機構（前 15）', '每日報名人數'].indexOf(r[0]) > -1) sh.getRange(i + 1, 1, 1, 3).setFontWeight('bold').setBackground('#EAF2FF'); });
  sh.setColumnWidth(1, 260); sh.setColumnWidths(2, 2, 110);
}

function countBy(rows, fn) {
  const m = {};
  rows.forEach(r => { const k = fn(r) || '（未填）'; m[k] = (m[k] || 0) + 1; });
  return Object.keys(m).map(k => [k, m[k]]).sort((a, b) => b[1] - a[1]);
}

function log(ss, started, status, detail) {
  const sh = sheet(ss, SHEET_LOG);
  if (sh.getLastRow() === 0) sh.appendRow(['同步時間', '結果', '說明', '耗時（秒）']).setFrozenRows(1);
  sh.appendRow([started, status, detail, Math.round((new Date() - started) / 100) / 10]);
  sh.getRange(sh.getLastRow(), 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  const extra = sh.getLastRow() - 501;
  if (extra > 0) sh.deleteRows(2, extra);
}

/* ---------------- 自動同步 ---------------- */
function enableAutoSync() {
  disableAutoSync(true);
  ScriptApp.newTrigger('autoSync').timeBased().everyMinutes(AUTO_MINUTES).create();
  SpreadsheetApp.getUi().alert('已啟用自動同步', '每 ' + AUTO_MINUTES + ' 分鐘會自動更新一次報名資料。\n關閉試算表後仍會持續執行。', SpreadsheetApp.getUi().ButtonSet.OK);
}
function disableAutoSync(silent) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'autoSync').forEach(t => ScriptApp.deleteTrigger(t));
  if (silent !== true) SpreadsheetApp.getUi().alert('已停用自動同步。');
}
function autoSync() { PropertiesService.getScriptProperties().setProperty('_AUTO', '1'); try { syncNow(); } finally { PropertiesService.getScriptProperties().deleteProperty('_AUTO'); } }
function isManual() { return PropertiesService.getScriptProperties().getProperty('_AUTO') !== '1'; }

function showStatus() {
  const p = PropertiesService.getScriptProperties();
  const auto = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'autoSync');
  const s = p.getProperty('SYNC_SECRET') || '';
  SpreadsheetApp.getUi().alert('目前設定',
    '專案網址：' + (p.getProperty('SUPABASE_URL') || '未設定') +
    '\n同步金鑰：' + (s ? s.slice(0, 9) + '…' + s.slice(-4) : '未設定') +
    '\n自動同步：' + (auto ? '已啟用（每 ' + AUTO_MINUTES + ' 分鐘）' : '未啟用'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ---------------- 工具 ---------------- */
function prop(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('尚未設定連線，請先執行「1. 設定連線」');
  return v;
}
function rpc(fn, body) {
  const url = prop('SUPABASE_URL'), key = prop('SUPABASE_ANON_KEY');
  const res = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: /^eyJ/.test(key) ? { apikey: key, Authorization: 'Bearer ' + key } : { apikey: key },
    payload: JSON.stringify(body),
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) throw new Error(text || ('HTTP ' + code));
  return text ? JSON.parse(text) : null;
}
function friendly(e) {
  const m = String(e && e.message || e);
  if (m.indexOf('BAD_SYNC_SECRET') > -1) return '同步金鑰無效或已被更換，請至管理後台重新產生，再執行「1. 設定連線」。';
  if (/Invalid API key|No API key/i.test(m)) return 'anon key 不正確，請重新執行「1. 設定連線」。';
  if (/DNS|Address unavailable|timeout/i.test(m)) return '無法連線到 Supabase，請確認專案網址，或稍後再試（免費方案專案閒置後可能暫停）。';
  return m.slice(0, 300);
}
function toDate(iso) { return iso ? new Date(iso) : ''; }
function sheet(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
