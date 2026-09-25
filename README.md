# 健康台灣深耕計畫兒童醫院永續發展論壇｜活動網站與報到系統

2026年11月27日（五）13:00–17:30｜中國醫藥大學 立夫教學大樓 B1 國際會議廳

## 系統組成

| 頁面 | 對象 | 功能 |
|---|---|---|
| `index.html` | 所有人 | 活動首頁：議程、貴賓、交通、會場導引 |
| `register.html` | 報名來賓 | 線上報名、查詢報到證 |
| `ticket.html` | 報名來賓 | 個人報到證（QR code）、下載、加入行事曆 |
| `admin.html` | 工作人員 | 帳號登入、報名概況儀表板、現場報到、名單、統計、網站內容編輯、人員權限 |
| Google 試算表 | 承辦人 | 每 5 分鐘自動同步報名資料與統計摘要（Apps Script） |

- 網頁：GitHub Pages（靜態網站，不需伺服器）
- 資料庫與帳號：Supabase（PostgreSQL＋Auth，權限由資料庫的 Row Level Security 強制執行）

## 檔案結構

```
index.html / register.html / ticket.html / admin.html
assets/css/      site.css（前台）、form.css（報名頁）、admin.css（後台）
assets/js/       config.js（連線設定）、common.js（共用）、site.js、register.js、ticket.js、admin.js
assets/img/      kv.jpg（主視覺）、logo.png
data/event.json  網站預設內容（資料庫無內容時的備援）
supabase/schema.sql  資料庫結構與權限設定
google-apps-script/Code.gs  Google 試算表同步程式
.nojekyll        讓 GitHub Pages 直接提供檔案
```

## 部署步驟

### 第一步：建立 Supabase 專案（約 10 分鐘）

1. 至 https://supabase.com 註冊並建立新專案，區域建議選擇 Northeast Asia (Tokyo) 或 Southeast Asia (Singapore)。
2. 開啟 `supabase/schema.sql`，先修改第 0 節的 `staff_allowed_domains()`，填入醫院電子郵件網域，例如 `array['your-hospital.org.tw']`。
3. 進入 Supabase 專案的 **SQL Editor**，貼上 `schema.sql` 全部內容後按 **Run**。
4. 進入 **Project Settings → API**，複製 **Project URL** 與 **anon public key**。
5. 將兩者填入 `assets/js/config.js`。**請勿填入 service_role key。**

### 第二步：上傳至 GitHub 並開啟 Pages（約 10 分鐘）

1. 在 GitHub 建立新的儲存庫（Repository），例如 `cmuch-forum-2026`。
2. 點選 **Add file → Upload files**，將本資料夾內所有檔案（含 `.nojekyll`）拖曳上傳後 **Commit**。
3. 進入 **Settings → Pages**，Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`，按 **Save**。
4. 約 1 至 3 分鐘後，網址會顯示在同一頁，格式為 `https://帳號.github.io/cmuch-forum-2026/`。

### 第三步：設定 Supabase 登入網址

進入 Supabase **Authentication → URL Configuration**：
- **Site URL**：填入 GitHub Pages 網址
- **Redirect URLs**：加入 `https://帳號.github.io/cmuch-forum-2026/admin.html`

### 第四步：建立第一位管理者

1. 開啟 `admin.html`，點選「申請帳號」，使用醫院電子郵件註冊。
2. 至信箱點選驗證連結。
3. 回到 Supabase **SQL Editor** 執行：
   ```sql
   update public.staff_roles set role = 'admin' where email = '您的電子郵件';
   ```
4. 重新整理 `admin.html` 並登入。

### 第五步：建立網站內容

1. 後台 →「網站內容」→「載入預設內容」。
2. 逐項確認後按「儲存並發布」。之後所有修改都在後台完成，不需再改 GitHub 檔案。
3. 至「報名設定」確認個資告知聲明後，勾選「開放線上報名」並儲存。

## Google 雲端硬碟同步

報名資料每 5 分鐘自動寫入您 Google 雲端硬碟中的試算表，含三個工作表：

| 工作表 | 內容 |
|---|---|
| 報名資料 | 每位報名者一列：代碼、姓名、單位、職稱、電子郵件、電話、類別、來源、報名時間、報到狀態與時間 |
| 統計摘要 | 報名總數、今日新增、報到率、各類別、各單位（前 15）、每日報名與累計人數 |
| 同步紀錄 | 每次同步的時間、結果與筆數（保留最近 500 筆） |

