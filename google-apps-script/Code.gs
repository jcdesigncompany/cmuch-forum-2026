/**
 * 健康台灣深耕計畫兒童醫院永續發展論壇｜報名資料同步至 Google 試算表
 *
 * 安裝方式（詳見 README.md「Google 雲端硬碟同步」）：
 *   1. 在 Google 雲端硬碟建立一份 Google 試算表
 *   2. 擴充功能 → Apps Script，刪除預設內容，貼上本檔全部內容並儲存
 *   3. 回到試算表重新整理，上方選單出現「論壇報名同步」
 *   4. 依序執行「1. 設定連線」「2. 立即同步」「3. 啟用自動同步」
 *   5. （選用）執行「4. 啟用報名成功通知信」，自動寄送含報到 QR code 的通知信
 *
 * 本程式讀取報名資料；啟用通知信後，另會在資料庫記錄每位報名者的通知信寄出時間。
 * 通知信由執行本程式的 Google 帳號寄出，建議使用單位公務帳號。
 */

const SHEET_DATA = '報名資料';
const SHEET_STATS = '統計摘要';
const SHEET_LOG = '同步紀錄';
const SCRIPT_VERSION = '2026-09-30 v9（試算表每 4 小時同步；通知信每 15 分鐘檢查）';
const TZ = 'Asia/Taipei';
const SYNC_HOURS = 4;       // 試算表自動同步間隔（小時）
const NOTICE_MINUTES = 15;  // 通知信檢查間隔（分鐘），不寫入試算表；僅可為 1、5、10、15、30
const DEFAULT_SITE_URL = 'https://jcdesigncompany.github.io/cmuch-forum-2026/';
const QR_LIB_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const SENDER_NAME = '中國醫藥大學兒童醫院';
const NOTIFY_PER_RUN = 40;
// 通知信預設文字（與網站後台「報名成功通知信」的預設相同）
const MAIL_DEFAULT = {
  mailSubject: '【報名成功】{活動名稱}　報到代碼 {報到代碼}',
  mailIntro: '感謝您報名本論壇，您的報名已完成。活動當天請於報到處出示下方 QR code，即可快速完成報到。',
  mailNotes: '建議將本信或 QR code 截圖保存，當天網路不穩時也能出示。\nQR code 僅供本人報到使用，請勿轉傳。\n如需查詢報到證，也可至活動網站「查詢報到證」輸入姓名與電話。',
  mailClosing: '',
};

const CAT = { vip: '貴賓', speaker: '講者／座長', general: '一般', staff: '工作人員' };
const SRC = { online: '線上報名', import: '名單匯入', walkin: '現場登記', manual: '人工建檔' };
const MEAL = { meat: '葷食', veg: '素食' };
const TRANSPORT = { car: '自行開車', hsr: '搭乘高鐵', other: '其他' };
const ARRIVE = { before11: '11:00 以前', '1100-1130': '11:00–11:30', '1130-1200': '11:30–12:00', after12: '12:00 以後' };
const yn = (r, k) => r.transport === 'hsr' ? (r[k] ? '是' : '否') : '';
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
  ['交通方式', r => TRANSPORT[r.transport] || ''],
  ['車牌號碼', r => r.car_plate || ''],
  ['高鐵起站', r => r.hsr_from || ''],
  ['接駁去程', r => yn(r, 'shuttle_to')],
  ['接駁回程', r => yn(r, 'shuttle_back')],
  ['預計抵達台中站', r => ARRIVE[r.hsr_arrive] || ''],
  ['類別', r => CAT[r.category] || '一般'],
  ['來源', r => SRC[r.source] || r.source],
  ['報名時間', r => toDate(r.created_at)],
  ['同意個資告知時間', r => toDate(r.consent_at)],
  ['報到狀態', r => r.checked_in_at ? '已報到' : '未報到'],
  ['報到時間', r => toDate(r.checked_in_at)],
  ['通知信寄出時間', r => toDate(r.notified_at)],
  ['備註', r => r.note || ''],
];

