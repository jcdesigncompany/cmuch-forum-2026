import { sb, configured, loadContent, esc, $, dateZh, ticketCard, drawQR, downloadCanvas, calUrl, mapsUrl, errMsg } from "./common.js";

const app = $("#app");
const qs = new URLSearchParams(location.search);
const token = qs.get("t");
let S;
try { S = (await loadContent()).S; } catch { app.innerHTML = '<div class="msg err">網站內容載入失敗，請重新整理頁面。</div>'; throw 0; }
const I = S.info;

function lookupForm(msg) {
  return `<h1>查詢報到證</h1><p class="lead">輸入報名時填寫的姓名與電子郵件。</p>
  <form class="box" id="lookup">${msg ? `<div class="msg err" role="alert">${esc(msg)}</div>` : ""}
  <div class="two"><label class="f"><span>姓名</span><input name="name" required></label><label class="f"><span>電子郵件</span><input name="email" type="email" required></label></div>
  <button class="btn btn-blue" type="submit">查詢</button></form>
  <p style="margin-top:18px">尚未報名？<a href="register.html">前往線上報名</a></p>`;
}

async function show() {
  if (!configured) { app.innerHTML = '<div class="msg err">報名系統尚未完成設定，請聯絡活動承辦單位。</div>'; return; }
  if (!token) { app.innerHTML = lookupForm(); return; }
  const { data, error } = await sb.rpc("get_ticket", { p_token: token });
  if (error || !data || !data[0]) { app.innerHTML = lookupForm(error ? errMsg(error) : "此報到證連結無效，請重新查詢。"); return; }
  const t = data[0], fresh = qs.get("new") === "1";
  app.innerHTML = `${fresh ? '<div class="msg info" role="status"><b>報名完成！</b>請下載或截圖保存以下報到證，活動當天出示即可報到。</div>' : ""}
  <div class="box ticket">
    <div style="font-size:14px;color:var(--muted)">${esc(I.line1 + I.line2)}</div>
    <div class="nm">${esc(t.name)}${t.title ? ` <small style="font-size:16px;font-weight:500">${esc(t.title)}</small>` : ""}</div>
    <div class="og">${esc(t.org)}</div>
    <div id="qr"></div>
    <div class="code">${esc(t.code)}</div>
    <span class="state${t.checked_in_at ? " done" : ""}">${t.checked_in_at ? "已完成報到" : "尚未報到"}</span>
    <div class="acts"><button class="btn btn-blue" id="dl">下載報到證</button><a class="btn btn-line" href="${esc(calUrl(S))}" target="_blank" rel="noopener">加入行事曆</a><a class="btn btn-line" href="${esc(mapsUrl(S))}" target="_blank" rel="noopener">會場導航</a></div>
    <ul class="tips"><li>${esc(dateZh(S))} ${esc(I.checkin)} 起開放報到，地點：${esc(I.venue)}</li><li>建議將此頁加入書籤；遺失時可於「查詢報到證」重新取得</li><li>此連結為個人專屬，請勿轉傳他人</li></ul>
  </div>`;
  $("#qr").appendChild(drawQR(t.code, 560));
  $("#dl").onclick = () => downloadCanvas(ticketCard(t.code, t, I.line1 + I.line2, dateZh(S) + " " + I.start + "–" + I.end), `報到證_${t.code}.png`);
}
show();

app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const { data, error } = await sb.rpc("find_ticket", { p_email: d.email || "", p_name: d.name || "" });
  if (error) { app.innerHTML = lookupForm(errMsg(error)); return; }
  if (!data) { app.innerHTML = lookupForm("查無報名資料，請確認姓名與電子郵件是否與報名時相同。"); return; }
  location.href = "ticket.html?t=" + encodeURIComponent(data);
});
