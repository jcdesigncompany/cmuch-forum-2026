import { sb, configured, secretKeyError, configProblem, MEAL, validTwId, esc, $, $$, CAT, TRACKS, dateZh, toMin, tpTime, tpStamp, toast, loadContent, drawQR, ticketCard, downloadCanvas, downloadText, loadScript, JSQR_LIB, ZIP_LIB, errMsg } from "./common.js";

const app = $("#app");
const ROLE_NAME = { admin: "管理者", checkin: "報到人員", viewer: "檢視者", pending: "待審核", none: "未授權" };
const st = {
  session: null, role: "none", me: null, tab: "scan", authMode: "login", authMsg: null,
  regs: [], staff: [], names: {}, last: null, q: "", filter: "all", mq: "", cam: null, camErr: "",
  C: null, cDirty: false, cSec: "info", cUpdated: null, importRows: null, busy: false, recovery: false,
};

/* =================== 登入 =================== */
function authView() {
  const m = st.authMode, msg = st.authMsg;
  if (st.recovery) return `<div class="login"><div class="panel"><h1>設定新密碼</h1><p class="hint">請輸入至少 8 個字元的新密碼。</p>
    ${msg ? `<div class="msg ${msg.ok ? "ok" : "err"}">${esc(msg.t)}</div>` : ""}
    <form id="f-newpw"><label class="field"><span>新密碼</span><input name="pw" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn pri" style="width:100%">更新密碼</button></form></div></div>`;
  return `<div class="login"><div class="panel">
    <h1>論壇管理後台</h1><p class="hint" style="margin:0">工作人員專用。報名來賓請至 <a href="register.html">線上報名</a>。</p>
    <div class="sw" role="group"><button data-auth="login" aria-pressed="${m === "login"}">登入</button><button data-auth="signup" aria-pressed="${m === "signup"}">申請帳號</button><button data-auth="reset" aria-pressed="${m === "reset"}">忘記密碼</button></div>
    ${msg ? `<div class="msg ${msg.ok ? "ok" : "err"}" role="alert">${esc(msg.t)}</div>` : ""}
    <form id="f-auth">
      ${m === "signup" ? `<label class="field"><span>姓名</span><input name="dn" required autocomplete="name"></label>` : ""}
      <label class="field"><span>電子郵件</span><input name="email" type="email" required autocomplete="email"></label>
      ${m !== "reset" ? `<label class="field"><span>密碼</span><input name="pw" type="password" required minlength="8" autocomplete="${m === "signup" ? "new-password" : "current-password"}"></label>` : ""}
      <button class="btn pri" style="width:100%">${{ login: "登入", signup: "送出申請", reset: "寄送重設密碼信" }[m]}</button>
    </form>
    ${m === "signup" ? `<p class="hint">申請後需由管理者核定權限才能使用。請使用醫院電子郵件。</p>` : ""}
  </div></div>`;
}
async function onAuthSubmit(f) {
  const d = Object.fromEntries(new FormData(f)), btn = f.querySelector("button");
  btn.disabled = true;
  try {
    if (st.authMode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email: d.email, password: d.pw });
      if (error) throw error;
    } else if (st.authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email: d.email, password: d.pw, options: { data: { display_name: d.dn }, emailRedirectTo: location.href.split("#")[0] } });
      if (error) throw error;
      st.authMsg = { ok: true, t: data.session ? "申請完成，請等待管理者核定權限。" : "申請已送出，請至信箱點選驗證連結，再等待管理者核定權限。" };
      st.authMode = "login"; renderAuth();
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(d.email, { redirectTo: location.href.split("#")[0] });
      if (error) throw error;
      st.authMsg = { ok: true, t: "若此電子郵件已註冊，將收到重設密碼信件。" }; renderAuth();
    }
  } catch (e) { st.authMsg = { ok: false, t: errMsg(e) }; renderAuth(); }
  finally { btn.disabled = false; }
}
function renderAuth() { app.innerHTML = authView(); }

/* =================== 資料 =================== */
async function loadRole() {
  const { data, error } = await sb.from("staff_roles").select("role,display_name,email").eq("user_id", st.me).maybeSingle();
  if (error) throw new Error("讀取帳號權限失敗：" + (error.message || error.code) + "。請確認已在 Supabase 執行最新版 schema.sql。");
  st.role = data ? data.role : "none";
  st.myName = data ? (data.display_name || data.email) : "";
}
async function loadRegs() {
  if (!["viewer", "checkin", "admin"].includes(st.role)) return;
  const all = []; let from = 0;
  for (;;) {
    const { data, error } = await sb.from("registrations").select("*").order("created_at").range(from, from + 999);
    if (error) { toast(errMsg(error)); break; }
    all.push(...data); if (data.length < 1000) break; from += 1000;
  }
  st.regs = all;
}
async function loadStaff() {
  const { data } = await sb.from("staff_roles").select("*").order("created_at");
  st.staff = data || [];
  st.staff.forEach(s => { st.names[s.user_id] = s.display_name || s.email; });
}
let reloadT = null;
async function loadSync() {
  const { data } = await sb.from("sync_status").select("last_sync_at,last_count,sheet_url,secret_created_at").eq("id", 1).maybeSingle();
  st.sync = data || null;
}
function scheduleReload() { clearTimeout(reloadT); reloadT = setTimeout(async () => { await Promise.all([loadRegs(), loadSync()]); if (!busyTyping()) render(); }, 400); }
function busyTyping() { const a = document.activeElement; return st.tab === "content" && a && /INPUT|TEXTAREA|SELECT/.test(a.tagName); }
function subscribe() {
  sb.channel("regs").on("postgres_changes", { event: "*", schema: "public", table: "registrations" }, scheduleReload).subscribe();
  setInterval(scheduleReload, 30000);
}
const byCode = code => st.regs.find(r => r.code === code);
const canCheck = () => st.role === "admin" || st.role === "checkin";
const isAdmin = () => st.role === "admin";

/* =================== 版面 =================== */
function counts() {
  const pre = st.regs.filter(r => r.source !== "walkin");
  const c = { total: pre.length, inn: pre.filter(r => r.checked_in_at).length, walk: st.regs.filter(r => r.source === "walkin").length, cat: {} };
  Object.keys(CAT).forEach(k => { const x = pre.filter(r => r.category === k); c.cat[k] = { t: x.length, i: x.filter(r => r.checked_in_at).length }; });
  return c;
}
function tabsFor() {
  const t = [];
  if (canCheck()) t.push(["scan", "現場報到"]);
  t.push(["overview", "報名概況"], ["list", "報名名單"], ["stats", "報到統計"]);
  if (isAdmin()) t.push(["content", "網站內容"], ["import", "匯入與匯出"], ["staff", "人員權限"]);
  return t;
}
function render() {
  if (!st.session) return renderAuth();
  if (!["viewer", "checkin", "admin"].includes(st.role)) {
    app.innerHTML = `<div class="gate"><h2>帳號待核定</h2><p>您的帳號（${esc(st.session.user.email)}）已建立，請聯絡活動管理者核定權限後重新整理此頁。</p><button class="btn" data-act="logout">登出</button></div>`;
    return;
  }
  const tabs = tabsFor(); if (st.tab !== "account" && !tabs.some(t => t[0] === st.tab)) st.tab = tabs[0][0];
  const c = counts(), ae = document.activeElement, keep = ae && ae.id, pos = ae && ae.selectionStart;
  const evName = st.C ? st.C.info.line1 + st.C.info.line2 : "兒童醫院永續發展論壇";
  app.innerHTML = `<header class="top"><div class="in"><h1>${esc(evName)}<small>管理後台｜<a class="lk" href="index.html" target="_blank" rel="noopener">檢視活動網站</a></small></h1>
    <span class="tally">已報到 <b>${c.inn}</b> / ${c.total}${c.walk ? `　現場登記 ${c.walk}` : ""}</span><span class="role">${ROLE_NAME[st.role]}</span><button class="acct" data-act="account" title="變更密碼">${esc(st.myName || "我的帳號")}</button><button class="acct out" data-act="logout">登出</button></div></header>
    <nav class="tabs"><div class="in" role="tablist">${tabs.map(t => `<button role="tab" data-tab="${t[0]}" aria-selected="${st.tab === t[0]}">${t[1]}</button>`).join("")}</div></nav>
    <main>${({ scan: scanView, list: listView, stats: statsView, overview: overviewView, content: contentView, import: importView, staff: staffView, account: accountView })[st.tab](c)}</main>`;
  if (st.tab === "scan" && st.cam) { const v = $("#camv"); if (v) { v.srcObject = st.cam.stream; v.play().catch(() => {}); } }
  if (keep) { const el = document.getElementById(keep); if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch {} } }
  else if (st.tab === "scan" && !st.cam) { const ci = $("#code"); if (ci) ci.focus(); }
}
const catTag = k => `<span class="cat ${esc(k)}">${esc(CAT[k] || "一般")}</span>`;