/* ---------------- 選單 ---------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('論壇報名同步')
    .addItem('1. 設定連線', 'setupConnection')
    .addItem('2. 立即同步', 'syncNow')
    .addItem('3. 啟用每 ' + SYNC_HOURS + ' 小時自動同步', 'enableAutoSync')
    .addItem('4. 啟用報名成功通知信', 'enableNotify')
    .addSeparator()
    .addItem('寄送測試通知信給我', 'sendTestNotice')
    .addItem('停用報名成功通知信', 'disableNotify')
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
    runNotices(ss);
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
  push('交通方式', '人數', '備註');
  push('自行開車（停車優免）', pre.filter(r => r.transport === 'car').length);
  const hsr = pre.filter(r => r.transport === 'hsr');
  push('搭乘高鐵', hsr.length, countBy(hsr, r => r.hsr_from).map(x => x[0] + ' ' + x[1]).join('、'));
  push('未填', pre.filter(r => !r.transport).length);
  Object.keys(ARRIVE).forEach(k => push('　接駁去程：' + ARRIVE[k] + ' 抵達', hsr.filter(r => r.shuttle_to && r.hsr_arrive === k).length));
  push('　接駁回程', hsr.filter(r => r.shuttle_back).length);
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
  out.forEach((r, i) => { if (['總覽', '用餐（含現場登記）', '交通方式', '依類別', '依服務機構（前 15）', '每日報名人數'].indexOf(r[0]) > -1) sh.getRange(i + 1, 1, 1, 3).setFontWeight('bold').setBackground('#EAF2FF'); });
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

// 寄送待寄通知信並寫入同步紀錄（僅在有寄信時記錄）
function runNotices(ss) {
  if (PropertiesService.getScriptProperties().getProperty('NOTIFY_ON') !== '1') return;
  try {
    const n = sendPendingNotices();
    if (n.sent || n.failed) log(ss, new Date(), n.failed ? '通知信部分失敗' : '通知信', '寄出 ' + n.sent + ' 封' + (n.failed ? '，失敗 ' + n.failed + ' 封：' + n.error : '') + (n.quotaLeft < 5 ? '（今日寄信額度將用完，其餘明日自動補寄）' : ''));
  } catch (e) { log(ss, new Date(), '通知信失敗', friendly(e)); }
}

/* ---------------- 自動同步 ---------------- */
function enableAutoSync() {
  disableAutoSync(true);
  ScriptApp.newTrigger('autoSync').timeBased().everyHours(SYNC_HOURS).create();
  if (PropertiesService.getScriptProperties().getProperty('NOTIFY_ON') === '1') ensureNoticeTrigger();
  SpreadsheetApp.getUi().alert('已啟用自動同步', '每 ' + SYNC_HOURS + ' 小時會自動更新一次試算表的報名資料。\n關閉試算表後仍會持續執行；需要最新資料時可隨時按「2. 立即同步」。', SpreadsheetApp.getUi().ButtonSet.OK);
}
function disableAutoSync(silent) {
  // 一併移除舊版每 5 分鐘的觸發條件（同為 autoSync）
  deleteTriggers('autoSync');
  if (silent !== true) SpreadsheetApp.getUi().alert('已停用自動同步。');
}
function deleteTriggers(fn) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === fn).forEach(t => ScriptApp.deleteTrigger(t));
}
// 通知信獨立檢查：只查詢是否有新報名需寄信，不更新試算表
function ensureNoticeTrigger() {
  deleteTriggers('autoNotify');
  ScriptApp.newTrigger('autoNotify').timeBased().everyMinutes(NOTICE_MINUTES).create();
}
function autoNotify() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { runNotices(SpreadsheetApp.getActive()); } finally { lock.releaseLock(); }
}
function autoSync() { PropertiesService.getScriptProperties().setProperty('_AUTO', '1'); try { syncNow(); } finally { PropertiesService.getScriptProperties().deleteProperty('_AUTO'); } }
function isManual() { return PropertiesService.getScriptProperties().getProperty('_AUTO') !== '1'; }

