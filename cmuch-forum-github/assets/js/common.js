import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured = !/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY);
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
export const CAT = { vip: "貴賓", speaker: "講者／座長", general: "一般", staff: "工作人員" };
export const TRACKS = { opening: "開幕", policy: "國家政策與藍圖", practice: "兒童醫院深耕實踐", panel: "綜合座談", logistics: "報到與休息" };
const WD = "日一二三四五六";

export function dInfo(S) {
  const p = (S.info.date || "2026-11-27").split("-").map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return { y: p[0], m: p[1], d: p[2], wd: WD[dt.getUTCDay()] };
}
export function dateZh(S) { const x = dInfo(S); return `${x.y}年${x.m}月${x.d}日（${x.wd}）`; }
export function toMin(t) { const p = String(t || "0:0").split(":").map(Number); return (p[0] || 0) * 60 + (p[1] || 0); }
export function tpNow() { const n = new Date(); return new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000); }
export function tpTime(iso) { try { return new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; } }
export function tpStamp(iso) { try { return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }); } catch { return ""; } }

export function toast(msg) {
  document.querySelectorAll(".toast").forEach(x => x.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
}

/** 讀取網站內容：優先讀資料庫，失敗時使用 data/event.json */
export async function loadContent(opts) {
  if (sb) {
    try {
      if (opts && opts.full) {
        // 工作人員：完整內容（含邀請中貴賓），由資料庫權限把關
        const { data, error } = await sb.from("site_content").select("data,updated_at").eq("id", 1).maybeSingle();
        if (!error && data && data.data) return { S: data.data, source: "db", updatedAt: data.updated_at };
      } else {
        // 對外頁面：邀請中貴賓的個人資料已在資料庫端移除
        const { data, error } = await sb.rpc("public_site_content");
        if (!error && data) return { S: data, source: "db" };
      }
    } catch { /* fall through */ }
  }
  const r = await fetch("data/event.json", { cache: "no-cache" });
  return { S: await r.json(), source: "file" };
}

export function mapsUrl(S) { return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(S.info.mapQuery || S.info.address); }
export function appleUrl(S) { return "https://maps.apple.com/?daddr=" + encodeURIComponent(S.info.address); }
export function calUrl(S) {
  const x = dInfo(S), pad = n => String(n).padStart(2, "0");
  const z = t => { const d = new Date(Date.UTC(x.y, x.m - 1, x.d, 0, toMin(t) - 480)); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "00Z"; };
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(S.info.line1 + S.info.line2) +
    "&dates=" + z(S.info.start) + "/" + z(S.info.end) + "&location=" + encodeURIComponent(S.info.venue + " " + S.info.address) + "&details=" + encodeURIComponent(S.info.subtitle);
}

/* ---------- QR code（使用 qrcode-generator，需先載入 script） ---------- */
export function drawQR(text, px) {
  const qr = window.qrcode(0, "M"); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), m = 4, s = Math.max(2, Math.floor(px / (n + m * 2)));
  const c = document.createElement("canvas"); c.width = c.height = s * (n + m * 2);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) x.fillRect((k + m) * s, (r + m) * s, s, s);
  return c;
}
export function ticketCard(code, g, eventName, dateText) {
  const q = drawQR(code, 440), w = q.width, h = w + 150;
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const x = out.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(q, 0, 0);
  x.textAlign = "center";
  x.fillStyle = "#13205A"; x.font = "700 30px 'Noto Sans TC',sans-serif"; x.fillText(g.name || "", w / 2, w + 28);
  x.fillStyle = "#5A6788"; x.font = "600 22px 'Sora',sans-serif"; x.fillText(code, w / 2, w + 62);
  x.font = "400 16px 'Noto Sans TC',sans-serif"; x.fillText(String(eventName || "").slice(0, 26), w / 2, w + 96);
  if (dateText) x.fillText(dateText, w / 2, w + 122);
  return out;
}
export function downloadCanvas(c, filename) {
  const a = document.createElement("a"); a.download = filename; a.href = c.toDataURL("image/png"); document.body.appendChild(a); a.click(); a.remove();
}
export function downloadText(text, filename, type) {
  const a = document.createElement("a"); a.download = filename;
  a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain;charset=utf-8" }));
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function loadScript(src, test) {
  return new Promise((res, rej) => {
    if (test()) return res();
    const s = document.createElement("script"); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("load " + src));
    document.head.appendChild(s);
  });
}
export const QR_LIB = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
export const JSQR_LIB = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
export const ZIP_LIB = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

/** 將資料庫錯誤訊息轉為中文 */
export function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || "";
  const map = {
    REG_CLOSED: "目前未開放報名。", NO_CONSENT: "請勾選同意個人資料蒐集告知事項。", MISSING_FIELDS: "請填寫姓名、服務單位與電子郵件。",
    BAD_EMAIL: "電子郵件格式不正確。", REG_FULL: "報名人數已額滿，感謝您的關注。", DUP_EMAIL: "此電子郵件已完成報名，請使用「查詢報到證」。",
    NO_PERMISSION: "您的帳號沒有執行此操作的權限。", "Invalid login credentials": "電子郵件或密碼不正確。",
    "Email not confirmed": "此帳號尚未完成電子郵件驗證，請至信箱點選驗證連結。",
  };
  for (const k in map) if (m.includes(k)) return map[k];
  if (/network|fetch/i.test(m)) return "網路連線不穩，請稍後再試。";
  if (/duplicate key/i.test(m)) return "資料重複，請確認代碼或電子郵件是否已存在。";
  if (/網域/.test(m)) return m;
  return "操作未完成，請稍後再試。" + (m ? `（${m}）` : "");
}
