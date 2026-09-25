import { sb, configured, loadContent, esc, $, dateZh, errMsg } from "./common.js";

const app = $("#app");
let S;
try { S = (await loadContent()).S; } catch { app.innerHTML = '<div class="msg err">網站內容載入失敗，請重新整理頁面。</div>'; throw 0; }
const R = S.registration || {};
const I = S.info;

function eventMeta() {
  return `<ul class="meta-list"><li><b>日期</b>${esc(dateZh(S))}</li><li><b>時間</b><span class="num">${esc(I.start)}–${esc(I.end)}</span>（${esc(I.checkin)} 開放報到）</li><li><b>地點</b>${esc(I.venue)}</li>${R.deadline ? `<li><b>報名截止</b>${esc(R.deadline)}</li>` : ""}</ul>`;
}

function formView(msg) {
  if (!configured) return `<h1>線上報名</h1><div class="msg err">報名系統尚未完成設定，請聯絡活動承辦單位。</div>`;
  if (!R.open) return `<h1>線上報名</h1><p class="lead">${esc(I.line1 + I.line2)}</p>${eventMeta()}<div class="msg info">目前未開放線上報名。已報名者請使用下方「查詢報到證」。</div>${lookupView()}`;
  return `<h1>線上報名</h1><p class="lead">${esc(I.line1 + I.line2)}</p>${eventMeta()}
  ${R.intro ? `<p>${esc(R.intro)}</p>` : ""}
  <form class="box" id="reg" novalidate>
    ${msg ? `<div class="msg err" role="alert">${esc(msg)}</div>` : ""}
    <div class="two"><label class="f"><span>姓名<em>*</em></span><input name="name" autocomplete="name" required maxlength="60"></label>
    <label class="f"><span>職稱</span><input name="title" autocomplete="organization-title" maxlength="60"></label></div>
    <label class="f"><span>服務單位<em>*</em></span><input name="org" autocomplete="organization" required maxlength="120"></label>
    <div class="two"><label class="f"><span>電子郵件<em>*</em></span><input name="email" type="email" autocomplete="email" required maxlength="120"><small>用於查詢報到證與活動通知</small></label>
    <label class="f"><span>聯絡電話</span><input name="phone" type="tel" autocomplete="tel" maxlength="30"></label></div>
    <h2 style="font-size:16px;margin:8px 0 8px">個人資料蒐集告知</h2>
    <div class="consent">${esc(R.consent || "")}</div>
    <label class="agree"><input type="checkbox" name="consent" required><span>我已閱讀並同意上述個人資料蒐集、處理及利用事項</span></label>
    <button class="btn btn-blue" type="submit" style="width:100%;min-height:52px;font-size:17px">送出報名</button>
  </form>${lookupView()}`;
}
function lookupView(msg) {
  return `<form class="box" id="lookup" style="margin-top:18px"><h2 style="font-size:18px;margin:0 0 6px">查詢報到證</h2><p class="hint" style="margin:0 0 14px;color:var(--muted)">已報名者輸入報名時的姓名與電子郵件，即可重新取得報到證。</p>
    <div id="lkmsg">${msg ? `<div class="msg err" role="alert">${esc(msg)}</div>` : ""}</div>
    <div class="two"><label class="f"><span>姓名</span><input name="name" required></label><label class="f"><span>電子郵件</span><input name="email" type="email" required></label></div>
    <button class="btn btn-line" type="submit">查詢</button></form>`;
}

function render(msg) { app.innerHTML = formView(msg); }
render();

app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector("button[type=submit]");
  if (f.id === "reg") {
    const d = Object.fromEntries(new FormData(f));
    if (!d.name?.trim() || !d.org?.trim() || !d.email?.trim()) return showErr(f, "請填寫姓名、服務單位與電子郵件。");
    if (!f.consent.checked) return showErr(f, "請勾選同意個人資料蒐集告知事項。");
    btn.disabled = true; btn.textContent = "送出中…";
    const { data, error } = await sb.rpc("register", { p_name: d.name, p_org: d.org, p_title: d.title || "", p_email: d.email, p_phone: d.phone || "", p_consent: true });
    if (error || !data || !data[0]) { btn.disabled = false; btn.textContent = "送出報名"; return showErr(f, errMsg(error)); }
    location.href = "ticket.html?t=" + encodeURIComponent(data[0].token) + "&new=1";
  }
  if (f.id === "lookup") {
    const d = Object.fromEntries(new FormData(f));
    btn.disabled = true;
    const { data, error } = await sb.rpc("find_ticket", { p_email: d.email || "", p_name: d.name || "" });
    btn.disabled = false;
    if (error) return ($("#lkmsg").innerHTML = `<div class="msg err">${esc(errMsg(error))}</div>`);
    if (!data) return ($("#lkmsg").innerHTML = `<div class="msg err">查無報名資料，請確認姓名與電子郵件是否與報名時相同。</div>`);
    location.href = "ticket.html?t=" + encodeURIComponent(data);
  }
});
function showErr(f, m) {
  let box = f.querySelector(".msg.err");
  if (!box) { box = document.createElement("div"); box.className = "msg err"; box.setAttribute("role", "alert"); f.prepend(box); }
  box.textContent = m; box.scrollIntoView({ block: "center" });
}