function showStatus() {
  const p = PropertiesService.getScriptProperties();
  const has = fn => ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === fn);
  const auto = has('autoSync'), notice = has('autoNotify');
  const s = p.getProperty('SYNC_SECRET') || '';
  SpreadsheetApp.getUi().alert('目前設定',
    '程式版本：' + SCRIPT_VERSION +
    '\n專案網址：' + (p.getProperty('SUPABASE_URL') || '未設定') +
    '\n同步金鑰：' + (s ? s.slice(0, 9) + '…' + s.slice(-4) : '未設定') +
    '\n自動同步：' + (auto ? '已啟用（每 ' + SYNC_HOURS + ' 小時）' : '未啟用') +
    '\n報名成功通知信：' + (p.getProperty('NOTIFY_ON') === '1' ? '已啟用（' + (notice ? '每 ' + NOTICE_MINUTES + ' 分鐘檢查' : '未排程，請重新執行「4. 啟用報名成功通知信」') + '；網站：' + (p.getProperty('SITE_URL') || DEFAULT_SITE_URL) + '）' : '未啟用') +
    '\n今日剩餘寄信額度：' + MailApp.getRemainingDailyQuota() + ' 封',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ---------------- 報名成功通知信 ---------------- */
function enableNotify() {
  const ui = SpreadsheetApp.getUi(), p = PropertiesService.getScriptProperties();
  prop('SYNC_SECRET');
  const cur = p.getProperty('SITE_URL') || DEFAULT_SITE_URL;
  const r = ui.prompt('活動網站網址', '通知信中的「線上報到證」連結會指向此網址。\n目前：' + cur + '\n（留白則沿用）', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  let site = r.getResponseText().trim() || cur;
  if (!/^https:\/\//.test(site)) return ui.alert('網址需以 https:// 開頭。');
  if (!/\/$/.test(site)) site += '/';
  try { rpc('pending_notifications', { p_secret: prop('SYNC_SECRET') }); }
  catch (e) { return ui.alert('尚未完成資料庫設定', '請先在 Supabase 執行 supabase/registration_notify.sql，再啟用通知信。\n\n' + friendly(e), ui.ButtonSet.OK); }
  p.setProperties({ SITE_URL: site, NOTIFY_ON: '1' });
  ensureNoticeTrigger();
  ui.alert('已啟用報名成功通知信',
    '之後每 ' + NOTICE_MINUTES + ' 分鐘會自動寄信給尚未收到通知的線上報名者（此檢查不會更新試算表）。\n' +
    '寄件者：' + Session.getEffectiveUser().getEmail() + '\n今日剩餘寄信額度：' + MailApp.getRemainingDailyQuota() + ' 封\n\n' +
    '建議先執行「寄送測試通知信給我」確認信件內容。', ui.ButtonSet.OK);
}
function disableNotify() {
  PropertiesService.getScriptProperties().deleteProperty('NOTIFY_ON');
  deleteTriggers('autoNotify');
  SpreadsheetApp.getUi().alert('已停用報名成功通知信。報名資料同步不受影響。');
}
function sendTestNotice() {
  const ui = SpreadsheetApp.getUi(), me = Session.getEffectiveUser().getEmail();
  try {
    const content = rpc('public_site_content', {});
    sendNotice({ code: 'TEST01', token: '00000000-0000-0000-0000-000000000000', name: '測試報名者', title: '主治醫師', transport: 'hsr', hsr_from: '台北', shuttle_to: true, shuttle_back: true, hsr_arrive: '1130-1200', org: '中國醫藥大學兒童醫院', email: me }, content, true);
    ui.alert('測試信已寄出', '已寄到 ' + me + '，請至信箱確認內容與 QR code。', ui.ButtonSet.OK);
  } catch (e) { ui.alert('測試信寄送失敗', friendly(e), ui.ButtonSet.OK); }
}

// 寄出尚未通知的線上報名；每封寄出後立即回報，避免重複寄送
function sendPendingNotices() {
  const out = { sent: 0, failed: 0, error: '', quotaLeft: MailApp.getRemainingDailyQuota() };
  if (out.quotaLeft < 1) return out;
  const list = rpc('pending_notifications', { p_secret: prop('SYNC_SECRET') }) || [];
  if (!list.length) return out;
  // 資料庫尚未更新為回傳職稱的版本時，改由報名資料補上職稱，稱謂才會顯示職稱
  const KEYS = ['title', 'transport', 'car_plate', 'hsr_from', 'hsr_arrive', 'shuttle_to', 'shuttle_back'];
  if (list.some(r => KEYS.some(k => !(k in r)))) {
    const byCode = {};
    fetchRegistrations().forEach(x => { byCode[x.code] = x; });
    list.forEach(r => KEYS.forEach(k => { if (!(k in r)) r[k] = (byCode[r.code] || {})[k] || (k.indexOf('shuttle') === 0 ? false : ''); }));
  }
  const content = rpc('public_site_content', {});
  for (const r of list.slice(0, Math.min(NOTIFY_PER_RUN, out.quotaLeft))) {
    try {
      sendNotice(r, content, false);
      rpc('mark_notified', { p_secret: prop('SYNC_SECRET'), p_code: r.code });
      out.sent++;
    } catch (e) { out.failed++; out.error = friendly(e).slice(0, 120); }
  }
  out.quotaLeft = MailApp.getRemainingDailyQuota();
  return out;
}

function sendNotice(r, content, isTest) {
  const I = (content && content.info) || {};
  const site = PropertiesService.getScriptProperties().getProperty('SITE_URL') || DEFAULT_SITE_URL;
  const title = (I.line1 || '') + (I.line2 || '');
  const ticketUrl = site + 'ticket.html?t=' + encodeURIComponent(r.token);
  const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(I.mapQuery || I.address || '');
  const when = dateZh(I.date) + '　' + (I.start || '') + '–' + (I.end || '');
  const qr = qrBlob(r.code);
  const e = htmlEsc;
  // 信件文字可於網站後台「報名設定 › 報名成功通知信」編輯；未設定時使用預設
  const R = (content && content.registration) || {};
  const salute = (r.name || '') + (r.title ? ' ' + r.title : '');  // 稱謂：姓名＋報名時填寫的職稱
  const fill = s => String(s || '').replace(/\{姓名\}/g, r.name || '').replace(/\{職稱\}/g, r.title || '').replace(/\{服務機構\}/g, r.org || '')
    .replace(/\{報到代碼\}/g, r.code || '').replace(/\{活動名稱\}/g, title);
  const pick = k => (R[k] == null ? MAIL_DEFAULT[k] : R[k]);
  const subject = fill(String(R.mailSubject || '').trim() || MAIL_DEFAULT.mailSubject).replace(/\s*[\r\n]+\s*/g, ' ');
  const intro = fill(pick('mailIntro')).trim();
  const notes = fill(pick('mailNotes')).split('\n').map(s => s.trim()).filter(String);
  const closing = fill(pick('mailClosing')).trim();
  const para = s => e(s).replace(/\n/g, '<br>');
  const row = (k, v) => '<tr><td style="padding:6px 12px 6px 0;color:#5A6788;white-space:nowrap;vertical-align:top">' + k + '</td><td style="padding:6px 0;color:#16203D">' + v + '</td></tr>';
  const contact = [I.contactName, I.contactPhone, I.contactEmail].filter(String).map(e).join('　');
  const html =
    '<div style="background:#F6F8FC;padding:24px 12px;font-family:\'Noto Sans TC\',\'Microsoft JhengHei\',\'PingFang TC\',sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #DCE4F2;border-radius:14px;overflow:hidden">' +
    '<div style="background:#13205A;color:#fff;padding:20px 24px"><div style="font-size:13px;color:#C9D6F5">' + e(I.organizer || SENDER_NAME) + '</div>' +
    '<div style="font-size:20px;font-weight:700;line-height:1.4;margin-top:4px">' + e(title) + '</div></div>' +
    '<div style="padding:24px">' +
    (isTest ? '<p style="background:#FFF3E3;color:#8A4B00;padding:8px 12px;border-radius:8px;font-size:13px">這是測試信，報到代碼與連結僅供確認版面。程式版本：' + e(SCRIPT_VERSION) + '</p>' : '') +
    '<p style="font-size:16px;color:#16203D;margin:0 0 12px">' + e(salute) + ' 您好：</p>' +
    (intro ? '<p style="font-size:15px;color:#16203D;line-height:1.7;margin:0 0 16px">' + para(intro) + '</p>' : '') +
    '<div style="text-align:center;border:1px dashed #DCE4F2;border-radius:12px;padding:18px 12px;margin:0 0 18px">' +
    '<img src="cid:qr" width="220" height="220" alt="報到 QR code" style="display:block;margin:0 auto">' +
    '<div style="font-size:13px;color:#5A6788;margin-top:10px">報到代碼</div>' +
    '<div style="font-size:26px;font-weight:700;letter-spacing:4px;color:#13205A;font-family:Consolas,monospace">' + e(r.code) + '</div></div>' +
    '<table style="border-collapse:collapse;font-size:15px;line-height:1.5;margin:0 0 18px">' +
    row('姓名', e(r.name)) + (r.title ? row('職稱', e(r.title)) : '') + row('服務機構', e(r.org || '')) + row('日期時間', e(when)) +
    (I.checkin ? row('報到時間', e(I.checkin) + ' 起開放報到') : '') +
    row('地點', e(I.venue || '') + (I.address ? '<br><span style="color:#5A6788;font-size:13px">' + e(I.address) + '</span>' : '')) +
    (trLine(r) ? row('交通', e(trLine(r))) : '') +
    row('活動官網', '<a href="' + e(site) + '" style="color:#1C6DF2;word-break:break-all">' + e(site) + '</a><br><span style="color:#5A6788;font-size:13px">議程、講者、交通與會場導引</span>') +
    '</table>' +
    '<p style="margin:0 0 20px"><a href="' + e(ticketUrl) + '" style="display:inline-block;background:#1C6DF2;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">開啟線上報到證</a>' +
    '　<a href="' + e(mapUrl) + '" style="color:#1C6DF2">Google 地圖</a></p>' +
    (notes.length ? '<ul style="font-size:13px;color:#5A6788;line-height:1.7;padding-left:18px;margin:0 0 16px">' +
      notes.map(n => '<li>' + e(n) + '</li>').join('') + '</ul>' : '') +
    (closing ? '<p style="font-size:15px;color:#16203D;line-height:1.7;margin:0 0 16px">' + para(closing) + '</p>' : '') +
    (contact ? '<p style="font-size:13px;color:#5A6788;margin:0">聯絡窗口：' + contact + '</p>' : '') +
    '</div>' +
    '<div style="background:#F6F8FC;color:#8A96B5;font-size:12px;padding:12px 24px;line-height:1.6">本信件由報名系統自動寄出。' + e(I.funding || '') + '</div>' +
    '</div></div>';
  const text = salute + ' 您好：\n\n' + (intro ? intro + '\n\n' : '') + '報到代碼：' + r.code + '\n日期時間：' + when +
    '\n地點：' + (I.venue || '') + ' ' + (I.address || '') + (trLine(r) ? '\n交通：' + trLine(r) : '') + '\n線上報到證（含 QR code）：' + ticketUrl + '\n活動官網（議程、講者、交通）：' + site +
    (notes.length ? '\n\n' + notes.map(n => '・' + n).join('\n') : '') + (closing ? '\n\n' + closing : '') + '\n\n本信件由報名系統自動寄出。';
  const opt = { name: SENDER_NAME, htmlBody: html, inlineImages: { qr: qr } };
  if (I.contactEmail) opt.replyTo = I.contactEmail;
  MailApp.sendEmail(r.email, (isTest ? '【測試】' : '') + subject, text, opt);
}

// 以 qrcode-generator 於本程式內產生 QR code（報到代碼不會傳給第三方服務）
function qrBlob(code) {
  const cache = CacheService.getScriptCache();
  let src = cache.get('qrlib');
  if (!src) { src = UrlFetchApp.fetch(QR_LIB_URL).getContentText(); if (src.length < 95000) cache.put('qrlib', src, 21600); }
  const qrcode = new Function(src + '\n;return qrcode;')();
  const q = qrcode(0, 'M'); q.addData(String(code)); q.make();
  const n = q.getModuleCount(), cell = Math.max(4, Math.floor(220 / (n + 8)));
  const b64 = q.createDataURL(cell, cell * 4).split(',')[1];
  return Utilities.newBlob(Utilities.base64Decode(b64), 'image/gif', 'qr.gif');
}

function trLine(r) {
  if (r.transport === 'car') return '自行開車' + (r.car_plate ? '（車牌 ' + r.car_plate + '）' : '') + '，停車優免方式將另行通知';
  if (r.transport === 'hsr') {
    const s = [r.shuttle_to ? '去程' : '', r.shuttle_back ? '回程' : ''].filter(String).join('、');
    return '搭乘高鐵（' + (r.hsr_from || '') + '站出發）' + (s ? '，免費接駁：' + s + (r.hsr_arrive ? '（預計 ' + (ARRIVE[r.hsr_arrive] || '') + ' 抵達台中站）' : '') + '。抵達後請至高鐵台中站 1F 7號出口載客區等候接駁車，至會場約 30–40 分鐘，發車時間將另行通知' : '');
  }
  return r.transport === 'other' ? '其他' : '';
}
function dateZh(iso) {
  if (!iso) return '';
  const p = String(iso).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return p[0] + '年' + p[1] + '月' + p[2] + '日（' + '日一二三四五六'[d.getUTCDay()] + '）';
}
function htmlEsc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

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