同步是單向的：試算表只讀取資料，不會改動網站或資料庫。**「報名資料」工作表每次同步都會整張覆寫，請勿在上面編輯**；如需註記，請另開工作表。

### 設定步驟（需用電腦操作，約 10 分鐘）

1. 完成上方「部署步驟」第一至四步，並已重新執行最新版 `supabase/schema.sql`（含第 8 節同步功能）。
2. 登入管理後台 →「報名概況」→ 最下方「產生同步金鑰」，**立即複製**。金鑰只顯示一次。
3. 開啟 Google 雲端硬碟中的試算表「論壇報名資料（自動同步）」。
4. 點選 **擴充功能 → Apps Script**，刪除編輯器中的預設內容，貼上 `google-apps-script/Code.gs` 全部內容，按儲存。
   （在 GitHub 開啟該檔案，點右上角「Copy raw file」即可一次複製。）
5. 回到試算表並重新整理，上方選單會出現「論壇報名同步」。
6. 點選 **論壇報名同步 → 1. 設定連線**，依序貼上 Supabase 專案網址、anon public key、同步金鑰。
   第一次執行時 Google 會要求授權，選擇您的帳號 →「進階」→「前往（不安全）」→「允許」。這是因為程式是您自己建立的，尚未經 Google 審核，屬正常情況。
7. 點選 **2. 立即同步**，確認資料寫入。
8. 點選 **3. 啟用每 5 分鐘自動同步**。之後關閉試算表也會持續同步。

完成後，管理後台「報名概況」會顯示最後同步時間與試算表連結；超過 20 分鐘未同步會出現提醒。

### 同步金鑰的安全性

- 金鑰只能讀取報名資料，無法修改任何內容。資料庫只保存金鑰的雜湊值。
- 懷疑外洩時，在後台按「產生新同步金鑰」，舊金鑰立即失效，再到試算表重新執行「1. 設定連線」。
- 同步程式會拒絕儲存 service_role key。
- 試算表含報名者個資，**請勿開啟「知道連結的任何人」共用**；若需與同仁共用，請逐一指定帳號並設為「檢視者」。

## 人員權限

| 權限 | 可執行 |
|---|---|
| 管理者 | 開關報名、產生同步金鑰、編輯網站內容、開關報名、匯入與刪除名單、下載報到證、管理人員權限 |
| 報到人員 | 掃描報到、取消報到、現場登記、查看名單與統計 |
| 檢視者 | 查看報名概況、名單與即時統計（適合長官） |
| 待審核 | 無法使用任何功能（新申請帳號的預設狀態） |

新增工作人員：請同仁至 `admin.html` 申請帳號並完成信箱驗證，由管理者於「人員權限」指定權限。

## 活動當天建議配置

- 報到桌：筆電＋USB 條碼掃描槍（游標停在輸入框即可連續掃描）
- 備援：手機或平板以鏡頭掃描，或以姓名搜尋報到
- 貴賓：由接待人員以姓名搜尋協助報到，不需請貴賓出示手機
- 長官：開通「檢視者」權限，可隨時查看即時到場統計

## 注意事項

1. **GitHub 儲存庫為公開時，所有檔案內容都可被查看。** `config.js` 的 anon key 設計上可公開，資料安全由資料庫權限規則保護。`data/event.json` 已移除邀請中貴賓的姓名、職稱與單位，請在後台「網站內容 → 貴賓」補填；補填的資料存在資料庫，對外頁面只會取得已確認貴賓的資料（除非勾選「對外顯示邀請中貴賓」）。請勿將含邀請中貴賓姓名的檔案上傳到 GitHub，即使之後刪除，舊版本仍會留在提交紀錄中。
2. **Supabase 免費方案有閒置暫停與用量限制**，實際規定以 Supabase 官網公告為準。活動期間建議每週登入後台一次，並於活動前一週確認服務正常。
3. **Supabase 預設的寄信服務有每小時寄送數量限制**，僅適合少量工作人員帳號驗證。若需大量寄信，請於 **Authentication → SMTP Settings** 設定醫院郵件伺服器。
4. **個人資料**：報名資料存放於 Supabase 雲端主機（位於境外），並同步一份至 Google 試算表。正式開放報名前，請先確認符合院內個資管理及資訊安全規範，並依院內規定訂定資料保存期限；活動結案後可於後台「匯入與匯出」刪除全部報名資料。
5. **自訂網域**：若要使用醫院網域，請資訊室設定 DNS（CNAME 指向 `帳號.github.io`），並於 GitHub **Settings → Pages → Custom domain** 填入。
