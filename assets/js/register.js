import { sb, configured, loadContent, esc, $, dateZh, errMsg, validTwId, phoneDigits } from "./common.js";

const app = $("#app");
let S;
try { S = (await loadContent()).S; } catch { app.innerHTML = '<div class="msg err">網站內容載入失敗，請重新整理頁面。</div>'; throw 0; }
const R = S.registration || {};
const I = S.info;

/* ---------- 交通需求：高鐵建議班次（依一般行車時間推算，僅供參考） ---------- */
// [車站, 到高鐵台中站最短車程, 一般車程]（分鐘）
const HSR = [["南港", 58, 80], ["台北", 47, 70], ["板橋", 40, 62], ["桃園", 29, 45], ["新竹", 21, 33], ["苗栗", 11, 16],
  ["彰化", 9, 12], ["雲林", 18, 24], ["嘉義", 30, 38], ["台南", 42, 60], ["左營", 50, 72]];
const ARRIVE = [["before11", "11:00 以前"], ["1100-1130", "11:00–11:30"], ["1130-1200", "11:30–12:00"], ["after12", "12:00 以後"]];
const THSR_BOOK = "https://irs.thsrc.com.tw/IMINT/?locale=tw";
const THSR_TIMETABLE = "https://www.thsrc.com.tw/ArticleContent/a3b630bb-1066-4352-a1ef-58c7b4e8ef7c";
const toMin = t => { const p = String(t || "0:0").split(":").map(Number); return p[0] * 60 + (p[1] || 0); };
const hm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(((m % 60) + 60) % 60).padStart(2, "0");
const floor10 = m => Math.floor(m / 10) * 10;
function hsrPlan(station) {
  const row = HSR.find(x => x[0] === station); if (!row) return null;
  const [, fast, slow] = row;
  const arriveBy = toMin(I.checkin || "12:30") - 40;              // 預留接駁與報到時間
  const latest = floor10(arriveBy - slow), earliest = latest - 30;
  const backFrom = toMin(I.end || "17:30") + 50;                  // 會後接駁抵達高鐵台中站後
  return { station, fast, slow, arriveBy: hm(arriveBy), go: hm(earliest) + "–" + hm(latest), back: hm(backFrom), backArrive: hm(backFrom + fast) + "–" + hm(backFrom + slow + 20) };
}
function hsrTip(station) {
  const p = hsrPlan(station); if (!p) return "";
  const day = dateZh(S), copy = `${day} 高鐵行程\n去程：${p.station}→台中，建議 ${p.go} 出發（${p.arriveBy} 前抵達台中站）\n回程：台中→${p.station}，建議搭乘 ${p.back} 以後的班次`;
  return `<div class="hsr-tip"><b>建議搭乘時間（${esc(p.station)}站 ⇄ 台中站，車程約 ${p.fast}–${p.slow} 分鐘）</b>
    <ul><li><span>去程</span><div>搭乘 <b class="num">${p.go}</b> 自${esc(p.station)}站出發的班次，約 <b class="num">${p.arriveBy}</b> 前抵達高鐵台中站</div></li>
    <li><span>回程</span><div>活動 ${esc(I.end || "17:30")} 結束，建議搭乘 <b class="num">${p.back}</b> 以後自台中站出發的班次，約 ${p.backArrive} 抵達${esc(p.station)}站</div></li></ul>
    <div class="acts"><a class="btn btn-blue" href="${THSR_BOOK}" target="_blank" rel="noopener">前往高鐵官網訂票</a><a class="btn btn-line" href="${THSR_TIMETABLE}" target="_blank" rel="noopener">查詢時刻表</a><button type="button" class="btn btn-line" data-copytrip="${esc(copy)}">複製行程資訊</button></div>
    <small>依一般行車時間推算，僅供參考；實際班次與票價以台灣高鐵公告為準。高鐵官網不提供自動帶入車站與日期，請依上方資訊於官網或 T-EX App 選擇車次。</small></div>`;
}
function transportView() {
  return `<fieldset class="f choice"><legend>交通方式<em>*</em></legend>
      <label><input type="radio" name="transport" value="car" required> 自行開車（提供停車優免）</label>
      <label><input type="radio" name="transport" value="hsr"> 搭乘高鐵（高鐵台中站免費接駁至會場）</label>
      <label><input type="radio" name="transport" value="other"> 其他（公車、計程車、共乘等）</label>
    </fieldset>
    <div id="tr-car" hidden><label class="f"><span>車牌號碼<em>*</em></span><input name="plate" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例：ABC-1234"><small>用於辦理停車優免；優免方式與停車地點將於活動前另行通知。</small></label></div>
    <div id="tr-hsr" hidden>
      <label class="f"><span>高鐵起站<em>*</em></span><select name="hsr_from"><option value="">請選擇</option>${HSR.map(x => `<option>${x[0]}</option>`).join("")}</select></label>
      <div id="hsrtip"></div>
      <fieldset class="f choice"><legend>免費接駁車（高鐵台中站 ⇄ 會場）</legend>
        <label><input type="checkbox" name="shuttle_to" checked> 去程搭乘（高鐵台中站 → 會場）</label>
        <label><input type="checkbox" name="shuttle_back" checked> 回程搭乘（會場 → 高鐵台中站）</label>
      </fieldset>
      <label class="f" id="arrivebox"><span>預計抵達高鐵台中站時間<em>*</em></span><select name="hsr_arrive"><option value="">請選擇</option>${ARRIVE.map(x => `<option value="${x[0]}">${x[1]}</option>`).join("")}</select><small>供規劃接駁車班次；接駁時間與上車地點將於活動前另行通知。</small></label>
    </div>`;
}

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
    <label class="f"><span>職稱</span><input name="title" autocomplete="organization-title" maxlength="60" placeholder="例：主治醫師"></label></div>
    <div class="two"><label class="f"><span>服務機構<em>*</em></span><input name="org" autocomplete="organization" required maxlength="120" placeholder="例：中國醫藥大學兒童醫院"></label>
    <label class="f"><span>單位</span><input name="dept" maxlength="120" placeholder="例：小兒科、護理部"></label></div>
    <div class="two"><label class="f"><span>聯絡電話<em>*</em></span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="例：0912-345-678"><small>用於活動聯繫，以及查詢報到證</small></label>
    <label class="f"><span>電子郵件<em>*</em></span><input name="email" type="email" inputmode="email" autocomplete="email" required maxlength="120" spellcheck="false" autocapitalize="off" placeholder="例：name@example.com"><small>用於寄送活動通知</small></label></div>
    <fieldset class="f choice"><legend>用餐習慣<em>*</em></legend>
      <label><input type="radio" name="meal" value="meat" required> 葷食</label>
      <label><input type="radio" name="meal" value="veg"> 素食</label>
    </fieldset>
    ${transportView()}
    <label class="f" id="idfield"><span>身分證字號<em>*</em></span><input name="idno" required maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例：A123456789"><small>供辦理繼續教育積分申請使用；居留證號亦可。送出後頁面只顯示遮罩（例：A12****789）。</small></label>
    <h2 style="font-size:16px;margin:8px 0 8px">個人資料蒐集告知</h2>
    <div class="consent">${esc(R.consent || "")}</div>
    <label class="agree"><input type="checkbox" name="consent" required><span>我已閱讀並同意上述個人資料蒐集、處理及利用事項</span></label>
    <button class="btn btn-blue" type="submit" style="width:100%;min-height:52px;font-size:17px">送出報名</button>
  </form>${lookupView()}`;
}
function lookupView(msg) {
  return `<form class="box" id="lookup" style="margin-top:18px"><h2 style="font-size:18px;margin:0 0 6px">查詢報到證</h2><p class="hint" style="margin:0 0 14px;color:var(--muted)">已報名者輸入報名時的姓名與聯絡電話，即可重新取得報到證。</p>
    <div id="lkmsg">${msg ? `<div class="msg err" role="alert">${esc(msg)}</div>` : ""}</div>
    <div class="two"><label class="f"><span>姓名</span><input name="name" required></label><label class="f"><span>聯絡電話</span><input name="phone" type="tel" inputmode="tel" required></label></div>
    <button class="btn btn-line" type="submit">查詢</button></form>`;
}

function render(msg) { app.innerHTML = formView(msg); }
render();

app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector("button[type=submit]");
  if (f.id === "reg") {
    const d = Object.fromEntries(new FormData(f));
    const idno = String(d.idno || "").trim().toUpperCase();
    const email = String(d.email || "").trim().toLowerCase();
    if (!d.name?.trim() || !d.org?.trim() || !d.phone?.trim() || !email) return showErr(f, "請填寫姓名、服務機構、聯絡電話與電子郵件。");
    if (phoneDigits(d.phone).length < 8 || phoneDigits(d.phone).length > 15) return showErr(f, "聯絡電話格式不正確，請填寫 8 至 15 位數字。");
    if (email.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr(f, "電子郵件格式不正確，請再確認一次。");
    if (!d.meal) return showErr(f, "請選擇用餐習慣。");
    const tr = d.transport || "", plate = String(d.plate || "").toUpperCase().replace(/\s/g, "");
    const toOn = tr === "hsr" && !!f.shuttle_to.checked, backOn = tr === "hsr" && !!f.shuttle_back.checked;
    if (!tr) return showErr(f, "請選擇交通方式。");
    if (tr === "car" && !/^[A-Z0-9]{2,4}-?[A-Z0-9]{2,4}$/.test(plate)) return showErr(f, "請填寫正確的車牌號碼，例如 ABC-1234。");
    if (tr === "hsr" && !d.hsr_from) return showErr(f, "請選擇高鐵起站。");
    if (toOn && !d.hsr_arrive) return showErr(f, "請選擇預計抵達高鐵台中站的時間。");
    if (!idno) return showErr(f, "請填寫身分證字號。");
    if (!validTwId(idno)) return showErr(f, "身分證字號格式不正確，請再確認一次。");
    if (!f.consent.checked) return showErr(f, "請勾選同意個人資料蒐集告知事項。");
    btn.disabled = true; btn.textContent = "送出中…";
    const args = { p_name: d.name, p_org: d.org, p_dept: d.dept || "", p_title: d.title || "", p_phone: d.phone,
      p_meal: d.meal, p_need_credit: true, p_id_number: idno, p_consent: true };
    const trip = { p_transport: tr, p_car_plate: tr === "car" ? plate : null, p_hsr_from: tr === "hsr" ? d.hsr_from : null,
      p_hsr_arrive: toOn ? d.hsr_arrive : null, p_shuttle_to: toOn, p_shuttle_back: backOn };
    // 資料庫尚未更新時依序改用較舊版本的報名函式，避免無法報名
    const missing = er => er && (er.code === "PGRST202" || /function .*register/i.test(er.message || ""));
    let { data, error } = await sb.rpc("register", { ...args, p_email: email, ...trip });
    if (missing(error)) ({ data, error } = await sb.rpc("register", { ...args, p_email: email }));
    if (missing(error)) ({ data, error } = await sb.rpc("register", args));
    if (error || !data || !data[0]) { btn.disabled = false; btn.textContent = "送出報名"; return showErr(f, errMsg(error)); }
    location.href = "ticket.html?t=" + encodeURIComponent(data[0].token) + "&new=1";
  }
  if (f.id === "lookup") {
    const d = Object.fromEntries(new FormData(f));
    btn.disabled = true;
    const { data, error } = await sb.rpc("find_ticket", { p_name: d.name || "", p_phone: d.phone || "" });
    btn.disabled = false;
    if (error) return ($("#lkmsg").innerHTML = `<div class="msg err">${esc(errMsg(error))}</div>`);
    if (!data) return ($("#lkmsg").innerHTML = `<div class="msg err">查無報名資料，請確認姓名與聯絡電話是否與報名時相同。</div>`);
    location.href = "ticket.html?t=" + encodeURIComponent(data);
  }
});
function showErr(f, m) {
  let box = f.querySelector(".msg.err");
  if (!box) { box = document.createElement("div"); box.className = "msg err"; box.setAttribute("role", "alert"); f.prepend(box); }
  box.textContent = m; box.scrollIntoView({ block: "center" });
}

app.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "transport") { $("#tr-car").hidden = t.value !== "car"; $("#tr-hsr").hidden = t.value !== "hsr"; }
  if (t.name === "hsr_from") $("#hsrtip").innerHTML = hsrTip(t.value);
  if (t.name === "shuttle_to") $("#arrivebox").hidden = !t.checked;
});
app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copytrip]"); if (!b) return;
  const done = () => { b.textContent = "已複製"; setTimeout(() => (b.textContent = "複製行程資訊"), 1800); };
  try { navigator.clipboard.writeText(b.dataset.copytrip.replace(/\\n/g, "\n")).then(done, () => alert(b.dataset.copytrip.replace(/\\n/g, "\n"))); } catch { alert(b.dataset.copytrip.replace(/\\n/g, "\n")); }
});
app.addEventListener("input", (e) => { if (e.target.name === "idno" || e.target.name === "plate") e.target.value = e.target.value.toUpperCase().replace(/\s/g, ""); });