/* =================== 報到 =================== */
function resultHTML() {
  const r = st.last;
  if (!r) return '<div class="result idle"><div><b>請掃描來賓報到證</b><br>掃描槍、鏡頭或手動輸入代碼皆可</div></div>';
  const who = r.name ? `<div class="nm">${esc(r.name)}${r.title ? `<small>${esc(r.title)}</small>` : ""}</div><div class="og">${esc(r.org || "")}${r.dept ? "　" + esc(r.dept) : ""}${catTag(r.category)}</div>${r.meal ? `<div class="mealtag ${r.meal}">餐點：${esc(MEAL[r.meal])}</div>` : ""}` : "";
  if (r.status === "ok") return `<div class="result ok" role="status"><div class="st">✓ 報到成功　<span class="num">${esc(tpTime(r.checked_in_at))}</span></div>${who}${r.category === "vip" ? '<div class="vipcall">貴賓到場，請通知接待人員</div>' : r.category === "speaker" ? '<div class="vipcall">講者到場，請引導至講者席</div>' : ""}</div>`;
  if (r.status === "dup") return `<div class="result warn" role="status"><div class="st">! 已於 <span class="num">${esc(tpTime(r.checked_in_at))}</span> 完成報到</div>${who}</div>`;
  return `<div class="result err" role="alert"><div class="st">✕ 查無此代碼</div><div class="nm num">${esc(r.code)}</div><div class="og">請確認代碼，或改用右側姓名搜尋</div></div>`;
}
function scanView() {
  const mq = st.mq.trim().toLowerCase();
  const m = mq ? st.regs.filter(r => (r.name + r.org + (r.dept || "") + r.code + (r.phone || "")).toLowerCase().includes(mq)).slice(0, 12) : [];
  return `<div class="cols"><div class="stack"><section class="panel"><h2>掃描報到</h2>
    <form class="scan" id="scanform" autocomplete="off"><label class="sr" for="code">報到代碼</label><input id="code" placeholder="掃描或輸入代碼" enterkeyhint="go"><button class="btn pri big" type="submit">報到</button></form>
    <p class="hint">使用條碼掃描槍時，游標停在輸入框即可連續掃描。</p>
    <div class="scan" style="margin-top:12px">${st.cam ? '<button class="btn" data-act="camoff">關閉鏡頭</button>' : '<button class="btn" data-act="camon">使用鏡頭掃描</button>'}</div>
    ${st.cam ? '<div class="cam"><video id="camv" playsinline muted></video><div class="frame"></div></div>' : ""}
    ${st.camErr ? `<p class="hint" style="color:var(--red)">${esc(st.camErr)}</p>` : ""}
    </section><section>${resultHTML()}</section></div>
    <div class="stack"><section class="panel"><h2>姓名搜尋</h2><div class="tools"><input type="search" id="mq" placeholder="輸入姓名、機構、電話或代碼" value="${esc(st.mq)}"></div>
    ${mq ? (m.length ? `<ul class="list">${m.map(r => `<li><div class="who"><b>${esc(r.name)}</b> ${esc(r.title || "")}${catTag(r.category)}<span>${esc(r.org)}${r.dept ? "　" + esc(r.dept) : ""}${r.meal ? "｜" + esc(MEAL[r.meal]) : ""}</span></div>${r.checked_in_at ? `<span class="ok-t num">✓ ${esc(tpTime(r.checked_in_at))}</span>` : `<button class="btn sm pri" data-checkin="${esc(r.code)}">報到</button>`}</li>`).join("")}</ul>` : '<div class="empty">找不到符合的來賓，可使用下方現場登記。</div>') : '<p class="hint">來賓忘記攜帶報到證時使用。</p>'}
    </section><section class="panel"><details class="walk"><summary>現場登記（未事先報名）</summary><form id="walkform" style="margin-top:12px"><div class="row2"><label class="field"><span>姓名</span><input name="name" required maxlength="60"></label><label class="field"><span>職稱</span><input name="title" maxlength="60"></label></div><div class="row2"><label class="field"><span>服務機構</span><input name="org" required maxlength="120"></label><label class="field"><span>單位</span><input name="dept" maxlength="120"></label></div><label class="field"><span>用餐習慣</span><select name="meal"><option value="meat">葷食</option><option value="veg">素食</option><option value="">不用餐／未知</option></select></label><button class="btn pri" type="submit">登記並報到</button></form></details></section></div></div>`;
}
async function checkIn(raw) {
  const code = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return;
  const { data, error } = await sb.rpc("check_in", { p_code: code });
  if (error) { toast(errMsg(error)); return; }
  st.last = data; beep(data.status === "ok");
  if (data.status === "ok") { const r = byCode(code); if (r) { r.checked_in_at = data.checked_in_at; r.checked_in_by = st.me; } }
  render();
}
async function undo(code) {
  const r = byCode(code); if (!confirm(`確定取消「${r ? r.name : code}」的報到紀錄？`)) return;
  const { error } = await sb.rpc("undo_check_in", { p_code: code });
  if (error) return toast(errMsg(error));
  if (r) { r.checked_in_at = null; r.checked_in_by = null; } toast("已取消報到"); render();
}
function beep(ok) { try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return; const a = beep.c || (beep.c = new C()); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = ok ? 1320 : 330; g.gain.value = .08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + (ok ? .12 : .3)); } catch {} }

async function camOn() {
  st.camErr = "";
  if (!navigator.mediaDevices?.getUserMedia) { st.camErr = "此裝置或瀏覽器不支援鏡頭掃描，請改用掃描槍或手動輸入。"; return render(); }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); }
  catch { st.camErr = "無法開啟鏡頭，請確認已允許瀏覽器使用相機。"; return render(); }
  let det = null;
  try { if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("qr_code")) det = new BarcodeDetector({ formats: ["qr_code"] }); } catch {}
  if (!det) { try { await loadScript(JSQR_LIB, () => !!window.jsQR); } catch { stream.getTracks().forEach(t => t.stop()); st.camErr = "無法載入掃描元件，請改用掃描槍或手動輸入。"; return render(); } }
  st.cam = { stream, det, last: "", lastAt: 0 }; render(); loop();
}
function camOff() { if (st.cam) { st.cam.stream.getTracks().forEach(t => t.stop()); st.cam = null; } render(); }
const cvs = document.createElement("canvas");
async function loop() {
  const cam = st.cam; if (!cam) return; const v = $("#camv");
  if (v && v.readyState >= 2) {
    let code = null;
    try {
      if (cam.det) { const r = await cam.det.detect(v); if (r[0]) code = r[0].rawValue; }
      else { const sc = Math.min(1, 640 / v.videoWidth); cvs.width = v.videoWidth * sc; cvs.height = v.videoHeight * sc; const x = cvs.getContext("2d", { willReadFrequently: true }); x.drawImage(v, 0, 0, cvs.width, cvs.height); const d = x.getImageData(0, 0, cvs.width, cvs.height); const q = window.jsQR(d.data, d.width, d.height, { inversionAttempts: "dontInvert" }); if (q) code = q.data; }
    } catch {}
    const now = Date.now();
    if (code && (code !== cam.last || now - cam.lastAt > 4000)) { cam.last = code; cam.lastAt = now; checkIn(code); }
  }
  setTimeout(() => requestAnimationFrame(loop), 180);
}

/* =================== 名單 =================== */
function listRows() {
  const q = st.q.trim().toLowerCase(), o = { vip: 0, speaker: 1, general: 2, staff: 3 };
  return st.regs.filter(r => {
    if (st.filter === "in" && !r.checked_in_at) return false;
    if (st.filter === "out" && r.checked_in_at) return false;
    if (st.filter === "vip" && !["vip", "speaker"].includes(r.category)) return false;
    if (st.filter === "walk" && r.source !== "walkin") return false;
    if (st.filter === "veg" && r.meal !== "veg") return false;
    if (st.filter === "credit" && !r.need_credit) return false;
    return !q || (r.name + r.org + (r.dept || "") + (r.title || "") + r.code + (r.email || "") + (r.phone || "")).toLowerCase().includes(q);
  }).sort((a, b) => (o[a.category] - o[b.category]) || a.org.localeCompare(b.org, "zh-Hant") || a.name.localeCompare(b.name, "zh-Hant"));
}
function listView() {
  const rows = listRows(), f = [["all", "全部"], ["in", "已報到"], ["out", "未報到"], ["vip", "貴賓與講者"], ["veg", "素食"], ["credit", "申請積分"], ["walk", "現場登記"]];
  const body = rows.length ? `<div class="tblw"><table class="tbl"><thead><tr><th>代碼</th><th>姓名</th><th class="hide-s">機構／單位／職稱</th><th>用餐</th><th class="hide-s">積分</th>${isAdmin() ? '<th class="hide-s">類別</th>' : ""}<th>狀態</th><th></th></tr></thead><tbody>${rows.map(r => `<tr>
    <td class="code">${esc(r.code)}</td><td><b>${esc(r.name)}</b>${isAdmin() ? "" : catTag(r.category)}${r.source === "walkin" ? '<span class="cat general">現場</span>' : ""}</td>
    <td class="hide-s">${esc(r.org)}${r.dept ? "　" + esc(r.dept) : ""}${r.title ? "　" + esc(r.title) : ""}${r.phone ? `<div class="hint" style="margin:0">${esc(r.phone)}</div>` : ""}</td>
    <td>${r.meal ? `<span class="mealtag ${r.meal} sm">${esc(MEAL[r.meal])}</span>` : '<span class="no-t">—</span>'}</td>
    <td class="hide-s">${r.need_credit ? `<span class="num" title="身分證字號（遮罩）">${esc(r.id_masked || "申請")}</span>` : '<span class="no-t">—</span>'}</td>
    ${isAdmin() ? `<td class="hide-s"><select data-cat="${esc(r.id)}" aria-label="類別">${Object.keys(CAT).map(k => `<option value="${k}"${r.category === k ? " selected" : ""}>${CAT[k]}</option>`).join("")}</select></td>` : ""}
    <td>${r.checked_in_at ? `<span class="ok-t num">✓ ${esc(tpTime(r.checked_in_at))}</span>` : '<span class="no-t">未報到</span>'}</td>
    <td class="acts">${canCheck() ? (r.checked_in_at ? `<button class="btn sm" data-undo="${esc(r.code)}">取消報到</button>` : `<button class="btn sm pri" data-checkin="${esc(r.code)}">報到</button>`) : ""}${isAdmin() ? ` <button class="btn sm" data-qr="${esc(r.code)}">QR</button> <button class="btn sm danger" data-del="${esc(r.id)}" aria-label="刪除">刪除</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">${st.regs.length ? "沒有符合條件的資料。" : "尚無報名資料。"}</div>`;
  return `<h2>報名名單</h2><div class="tools"><input type="search" id="lq" placeholder="搜尋姓名、機構、單位、電話或代碼" value="${esc(st.q)}"><div class="seg">${f.map(x => `<button data-filter="${x[0]}" aria-pressed="${st.filter === x[0]}">${x[1]}</button>`).join("")}</div>${isAdmin() ? '<button class="btn sm" data-act="csv">下載 CSV</button>' : ""}</div><p class="hint" style="margin:-6px 0 12px">共 ${rows.length} 筆</p>${body}`;
}
function showQR(code) {
  const r = byCode(code); if (!r) return;
  const m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="報到證"><h3>${esc(r.name)} ${esc(r.title || "")}</h3><div class="hint" style="margin:0">${esc(r.org)}</div><div id="qrslot"></div><div class="num" style="font-size:20px;font-weight:700">${esc(code)}</div><div class="tools" style="justify-content:center;margin:16px 0 0"><button class="btn pri" data-dlqr>下載圖檔</button><button class="btn" data-close>關閉</button></div></div>`;
  $("#qrslot", m).appendChild(drawQR(code, 480));
  m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) m.remove(); else if (e.target.closest("[data-dlqr]")) downloadCanvas(card(r), `${code}_${r.name}.png`); });
  document.body.appendChild(m); $("[data-close]", m).focus();
}
const card = r => ticketCard(r.code, r, st.C ? st.C.info.line1 + st.C.info.line2 : "", st.C ? dateZh(st.C) : "");

/* =================== 統計 =================== */
/* =================== 報名概況 =================== */
const tpDay = iso => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
function countBy(rows, fn) { const m = new Map(); rows.forEach(r => { const k = fn(r) || "（未填）"; m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); }
function hbars(pairs, total, label) {
  if (!pairs.length) return '<div class="empty">尚無資料。</div>';
  const max = Math.max(...pairs.map(p => p[1]));
  return `<ul class="hbars" aria-label="${esc(label)}">${pairs.map(([k, v]) => `<li title="${esc(k)}：${v} 人（${total ? Math.round(v / total * 100) : 0}%）"><span class="k">${esc(k)}</span><span class="t"><i style="width:${max ? v / max * 100 : 0}%"></i></span><span class="v num">${v}</span></li>`).join("")}</ul>`;
}
function dailyChart(rows) {
  if (!rows.length) return '<div class="empty">開放報名後，每日報名人數會顯示在這裡。</div>';
  const today = tpDay(new Date().toISOString());
  const first = rows.reduce((m, r) => tpDay(r.created_at) < m ? tpDay(r.created_at) : m, today);
  const days = []; let d = new Date(first + "T00:00:00Z");
  const end = new Date(today + "T00:00:00Z");
  while (d <= end) { days.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 864e5); }
  const shown = days.slice(-30), m = new Map(countBy(rows, r => tpDay(r.created_at)));
  const vals = shown.map(k => m.get(k) || 0), max = Math.max(1, ...vals);
  let cum = rows.filter(r => tpDay(r.created_at) < shown[0]).length;
  const W = 640, H = 200, pl = 34, pb = 26, pt = 10, bw = (W - pl) / shown.length, gap = Math.min(4, bw * 0.25);
  const step = Math.max(1, Math.ceil(max / 4)), ticks = []; for (let v = 0; v <= max; v += step) ticks.push(v);
  const y = v => pt + (H - pt - pb) * (1 - v / (ticks[ticks.length - 1] || 1));
  const every = Math.ceil(shown.length / 7);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 ${shown.length} 日每日報名人數">
    ${ticks.map(v => `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join("")}
    ${shown.map((k, i) => { cum += vals[i]; const x = pl + i * bw + gap / 2, h = H - pb - y(vals[i]), w = bw - gap;
      return `<g class="col"><rect class="hit" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}"/>${vals[i] ? `<path class="mk" d="M${x},${H - pb} V${y(vals[i]) + Math.min(4, h)} q0,-4 4,-4 h${Math.max(0, w - 8)} q4,0 4,4 V${H - pb} Z"/>` : ""}
      <title>${k.slice(5).replace("-", "/")}：${vals[i]} 人（累計 ${cum} 人）</title>${i % every === 0 || i === shown.length - 1 ? `<text x="${x + w / 2}" y="${H - 8}" class="ax" text-anchor="middle">${k.slice(5).replace("-", "/")}</text>` : ""}</g>`; }).join("")}
    <line x1="${pl}" x2="${W}" y1="${H - pb}" y2="${H - pb}" class="base"/></svg>`;
}
function overviewView() {
  const R = (st.C && st.C.registration) || {}, cap = parseInt(R.capacity, 10) || 0;
  const pre = st.regs.filter(r => r.source !== "walkin"), online = st.regs.filter(r => r.source === "online");
  const today = tpDay(new Date().toISOString()), wk = tpDay(new Date(Date.now() - 6 * 864e5).toISOString());
  const nToday = online.filter(r => tpDay(r.created_at) === today).length, nWeek = online.filter(r => tpDay(r.created_at) >= wk).length;
  const latest = online.slice().sort((a, b) => a.created_at < b.created_at ? 1 : -1).slice(0, 8);
  const SRC = { online: "線上報名", import: "名單匯入", manual: "人工建檔" };
  const S = st.sync, stale = S && S.last_sync_at && (Date.now() - new Date(S.last_sync_at)) > 20 * 60e3;
  return `<div class="ovhead"><h2>報名概況</h2><span class="regstate ${R.open ? "on" : ""}">${R.open ? "● 報名開放中" : "○ 報名未開放"}</span>${isAdmin() && st.C ? `<button class="btn sm" data-act="togglereg">${R.open ? "關閉報名" : "開放報名"}</button>` : ""}<a class="btn sm" href="register.html" target="_blank" rel="noopener">檢視報名頁</a></div>
  <dl class="kpis"><div class="kpi"><dt>報名人數${cap ? "／上限" : ""}</dt><dd>${pre.length}${cap ? `<small> / ${cap}</small>` : ""}</dd>${cap ? `<div class="bar"><i style="width:${Math.min(100, pre.length / cap * 100)}%"></i></div>` : ""}</div>
    <div class="kpi"><dt>今日新增（線上）</dt><dd>${nToday}</dd></div><div class="kpi"><dt>近 7 日新增（線上）</dt><dd>${nWeek}</dd></div>
    <div class="kpi"><dt>${cap ? "剩餘名額" : "線上報名累計"}</dt><dd>${cap ? Math.max(0, cap - pre.length) : online.length}</dd></div>
    <div class="kpi"><dt>用餐：葷食／素食</dt><dd>${pre.filter(r => r.meal === "meat").length}<small> / </small>${pre.filter(r => r.meal === "veg").length}</dd>${pre.some(r => !r.meal) ? `<div class="hint" style="margin:2px 0 0">未填 ${pre.filter(r => !r.meal).length} 人</div>` : ""}</div>
    <div class="kpi"><dt>申請繼續教育積分</dt><dd>${pre.filter(r => r.need_credit).length}<small> 人</small></dd></div></dl>
  <div class="cols" style="margin-top:18px"><section class="panel"><h3>每日報名人數</h3><p class="hint" style="margin:-4px 0 8px">含線上報名與名單匯入，最近 30 日；游標移到長條可看累計人數。</p>${dailyChart(pre)}</section>
    <section class="panel"><h3>最新線上報名</h3>${latest.length ? `<ul class="list">${latest.map(r => `<li><div class="who"><b>${esc(r.name)}</b> ${esc(r.title || "")}<span>${esc(r.org)}${r.dept ? "　" + esc(r.dept) : ""}${r.meal ? "｜" + esc(MEAL[r.meal]) : ""}</span></div><span class="hint num" style="margin:0">${esc(tpStamp(r.created_at).replace(/:\d\d$/, ""))}</span></li>`).join("")}</ul>` : '<div class="empty">尚無線上報名。</div>'}</section></div>
  <div class="cols" style="margin-top:18px"><section class="panel"><h3>服務機構（前 10）</h3>${hbars(countBy(pre, r => r.org).slice(0, 10), pre.length, "服務機構")}</section>
    <div class="stack"><section class="panel"><h3>用餐習慣</h3>${hbars([["葷食", pre.filter(r => r.meal === "meat").length], ["素食", pre.filter(r => r.meal === "veg").length], ["未填", pre.filter(r => !r.meal).length]], pre.length, "用餐習慣")}</section>
    <section class="panel"><h3>類別</h3>${hbars(Object.keys(CAT).map(k => [CAT[k], pre.filter(r => r.category === k).length]), pre.length, "類別")}</section>
    <section class="panel"><h3>報名來源</h3>${hbars(Object.keys(SRC).map(k => [SRC[k], pre.filter(r => r.source === k).length]), pre.length, "報名來源")}</section></div></div>
  <section class="panel" style="margin-top:18px"><h3>Google 雲端硬碟同步</h3>
    ${S && S.last_sync_at ? `<p style="margin:0">最後同步：<b class="num">${esc(tpStamp(S.last_sync_at))}</b>（${S.last_count} 筆）${stale ? '　<span style="color:var(--amber);font-weight:700">! 已超過 20 分鐘未同步，請檢查試算表的自動同步設定</span>' : ""}</p>${S.sheet_url ? `<p style="margin:8px 0 0"><a class="btn sm" href="${esc(S.sheet_url)}" target="_blank" rel="noopener">開啟 Google 試算表</a></p>` : ""}`
      : '<p class="hint" style="margin:0">尚未完成同步設定。設定方式請見 README「Google 雲端硬碟同步」。</p>'}
    ${isAdmin() ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><p class="hint" style="margin:0 0 10px">同步金鑰讓 Google 試算表讀取報名資料。${S && S.secret_created_at ? `目前金鑰建立於 ${esc(tpStamp(S.secret_created_at))}。產生新金鑰後，舊金鑰立即失效。` : "尚未產生金鑰。"}</p>
      <div id="secretbox">${st.newSecret ? `<div class="note"><b>請立即複製此金鑰</b>，關閉或重新整理頁面後將無法再次查看。<div class="tools" style="margin:10px 0 0"><input id="secretval" readonly value="${esc(st.newSecret)}" style="flex:1 1 260px;min-height:40px;border:1.5px solid var(--line);border-radius:8px;padding:0 10px;font-family:var(--latin);font-size:13px"><button class="btn sm pri" data-act="copysecret">複製</button></div></div>` : `<button class="btn sm" data-act="rotatesecret">${S && S.secret_created_at ? "產生新同步金鑰" : "產生同步金鑰"}</button>`}</div></div>` : ""}
  </section>`;
}
function statsView(c) {
  const pct = c.total ? Math.round(c.inn / c.total * 1000) / 10 : 0;
  const vips = st.regs.filter(r => ["vip", "speaker"].includes(r.category)).sort((a, b) => (!!a.checked_in_at - !!b.checked_in_at) || a.name.localeCompare(b.name, "zh-Hant"));
  const log = st.regs.filter(r => r.checked_in_at).sort((a, b) => a.checked_in_at < b.checked_in_at ? 1 : -1).slice(0, 12);
  return `<dl class="kpis"><div class="kpi"><dt>已報到／報名</dt><dd>${c.inn}<small> / ${c.total}</small></dd></div><div class="kpi"><dt>報到率</dt><dd>${pct}<small>%</small></dd><div class="bar"><i style="width:${pct}%"></i></div></div><div class="kpi"><dt>尚未報到</dt><dd>${c.total - c.inn}</dd></div><div class="kpi"><dt>現場登記</dt><dd>${c.walk}</dd></div></dl>
  <div class="cols" style="margin-top:18px"><section class="panel"><h3>貴賓與講者到場狀態</h3>${vips.length ? `<ul class="list">${vips.map(r => `<li><div class="who"><b>${esc(r.name)}</b> ${esc(r.title || "")}${catTag(r.category)}<span>${esc(r.org)}</span></div>${r.checked_in_at ? `<span class="ok-t num">✓ ${esc(tpTime(r.checked_in_at))}</span>` : '<span class="no-t">尚未到場</span>'}</li>`).join("")}</ul>` : '<div class="empty">名單中尚無貴賓或講者。管理者可於「報名名單」調整類別。</div>'}</section>
  <div class="stack"><section class="panel"><h3>用餐人數（已報到／報名）</h3>${[["meat", "葷食"], ["veg", "素食"]].map(([k, n]) => { const x = st.regs.filter(r => r.meal === k), i = x.filter(r => r.checked_in_at).length, p = x.length ? Math.round(i / x.length * 100) : 0; return `<div class="catrow"><span>${n}</span><div class="bar"><i style="width:${p}%"></i></div><span class="v">${i} / ${x.length}</span></div>`; }).join("")}<p class="hint" style="margin:6px 0 0">含現場登記；可用於現場餐點發放與追加。</p></section><section class="panel"><h3>各類別報到情形</h3>${Object.keys(CAT).map(k => { const x = c.cat[k], p = x.t ? Math.round(x.i / x.t * 100) : 0; return `<div class="catrow"><span>${CAT[k]}</span><div class="bar"><i style="width:${p}%"></i></div><span class="v">${x.i} / ${x.t}</span></div>`; }).join("")}</section>
  <section class="panel"><h3>最新報到紀錄</h3>${log.length ? `<ul class="list">${log.map(r => `<li><div class="who"><b>${esc(r.name)}</b>${r.source === "walkin" ? '<span class="cat general">現場登記</span>' : ""}<span>${esc(r.org)}</span></div><div style="text-align:right"><span class="num">${esc(tpTime(r.checked_in_at))}</span><span class="hint" style="display:block;margin:0">${r.checked_in_by ? "經手：" + esc(st.names[r.checked_in_by] || (r.checked_in_by === st.me ? st.myName : "工作人員")) : ""}</span></div></li>`).join("")}</ul>` : '<div class="empty">尚無報到紀錄。</div>'}</section></div></div>`;
}

/* =================== 網站內容編輯 =================== */
const getP = p => p.split(".").reduce((o, k) => o == null ? o : o[k], st.C);
function setP(p, v) { const ks = p.split("."); let o = st.C; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
const fld = (label, path, type = "text", extra = "") => type === "textarea"
  ? `<label class="fld"><span>${label}</span><textarea data-b="${path}" ${extra}>${esc(getP(path))}</textarea></label>`
  : `<label class="fld"><span>${label}</span><input type="${type}" data-b="${path}" value="${esc(getP(path))}" ${extra}></label>`;
const sel = (label, path, opts) => `<label class="fld"><span>${label}</span><select data-b="${path}">${opts.map(o => `<option value="${o[0]}"${o[0] === getP(path) ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select></label>`;
const chk = (label, path) => `<label class="chk"><input type="checkbox" data-b="${path}"${getP(path) ? " checked" : ""}><span>${label}</span></label>`;
const roleLabel = s => s.track === "panel" ? "與談人" : "講者";
const sortedSessions = () => st.C.sessions.slice().sort((a, b) => toMin(a.start) - toMin(b.start));

function contentView() {
  if (!st.C) return `<div class="panel"><h2>尚未建立網站內容</h2><p>資料庫中還沒有網站內容。請先載入預設內容（來自 data/event.json），確認後儲存。</p><button class="btn pri" data-act="seed">載入預設內容</button></div>`;
  const secs = [["info", "基本資訊"], ["reg", "報名設定"], ["agenda", "議程"], ["people", "貴賓"], ["travel", "交通"], ["way", "會場導引"], ["check", "發布前檢核"]];
  return `<div class="editor"><div class="side" role="tablist">${secs.map(s => `<button data-sec="${s[0]}" aria-current="${st.cSec === s[0]}">${s[1]}</button>`).join("")}</div><div>${secBody()}
  <div class="savebar"><span class="${st.cDirty ? "dirty" : ""}">${st.cDirty ? "有尚未儲存的修改" : "最近儲存：" + esc(st.cUpdated ? tpStamp(st.cUpdated) : "—")}</span><a class="btn sm" href="index.html" target="_blank" rel="noopener">檢視網站</a><button class="btn pri" data-act="savecontent"${st.cDirty ? "" : " disabled"}>儲存並發布</button></div></div></div>`;
}
function secBody() {
  const C = st.C, s = st.cSec; let h = "";
  if (s === "info") {
    h = fld("主標題第一行", "info.line1") + fld("主標題第二行", "info.line2") + fld("中文副標", "info.subtitle", "textarea") + fld("英文副標", "info.subtitleEn", "textarea") +
      `<div class="three">${fld("日期", "info.date", "date")}${fld("開始", "info.start", "time")}${fld("結束", "info.end", "time")}</div><p class="hint">星期依日期自動計算：${esc(dateZh(C))}</p>` +
      fld("報到時間", "info.checkin", "time") + fld("地點名稱", "info.venue") + fld("地址", "info.address") + fld("地圖搜尋關鍵字", "info.mapQuery") + fld("論壇宗旨", "info.purpose", "textarea") +
      fld("主辦單位", "info.organizer") + fld("經費來源說明", "info.funding") + `<div class="two">${fld("聯絡窗口", "info.contactName")}${fld("電話", "info.contactPhone", "tel")}</div>` + fld("電子郵件", "info.contactEmail", "email") +
      `<h3 style="margin-top:22px">即時公告</h3>` + chk("顯示頁首公告列", "info.noticeOn") + fld("公告內容", "info.notice", "textarea") +
      `<h3 style="margin-top:22px">貴賓名單公開設定</h3>` + chk("對外顯示「邀請中」貴賓姓名（未勾選時僅顯示已確認者）", "info.showInvited");
  }
  if (s === "reg") {
    h = chk("開放線上報名", "registration.open") + `<div class="two">${fld("報名人數上限（留白為不限）", "registration.capacity", "number", 'min="1"')}${fld("報名截止日（顯示用文字）", "registration.deadline", "text", 'placeholder="例：2026年11月20日（五）"')}</div>` +
      fld("報名頁說明", "registration.intro", "textarea") + fld("個人資料蒐集告知聲明", "registration.consent", "textarea", 'rows="9"') +
      `<p class="hint">告知聲明請依院內個資管理規定，由相關單位確認後再開放報名。截止後請手動取消「開放線上報名」。</p>`;
  }
  if (s === "agenda") {
    C.sessions = sortedSessions();
    h = `<p class="hint">場次依開始時間自動排序。講者與座長從「貴賓」清單勾選。</p>` + C.sessions.map((x, i) => { const b = "sessions." + i;
      const picks = key => `<div class="picks">${C.people.map(p => `<label><input type="checkbox" data-list="${b}.${key}" value="${esc(p.id)}"${(x[key] || []).includes(p.id) ? " checked" : ""}>${esc(p.name)}</label>`).join("")}</div>`;
      return `<details class="item"><summary><small>${esc(x.start)}</small><b>${esc(x.title || "（未命名場次）")}</b></summary><div class="in">
      <div class="three">${fld("開始", b + ".start", "time")}${fld("結束", b + ".end", "time")}${sel("類型", b + ".track", Object.entries(TRACKS))}</div>
      ${fld("講題／議程名稱", b + ".title", "textarea")}${fld("講者文字（無特定人選時使用）", b + ".speakerText")}${fld("座長／主持人文字（無特定人選時使用）", b + ".moderatorText")}
      <span class="hint" style="display:block;margin-bottom:4px">${roleLabel(x)}</span>${picks("speakers")}<span class="hint" style="display:block;margin-bottom:4px">${x.track === "panel" ? "主持人" : "座長"}</span>${picks("moderators")}
      ${fld("備註（對外顯示）", b + ".note")}<div class="row-acts"><button class="sbtn danger" data-cdel="sessions" data-i="${i}">刪除此場次</button></div></div></details>`; }).join("") +
      `<button class="sbtn pri" data-cadd="sessions">新增場次</button>`;
  }
  if (s === "people") {
    h = `<p class="hint">照片會自動縮小壓縮。簡介請使用經本人或其單位確認之版本。</p>` + C.people.map((p, i) => { const b = "people." + i;
      return `<details class="item"><summary><b>${esc(p.name || "（未填姓名）")} <small>${esc(p.title)}${p.name ? "" : esc(sortedSessions().filter(x => (x.speakers || []).includes(p.id) || (x.moderators || []).includes(p.id)).map(x => x.start + ((x.moderators || []).includes(p.id) ? " 座長" : " 講者")).join("、"))}</small></b><small>${p.status === "confirmed" ? "已確認" : "邀請中"}</small></summary><div class="in">
      <div class="two">${fld("姓名", b + ".name")}${fld("職稱", b + ".title")}</div>${fld("服務單位", b + ".org")}${sel("出席狀態", b + ".status", [["confirmed", "已確認"], ["invited", "邀請中"]])}${fld("簡介", b + ".bio", "textarea", 'rows="6"')}
      <div class="row-acts"><label class="sbtn">上傳照片<input type="file" accept="image/*" data-photo="${i}" hidden></label>${p.photo ? `<button class="sbtn" data-nophoto="${i}">移除照片</button>` : ""}<button class="sbtn danger" data-cdel="people" data-i="${i}">刪除</button></div></div></details>`; }).join("") +
      `<button class="sbtn pri" data-cadd="people">新增貴賓</button>`;
  }
  if (s === "travel") {
    h = `<p class="hint">每一行為一個步驟。</p>` + C.travel.map((m, i) => `<details class="item"><summary><b>${esc(m.name)}</b></summary><div class="in">${fld("分頁名稱", "travel." + i + ".name")}<label class="fld"><span>步驟（每行一項）</span><textarea data-lines="travel.${i}.lines" rows="6">${esc((m.lines || []).join("\n"))}</textarea></label><div class="row-acts"><button class="sbtn danger" data-cdel="travel" data-i="${i}">刪除分頁</button></div></div></details>`).join("") +
      `<button class="sbtn pri" data-cadd="travel">新增交通方式</button>` + fld("交通資訊附註", "info.travelNote", "textarea");
  }
  if (s === "way") {
    h = `<p class="hint">「待確認」標記只在後台顯示，現場確認後請取消勾選。</p>` + C.way.steps.map((x, i) => { const b = "way.steps." + i;
      return `<details class="item"><summary><small>${i + 1}</small><b>${esc(x.t)}</b>${x.confirm ? '<small style="color:var(--amber)">待確認</small>' : ""}</summary><div class="in">${fld("步驟標題", b + ".t")}${fld("說明", b + ".d", "textarea")}${chk("待確認", b + ".confirm")}<div class="row-acts"><button class="sbtn" data-cup="way.steps" data-i="${i}">上移</button><button class="sbtn danger" data-cdel="way.steps" data-i="${i}">刪除</button></div></div></details>`; }).join("") +
      `<button class="sbtn pri" data-cadd="way.steps">新增步驟</button><h3 style="margin-top:22px">場地設施</h3>` +
      C.way.facilities.map((f, i) => `<div class="two">${fld("設施", "way.facilities." + i + ".n")}${fld("位置", "way.facilities." + i + ".l")}</div>`).join("") +
      `<div class="row-acts"><button class="sbtn" data-cadd="way.facilities">新增設施</button>${C.way.facilities.length ? `<button class="sbtn danger" data-cdel="way.facilities" data-i="${C.way.facilities.length - 1}">刪除最後一項</button>` : ""}</div>` +
      `<h3 style="margin-top:22px">會場平面圖</h3><div class="row-acts"><label class="sbtn">上傳平面圖<input type="file" accept="image/*" data-plan="1" hidden></label>${C.way.plan ? '<button class="sbtn danger" data-act="noplan">移除平面圖</button>' : ""}</div>`;
  }
  if (s === "check") h = `<ul class="checks">${checks().map(c => `<li><span class="${c[0] ? "ok" : "warn"}">${c[0] ? "✓" : "!"}</span><span>${esc(c[1])}</span></li>`).join("")}</ul>`;
  return `<section class="panel">${h}</section>`;
}
function checks() {
  const C = st.C, r = [[true, "活動日期：" + dateZh(C)]], l = sortedSessions();
  for (let i = 0; i < l.length - 1; i++) { const a = l[i], b = l[i + 1]; if (!a.end) continue; const e = toMin(a.end), s = toMin(b.start);
    if (s < e) r.push([false, `${a.start}「${a.title.slice(0, 14)}」與下一場時間重疊`]); else if (s > e) r.push([false, `${a.end}至${b.start}之間有 ${s - e} 分鐘空檔`]); }
  l.forEach(s => { if (["policy", "practice"].includes(s.track) && !(s.speakers || []).length) r.push([false, s.start + " 場次尚未指定講者"]); if (s.track === "panel" && !(s.moderators || []).length) r.push([false, s.start + " 座談尚未設定主持人"]); });
  const inv = C.people.filter(p => p.status !== "confirmed").length;
  r.push([inv === 0, inv ? `${inv} 位貴賓仍為邀請中${C.info.showInvited ? "，目前設定為對外顯示姓名" : "，對外僅顯示「確認中」"}` : "所有貴賓均已確認"]);
  const nb = C.people.filter(p => (p.status === "confirmed" || C.info.showInvited) && !p.bio).length; if (nb) r.push([false, nb + " 位對外顯示的貴賓尚無簡介"]);
  const wc = C.way.steps.filter(s => s.confirm).length; if (wc) r.push([false, `會場導引有 ${wc} 個步驟標記為待確認`]);
  if (!C.info.contactName && !C.info.contactPhone && !C.info.contactEmail) r.push([false, "尚未填寫聯絡窗口"]);
  r.push([!!C.registration?.open, C.registration?.open ? "線上報名開放中" : "線上報名尚未開放"]);
  return r;
}
function newItem(k) {
  const uid = p => p + Math.random().toString(36).slice(2, 8);
  if (k === "sessions") { const l = sortedSessions(), last = l[l.length - 1]; return { id: uid("s"), start: last ? last.end || last.start : "13:00", end: "", track: "practice", title: "", speakerText: "", moderatorText: "", speakers: [], moderators: [], note: "" }; }
  if (k === "people") return { id: uid("p"), name: "", title: "", org: "", status: "invited", bio: "", photo: "" };
  if (k === "travel") return { name: "新交通方式", lines: [] };
  if (k === "way.steps") return { t: "新步驟", d: "", confirm: true };
  if (k === "way.facilities") return { n: "", l: "" };
}
function markDirty() { st.cDirty = true; const b = $("[data-act=savecontent]"); if (b) { b.disabled = false; const s = b.parentElement.querySelector("span"); s.className = "dirty"; s.textContent = "有尚未儲存的修改"; } }
function redrawEditor() { const open = $$(".item").map((d, i) => d.open ? i : -1).filter(i => i > -1); render(); const ds = $$(".item"); open.forEach(i => ds[i] && (ds[i].open = true)); }
async function saveContent() {
  st.C.sessions = sortedSessions();
  const now = new Date().toISOString();
  const { error } = await sb.from("site_content").upsert({ id: 1, data: st.C, updated_at: now, updated_by: st.me });
  if (error) return toast(errMsg(error));
  st.cDirty = false; st.cUpdated = now; toast("已儲存並發布"); render();
}
function resize(file, max, q) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const im = new Image(); im.onload = () => { const s = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement("canvas"); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", q)); }; im.onerror = rej; im.src = fr.result; }; fr.readAsDataURL(file); });
}

/* =================== 匯入與匯出 =================== */
function parseCSV(text) {
  text = String(text || "").replace(/^\uFEFF/, "");
  const delim = text.split("\n")[0].includes("\t") ? "\t" : ",";
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === delim) { row.push(f); f = ""; } else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (ch !== "\r") f += ch; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const clean = rows.filter(r => r.some(x => x.trim())); if (!clean.length) return [];
  const h = clean[0].map(x => x.trim()), hasH = h.some(x => /姓名|name/i.test(x));
  const map = { name: /姓名|name/i, org: /機構|^org/i, dept: /^單位$|部門|科別|dept/i, title: /職稱|title/i, phone: /電話|手機|phone/i, meal: /用餐|餐|meal/i, idno: /身分證|證號|id/i, category: /類別|category/i, code: /代碼|code/i, email: /郵件|email|mail/i, note: /備註|note/i };
  const def = { name: 0, org: 1, dept: 2, title: 3, phone: 4, meal: 5, idno: 6, category: 7, code: 8, email: 9, note: 10 }, idx = {};
  for (const k in map) idx[k] = hasH ? h.findIndex(x => map[k].test(x)) : def[k];
  if (hasH && idx.org < 0) idx.org = h.findIndex(x => /單位/.test(x));
  const emails = new Set(st.regs.map(r => (r.email || "").toLowerCase()).filter(Boolean)), codes = new Set(st.regs.map(r => r.code));
  const out = []; out.bad = 0; out.dup = 0; out.badId = 0;
  (hasH ? clean.slice(1) : clean).forEach(r => {
    const g = k => idx[k] > -1 && r[idx[k]] != null ? String(r[idx[k]]).trim() : "";
    const name = g("name"), org = g("org"); if (!name || !org) { out.bad++; return; }
    const email = g("email").toLowerCase(), code = g("code").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    if ((email && emails.has(email)) || (code && codes.has(code))) { out.dup++; return; }
    if (email) emails.add(email); if (code) codes.add(code);
    const c = g("category"), cat = /貴賓|vip/i.test(c) ? "vip" : /講者|座長|主持|與談|speaker/i.test(c) ? "speaker" : /工作|staff/i.test(c) ? "staff" : "general";
    const idno = g("idno").toUpperCase().replace(/\s/g, "");
    if (idno && !validTwId(idno)) { out.badId++; return; }
    const ml = g("meal"), meal = /素|veg/i.test(ml) ? "veg" : /葷|meat/i.test(ml) ? "meat" : null;
    const row = { name, org, dept: g("dept") || null, title: g("title") || null, phone: g("phone") || null, meal, category: cat, email: email || null, note: g("note") || null, source: "import" };
    if (code) row.code = code; if (idno) row._id = idno; out.push(row);
  });
  return out;
}
function importView() {
  const ir = st.importRows;
  return `<div class="cols"><div class="stack"><section class="panel"><h2>匯入名單</h2><p class="hint" style="margin-top:0">適用於貴賓、講者等由承辦單位直接建檔的名單。欄位：姓名、服務機構、單位、職稱、聯絡電話、用餐（葷／素）、身分證字號（需申請積分者）、類別、報到代碼、電子郵件、備註。姓名與服務機構為必填，報到代碼留白由系統產生。</p>
    <div class="tools" style="margin-top:12px"><label class="btn">選擇 CSV 檔<input type="file" accept=".csv,text/csv" id="csvfile" hidden></label><button class="btn" data-act="template">下載範本</button></div>
    <label class="field"><span>或直接貼上（可從 Excel 複製）</span><textarea id="paste" placeholder="姓名,服務機構,單位,職稱,聯絡電話,用餐,身分證字號,類別"></textarea></label><button class="btn" data-act="parsepaste">解析貼上內容</button>
    ${ir ? `<div class="note" style="margin-top:14px">可匯入 <b>${ir.length}</b> 筆${ir.dup ? `；${ir.dup} 筆代碼或電子郵件重複已略過` : ""}${ir.bad ? `；${ir.bad} 筆缺少姓名或機構已略過` : ""}${ir.badId ? `；${ir.badId} 筆身分證字號格式不正確已略過` : ""}。
      <div class="tblw" style="margin-top:10px;max-height:220px;overflow:auto"><table class="tbl"><tbody>${ir.slice(0, 8).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.org)}</td><td>${esc(CAT[r.category])}</td></tr>`).join("")}</tbody></table></div>
      <div class="tools" style="margin:12px 0 0"><button class="btn pri" data-act="doimport"${st.busy || !ir.length ? " disabled" : ""}>${st.busy ? "匯入中…" : "確認匯入"}</button><button class="btn" data-act="cancelimport">取消</button></div></div>` : ""}
    </section></div>
    <div class="stack"><section class="panel"><h2>匯出</h2><p class="hint" style="margin-top:0">QR code 圖檔以「代碼＿姓名」命名，ZIP 內附名單 CSV，可搭配提醒信寄送。</p><div class="tools" style="margin-top:12px"><button class="btn pri" data-act="zip"${st.regs.length ? "" : " disabled"}>下載全部報到證（ZIP）</button><button class="btn" data-act="csv">下載名單 CSV</button></div>
    <p class="hint" style="margin:14px 0 8px">申請繼續教育積分時，需要完整身分證字號的名單：</p><button class="btn danger" data-act="csvid">下載積分申請名單（含完整身分證字號）</button></section>
    <section class="panel"><h2>資料清除</h2><p class="hint" style="margin-top:0">演練結束或活動結案後使用，刪除後無法復原。</p><div class="tools" style="margin-top:12px"><button class="btn danger" data-act="clearcheckins">清除全部報到紀錄</button><button class="btn danger" data-act="clearall">刪除全部報名資料</button></div></section></div></div>`;
}
async function loadPrivateIds() {
  if (!isAdmin()) return {};
  const m = {}; let from = 0;
  for (;;) {
    const { data, error } = await sb.from("registration_private").select("registration_id,id_number").range(from, from + 999);
    if (error) { toast("無法讀取身分證字號，CSV 僅含遮罩：" + errMsg(error)); break; }
    data.forEach(x => { m[x.registration_id] = x.id_number; }); if (data.length < 1000) break; from += 1000;
  }
  return m;
}
function csvOut(ids) {
  const full = !!ids;
  const L = [["報到代碼", "姓名", "服務機構", "單位", "職稱", "聯絡電話", "用餐", "申請積分", full ? "身分證字號" : "身分證字號（遮罩）", "類別", "電子郵件", "來源", "報名時間", "報到狀態", "報到時間", "備註"]];
  const src = { online: "線上報名", import: "名單匯入", walkin: "現場登記", manual: "人工建檔" };
  st.regs.forEach(r => L.push([r.code, r.name, r.org, r.dept, r.title, r.phone, MEAL[r.meal] || "", r.need_credit ? "是" : "否", full ? (ids[r.id] || "") : (r.id_masked || ""), CAT[r.category], r.email, src[r.source], tpStamp(r.created_at), r.checked_in_at ? "已報到" : "未報到", r.checked_in_at ? tpStamp(r.checked_in_at) : "", r.note]));
  return "\uFEFF" + L.map(r => r.map(v => { v = String(v ?? ""); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\r\n");
}
async function zipAll() {
  toast("正在產生報到證…");
  try { await loadScript(ZIP_LIB, () => !!window.JSZip); } catch { return toast("無法載入壓縮元件，請稍後再試"); }
  const z = new window.JSZip();
  for (const r of st.regs.filter(r => r.source !== "walkin")) {
    const blob = await new Promise(res => card(r).toBlob(res, "image/png"));
    z.file(`${r.code}_${r.name.replace(/[\\/:*?"<>|]/g, "")}.png`, blob);
  }
  z.file("名單與代碼.csv", csvOut());
  const blob = await z.generateAsync({ type: "blob" });
  const a = document.createElement("a"); a.download = "論壇報到證.zip"; a.href = URL.createObjectURL(blob); document.body.appendChild(a); a.click(); a.remove();
}

/* =================== 人員權限 =================== */
function staffView() {
  const pend = st.staff.filter(s => s.role === "pending");
  return `<div class="cols"><section class="panel"><h2>工作人員帳號</h2>${pend.length ? `<div class="note" style="margin-bottom:14px">有 ${pend.length} 個帳號等待核定權限。</div>` : ""}
    <div class="tblw"><table class="tbl"><thead><tr><th>姓名／電子郵件</th><th>權限</th><th></th></tr></thead><tbody>${st.staff.map(s => `<tr><td><input class="dname" data-dname="${esc(s.user_id)}" value="${esc(s.display_name || "")}" placeholder="輸入姓名" maxlength="30" aria-label="${esc(s.email)} 的姓名"><div class="hint" style="margin:2px 0 0">${esc(s.email)}</div></td>
      <td><select data-role="${esc(s.user_id)}"${s.user_id === st.me ? " disabled" : ""} aria-label="權限">${["pending", "viewer", "checkin", "admin"].map(k => `<option value="${k}"${s.role === k ? " selected" : ""}>${ROLE_NAME[k]}</option>`).join("")}</select></td>
      <td class="acts">${s.user_id === st.me ? '<span class="hint">本人</span>' : `<button class="btn sm danger" data-rmstaff="${esc(s.user_id)}">移除</button>`}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="panel"><h2>權限說明</h2><div class="tblw"><table class="tbl perm"><thead><tr><th>權限</th><th>可執行</th></tr></thead><tbody>
      <tr><td><b>管理者</b></td><td>編輯網站內容、開關報名、匯入與刪除名單、下載報到證、管理人員權限</td></tr>
      <tr><td><b>報到人員</b></td><td>掃描報到、取消報到、現場登記、查看名單與統計</td></tr>
      <tr><td><b>檢視者</b></td><td>查看名單與即時統計</td></tr>
      <tr><td><b>待審核</b></td><td>無法使用任何功能</td></tr></tbody></table></div>
      <h3 style="margin-top:18px">新增工作人員</h3><ol style="margin:0;padding-left:20px;font-size:15px"><li>請同仁開啟本後台，點選「申請帳號」</li><li>同仁完成電子郵件驗證</li><li>於本頁指定權限</li></ol>
      <p class="hint">姓名可直接在左側表格修改，離開輸入框即自動儲存；報到紀錄的「經手人」會顯示此姓名。權限由資料庫強制執行，即使他人取得網頁程式碼也無法越權操作。</p></section></div>`;
}
function accountView() {
  return `<section class="panel" style="max-width:480px"><h2>我的帳號</h2><p>${esc(st.session.user.email)}｜${ROLE_NAME[st.role]}</p>
    <form id="f-pw"><label class="field"><span>變更密碼（至少 8 個字元）</span><input name="pw" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn">更新密碼</button></form>
    <div style="margin-top:20px"><button class="btn danger" data-act="logout">登出</button></div></section>`;
}

/* =================== 事件 =================== */
document.addEventListener("click", async e => {
  const t = e.target.closest("button,[data-tab]"); if (!t) return;
  const d = t.dataset;
  if (d.auth) { st.authMode = d.auth; st.authMsg = null; return renderAuth(); }
  if (d.tab) { if (st.tab === "content" && st.cDirty && d.tab !== "content" && !confirm("網站內容有尚未儲存的修改，確定離開？")) return; if (st.cam && d.tab !== "scan") camOff(); st.tab = d.tab; render(); return scrollTo(0, 0); }
  if (d.sec) { st.cSec = d.sec; render(); return; }
  if (d.checkin) return checkIn(d.checkin);
  if (d.undo) return undo(d.undo);
  if (d.qr) return showQR(d.qr);
  if (d.filter) { st.filter = d.filter; return render(); }
  if (d.del) { const r = st.regs.find(x => x.id === d.del); if (!confirm(`確定刪除「${r.name}」的報名資料？`)) return; const { error } = await sb.from("registrations").delete().eq("id", d.del); if (error) return toast(errMsg(error)); st.regs = st.regs.filter(x => x.id !== d.del); return render(); }
  if (d.rmstaff) { if (!confirm("確定移除此工作人員的權限？（帳號仍存在，但無法使用後台）")) return; const { error } = await sb.from("staff_roles").update({ role: "pending" }).eq("user_id", d.rmstaff); if (error) return toast(errMsg(error)); await loadStaff(); return render(); }
  if (d.cadd) { getP(d.cadd).push(newItem(d.cadd)); markDirty(); redrawEditor(); const ds = $$(".item"); if (ds.length) ds[ds.length - 1].open = true; return; }
  if (d.cdel) { const arr = getP(d.cdel), it = arr[+d.i]; if (!confirm(`確定刪除「${it.title || it.name || it.t || it.n || "此項目"}」？`)) return; arr.splice(+d.i, 1);
    if (d.cdel === "people") st.C.sessions.forEach(s => { s.speakers = (s.speakers || []).filter(x => x !== it.id); s.moderators = (s.moderators || []).filter(x => x !== it.id); });
    markDirty(); return redrawEditor(); }
  if (d.cup) { const arr = getP(d.cup), j = +d.i; if (j > 0) { [arr[j - 1], arr[j]] = [arr[j], arr[j - 1]]; markDirty(); redrawEditor(); } return; }
  if (d.nophoto) { st.C.people[+d.nophoto].photo = ""; markDirty(); return redrawEditor(); }
  const a = d.act;
  if (a === "camon") camOn(); else if (a === "camoff") camOff();
  else if (a === "csv") downloadText(csvOut(), "論壇報名名單.csv", "text/csv;charset=utf-8");
  else if (a === "csvid") { if (!confirm("此檔案含完整身分證字號，僅供申請繼續教育積分使用。請存放於加密或受控的位置，用畢刪除，勿以電子郵件或通訊軟體傳送。確定下載？")) return; downloadText(csvOut(await loadPrivateIds()), "論壇報名名單_含身分證字號.csv", "text/csv;charset=utf-8"); }
  else if (a === "template") downloadText("\uFEFF姓名,服務機構,單位,職稱,聯絡電話,用餐,身分證字號,類別,報到代碼,電子郵件,備註\r\n王小明,中國醫藥大學兒童醫院,小兒科,主治醫師,0912345678,葷,,一般,,,\r\n", "名單匯入範本.csv", "text/csv;charset=utf-8");
  else if (a === "parsepaste") { const rows = parseCSV($("#paste").value); if (!rows.length && !rows.dup) return toast("未解析到資料，請確認內容含姓名與單位"); st.importRows = rows; render(); }
  else if (a === "cancelimport") { st.importRows = null; render(); }
  else if (a === "doimport") {
    st.busy = true; render(); let ok = 0, idFail = 0;
    const rows = st.importRows;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { data, error } = await sb.from("registrations").insert(chunk.map(({ _id, ...r }) => ({ ...r, need_credit: !!_id }))).select("id");
      if (error) { toast(errMsg(error)); break; }
      ok += data.length;
      const priv = data.map((d, k) => chunk[k]._id ? { registration_id: d.id, id_number: chunk[k]._id, id_hash: "" } : null).filter(Boolean);
      for (const p of priv) { const r = await sb.from("registration_private").insert(p); if (r.error) idFail++; }
    }
    st.busy = false; st.importRows = null; toast(`已匯入 ${ok} 筆${idFail ? `；${idFail} 筆身分證字號重複或無效，未寫入` : ""}`); await loadRegs(); render();
  }
  else if (a === "zip") zipAll();
  else if (a === "clearcheckins") { if (prompt("將清除全部報到紀錄，並刪除現場登記資料。請輸入「確認清除」繼續") !== "確認清除") return;
    let r = await sb.from("registrations").delete().eq("source", "walkin"); if (!r.error) r = await sb.from("registrations").update({ checked_in_at: null, checked_in_by: null }).not("checked_in_at", "is", null);
    if (r.error) toast(errMsg(r.error)); else toast("已清除報到紀錄"); await loadRegs(); render(); }
  else if (a === "clearall") { if (prompt("將刪除全部報名資料（含線上報名者），無法復原。請輸入「確認刪除」繼續") !== "確認刪除") return;
    const r = await sb.from("registrations").delete().not("id", "is", null); if (r.error) toast(errMsg(r.error)); else toast("已刪除全部報名資料"); await loadRegs(); render(); }
  else if (a === "seed") { const r = await fetch("data/event.json", { cache: "no-cache" }); st.C = await r.json(); st.cDirty = true; render(); toast("已載入預設內容，確認後請按「儲存並發布」"); }
  else if (a === "savecontent") saveContent();
  else if (a === "togglereg") {
    if (st.cDirty) return toast("「網站內容」有尚未儲存的修改，請先儲存後再切換報名狀態");
    const next = !(st.C.registration && st.C.registration.open);
    if (!confirm(next ? "確定開放線上報名？請先確認個資告知聲明已經審閱。" : "確定關閉線上報名？關閉後報名頁將無法送出。")) return;
    st.C.registration = Object.assign({}, st.C.registration, { open: next });
    const { error } = await sb.from("site_content").upsert({ id: 1, data: st.C, updated_at: new Date().toISOString(), updated_by: st.me });
    if (error) { st.C.registration.open = !next; return toast(errMsg(error)); }
    toast(next ? "已開放線上報名" : "已關閉線上報名"); render();
  }
  else if (a === "rotatesecret") {
    if (st.sync && st.sync.secret_created_at && !confirm("產生新金鑰後，Google 試算表需重新執行「1. 設定連線」貼上新金鑰，否則同步會中斷。確定繼續？")) return;
    const { data, error } = await sb.rpc("rotate_sync_secret");
    if (error) return toast(errMsg(error));
    st.newSecret = data; await loadSync(); render();
  }
  else if (a === "copysecret") { const i = $("#secretval"); i.select(); try { await navigator.clipboard.writeText(i.value); toast("已複製同步金鑰"); } catch { toast("請手動選取後複製"); } }
  else if (a === "noplan") { st.C.way.plan = ""; markDirty(); redrawEditor(); }
  else if (a === "account") { st.tab = "account"; render(); }
  else if (a === "logout") {
    if (st.cDirty && !confirm("網站內容有尚未儲存的修改，確定登出？")) return;
    if (!st.cDirty && !confirm("確定要登出管理後台？")) return;
    st.cDirty = false; if (st.cam) camOff();
    const { error } = await sb.auth.signOut();
    if (error) { await sb.auth.signOut({ scope: "local" }); }
    Object.assign(st, { session: null, me: null, role: "none", regs: [], staff: [], C: null, tab: "scan", booted: false, last: null, newSecret: null, authMode: "login", authMsg: { ok: true, t: "已登出。" } });
    renderAuth();
  }
});
document.addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  if (f.id === "f-auth") return onAuthSubmit(f);
  if (f.id === "scanform") { const i = $("#code"), v = i.value; i.value = ""; checkIn(v); return i.focus(); }
  if (f.id === "walkform") { const d = Object.fromEntries(new FormData(f)); if (!d.name.trim() || !d.org.trim()) return;
    const { data, error } = await sb.rpc("walk_in", { p_name: d.name, p_org: d.org, p_dept: d.dept || "", p_title: d.title || "", p_meal: d.meal || "" }); if (error) return toast(errMsg(error));
    st.last = data; beep(true); toast("已完成現場登記"); await loadRegs(); return render(); }
  if (f.id === "f-pw" || f.id === "f-newpw") { const pw = new FormData(f).get("pw"); const { error } = await sb.auth.updateUser({ password: pw });
    if (f.id === "f-newpw") { if (error) { st.authMsg = { ok: false, t: errMsg(error) }; return renderAuth(); } st.recovery = false; return boot(); }
    return toast(error ? errMsg(error) : "密碼已更新"); }
});
let qt = null;
document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "mq" || t.id === "lq") { st[t.id === "mq" ? "mq" : "q"] = t.value; clearTimeout(qt); qt = setTimeout(render, 150); return; }
  if (!st.C || !t.closest(".editor")) return;
  if (t.dataset.b) { setP(t.dataset.b, t.type === "checkbox" ? t.checked : t.value); markDirty();
    const sm = t.closest("details"); if (sm && /\.(title|t)$/.test(t.dataset.b)) { const s = $("summary b", sm); if (s) s.textContent = t.value; } }
  else if (t.dataset.lines) { setP(t.dataset.lines, t.value.split("\n")); markDirty(); }
  else if (t.dataset.list) { let arr = getP(t.dataset.list) || []; arr = t.checked ? [...new Set([...arr, t.value])] : arr.filter(x => x !== t.value); setP(t.dataset.list, arr); markDirty(); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.dataset.cat) { const { error } = await sb.from("registrations").update({ category: t.value }).eq("id", t.dataset.cat); if (error) return toast(errMsg(error)); const r = st.regs.find(x => x.id === t.dataset.cat); if (r) r.category = t.value; return toast("已更新類別"); }
  if (t.dataset.dname) {
    const name = t.value.trim().slice(0, 30);
    const { error } = await sb.from("staff_roles").update({ display_name: name }).eq("user_id", t.dataset.dname);
    if (error) return toast(errMsg(error));
    const row = st.staff.find(x => x.user_id === t.dataset.dname); if (row) row.display_name = name;
    st.names[t.dataset.dname] = name || (row && row.email);
    if (t.dataset.dname === st.me) { st.myName = name || st.session.user.email; const b = $("[data-act=account]"); if (b) b.textContent = st.myName; }
    return toast(name ? "已更新姓名" : "已清除姓名");
  }
  if (t.dataset.role) { const { error } = await sb.from("staff_roles").update({ role: t.value }).eq("user_id", t.dataset.role); if (error) { toast(errMsg(error)); } else toast("已更新權限"); await loadStaff(); return render(); }
  if (t.id === "csvfile" && t.files[0]) { const text = await t.files[0].text(); st.importRows = parseCSV(text); return render(); }
  if (t.dataset.photo != null && t.files?.[0]) { st.C.people[+t.dataset.photo].photo = await resize(t.files[0], 360, .82); markDirty(); return redrawEditor(); }
  if (t.dataset.plan && t.files?.[0]) { st.C.way.plan = await resize(t.files[0], 1600, .8); markDirty(); return redrawEditor(); }
  if (t.dataset.b && t.tagName === "SELECT" && /\.track$/.test(t.dataset.b)) redrawEditor();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") { const m = $(".modal"); if (m) m.remove(); } });
window.addEventListener("beforeunload", e => { if (st.cDirty) { e.preventDefault(); e.returnValue = ""; } });

/* =================== 啟動 =================== */
let subscribed = false;
async function boot() {
  const { data } = await sb.auth.getSession();
  st.session = data.session;
  if (!st.session) return renderAuth();
  st.me = st.session.user.id;
  await loadRole();
  if (["viewer", "checkin", "admin"].includes(st.role)) {
    const tasks = [loadRegs(), loadSync(), loadContent({ full: true }).then(x => { if (x.source === "db") { st.C = x.S; st.cUpdated = x.updatedAt; } else st.C = st.C || null; if (st.C) { st.C.way ||= { steps: [], facilities: [] }; st.C.travel ||= []; st.C.registration ||= { open: false }; } })];
    if (st.role === "admin") tasks.push(loadStaff());
    await Promise.all(tasks);
    if (!st.booted) { st.tab = "overview"; st.booted = true; }
    if (!subscribed) { subscribe(); subscribed = true; }
  }
  render();
}
const CONFIG_MSG = {
  secret: ["金鑰設定錯誤，已停止運作", "assets/js/config.js 填入的是 service_role 或 secret key，這把金鑰可以繞過所有權限。請立即改填 anon 或 publishable key，並到 Supabase 重新產生 secret key。"],
  unset: ["尚未完成系統設定", "請在 assets/js/config.js 填入 Supabase 專案網址與公開金鑰，詳見 README.md。"],
  url: ["專案網址格式不正確", "assets/js/config.js 的 SUPABASE_URL 應為 https://（20 碼英數字）.supabase.co，結尾不要加 /rest/v1/ 等路徑。"],
  key: ["公開金鑰格式不正確", "assets/js/config.js 的 SUPABASE_ANON_KEY 應為 eyJ 開頭的 anon public key，或 sb_publishable_ 開頭的 publishable key（Supabase → Project Settings → API Keys）。請勿填入網址。"],
};
function gateMsg(t, d) { app.innerHTML = `<div class="gate"><h2>${esc(t)}</h2><p>${esc(d)}</p></div>`; }
if (configProblem) gateMsg(...CONFIG_MSG[configProblem]);
else {
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "PASSWORD_RECOVERY") { st.recovery = true; st.authMsg = null; renderAuth(); }
    else if (ev === "SIGNED_IN" && !st.recovery && session?.user?.id !== st.me) setTimeout(boot, 0);
    else if (ev === "SIGNED_OUT") { Object.assign(st, { session: null, me: null, role: "none", regs: [], staff: [], C: null, cDirty: false, tab: "scan", booted: false }); if (st.cam) camOff(); renderAuth(); }
  });
  const guard = setTimeout(() => { if (/系統連線中/.test(app.textContent)) gateMsg("無法連線到資料庫", "請確認 assets/js/config.js 的專案網址與金鑰正確，且 Supabase 專案未暫停；確認後重新整理頁面。"); }, 12000);
  boot().catch(e => gateMsg("無法連線到資料庫", errMsg(e))).finally(() => clearTimeout(guard));
}
