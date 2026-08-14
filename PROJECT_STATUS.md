# ShrineFlow：專案狀態與後續規劃

更新日期：2026-08-14（v0.5.20）

## 專案定位

本專案是本機執行、單一操作員使用的 AI 社群內容營運工具：輸入內容主題或對象、補充說明與可選的圖片／影片，由 Gemini 產生平台中立母稿，再分別編輯、預覽、排程與發布到多個平台。不使用資料庫，內容與設定以 JSON／環境設定保存。

## 單人操作／多品牌／多平台

- [x] 單一操作員工作流；保留多品牌切換，資料存 `data/clients.json`
- [x] 一則內容可掛多個發布平台 target，文案／格式／時間可各自不同
- [x] 編輯預覽以目前平台 target 為單位，對外用語統一為「多平台」
- [x] Facebook、Instagram、Threads 的發布 adapter 與 target 狀態已接入；平台能力不足時不宣稱成功
- [x] Facebook 使用平台原生排程；Instagram／Threads 使用本機到期發布
- [x] 規劃文件：`docs/superpowers/specs/2026-08-14-general-social-publishing-roadmap.md`、`docs/superpowers/specs/2026-08-14-responsive-web-ui-plan.md`

## 已完成

### 產文與媒體

- [x] 圖片／影片可選填；沒有素材也可以產生文案。
- [x] 最多 10 個媒體檔案，單檔 20MB。
- [x] 支援拖曳上傳、檔案選擇與媒體預覽。
- [x] 媒體卡片可拖曳或用上下按鈕調整順序。
- [x] 產文時將媒體順序保存到 `mediaPaths`。
- [x] 預設 Hashtag 可在產文前修改，預設為 `#品牌內容 #社群經營 #內容行銷`。
- [x] Facebook 文案與 Reel 文案自動分段。
- [x] Gemini 503／429 等暫時性錯誤會自動退避重試並切換備援模型。

### 使用介面與響應式規劃

- [x] UI-0：桌機 sidebar、平板 drawer、手機 bottom navigation 與 hash route。
- [x] UI-1：內容列表、搜尋、狀態與平台篩選。
- [x] UI-2：單頁 Composer、母稿、平台策略提示與即時預覽。
- [x] UI-3：月／週／列表日曆與手機行程列表。
- [x] UI-4：素材庫、發布紀錄、平台連線與設定入口。
- [x] UI-5：模板建立／編輯／套用、Campaign 內容關聯與發布進度，以及不虛構數據的 Insights／Inbox 狀態頁。
- [x] 編輯與即時預覽在同一個畫面，避免反覆切換。
- [x] 預覽頁可切換 Facebook、Instagram、Threads 版型與平台策略提示。
- [x] 桌機左右布局、平板單欄、手機單欄與 44px 觸控區域。
- [x] 前端資源 `?v=`、`/api/config` 與 `package.json` 版號同步。

### 資料與發布

- [x] 舊有 `data/gods.json` 僅作 legacy 相容；新的內容流程不要求神明資料。
- [x] 草稿保存於 `data/posts.json`。
- [x] 排程保存於 `data/schedule.json`。
- [x] 草稿保存媒體順序、平台、帳號、發布格式與 `contentSettings`。
- [x] Facebook 支援文字貼文、多張圖片、單一影片發布。
- [x] Facebook 排程器每 30 秒檢查到期項目，暫時性發布錯誤最多重試 3 次。
- [x] 日曆支援排程編輯、取消、重排與失敗重試；Composer 支援手動立即發布，且會阻止未儲存內容送出。
- [x] 平台與連線設定分離，已建立多平台發布目標資料模型。
- [x] 模板保存於 `data/templates.json`，Campaign 保存於 `data/campaigns.json`，不引入資料庫。

### 可編輯設定

- [x] AI 系統提示詞：`prompts/social.txt`。
- [x] Gemini 輸出 schema：`prompts/social-schema.json`。
- [x] 產文上下文標籤與無素材規則：`prompts/generation-context.json`。
- [x] Gemini 模型、備援模型、重試次數與延遲：`.env`。

## 尚未完成／後續工作

### 下一階段

- [x] 手動與排程發布保存 attempt 歷史；target 僅保留近期摘要，事件依月份分檔，並以 idempotency key 阻止重複發布；歷史最多保留 24 個月，每月檔案最多 10,000 筆，追加時裁切最舊資料並清理過期檔案。
- [x] 接入 Facebook／Instagram／Threads Insights API，依平台帳號顯示 API 回傳的真實成效；未設定、權限錯誤與無資料狀態不虛構數字。
- [x] Insights 同步成功時保存完整月份快照；即時同步失敗時可回退到有時間戳的 cached 資料。
- [x] Insights 按 post target 保存，並補齊各平台貼文 Insights endpoint；可在成效頁切換平台總覽／已發布內容，歷史快照按月份保存且每次查詢最多回傳 100 筆；歷史最多保留 24 個月，每月最多 5,000 筆。
- [x] Inbox 第一階段接入 Facebook／Instagram 對話與 Threads 回覆，只讀 provider-backed 資料，不建立永久訊息倉儲。
- [x] Inbox 未讀／標籤／備註與同步 cursor：只保存本機 metadata，不保存訊息全文；無註記暫存狀態最多 2,000 筆，cursor 每個平台連線只留一份；Webhook 同步提示最多 200 筆，單一提示事件計數封頂。
- [x] Inbox provider 回覆：Facebook／Instagram／Threads 只在 capability 與識別資料具備時送出；不保存回覆全文。
- [x] Inbox webhook 驗證邊界：GET verify token、POST HMAC 簽章驗證，事件只回 ACK 不落地。
- [x] Inbox webhook 事件同步與 provider cursor 自動推進：驗證簽章後依品牌平台擁有者 ID 對應帳戶，清除舊 cursor 並建立有上限的同步提示；下一次 provider 讀取會從最新資料開始，成功後清除提示，不保存 webhook 訊息正文。
- [x] 備份／匯出、還原與媒體清理策略：備份不含秘密、還原自動先建立安全備份，未使用素材必須明確確認才刪除；備份最多 30 份／180 天，事件與 Insights 歷史最多 24 個月且單月有上限，避免持久化資料無限膨脹。
- [x] 平台 Token 健康檢查與到期提示：保存最後驗證／失敗狀態，設定頁支援選填到期日；未提供日期時不猜測。

### 中優先

- [ ] 為不同平台提供主動式 AI 改寫與「沿用母稿／已覆寫／還原母稿」狀態。
- [ ] 完成各平台格式設定的實際驗證，例如影片比例、長度、圖片數量與文字長度。
- [ ] 排程時區、夏令時間與失敗通知處理。
- [ ] 上傳檔案清理策略，避免 `uploads/` 長期累積。
- [ ] 更完整的無素材產文測試、多平台設定測試與 API 錯誤測試。

### 上線前必要工作

- [ ] 加入登入與權限控管。
- [ ] 將 JSON 檔案改為正式資料庫或具鎖定／備份機制的儲存層。
- [x] Token at-rest encryption：設定 SHRINEFLOW_MASTER_KEY 後，品牌平台 Token 與環境設定秘密下一次寫入以 AES-256-GCM 加密；未設定時明確顯示未啟用。
- [x] Token rotation：設定頁可要求輸入目前主密鑰與新主密鑰，先驗證舊密鑰後，以安全備份與回復流程重新加密品牌平台 Token 與環境設定秘密；輪替備份只在請求期間存在，不累積歷史副本。
- [ ] Facebook App Review／Business Verification。
- [ ] 平台 API 速率限制、Webhook、監控與錯誤記錄。
- [ ] 正式部署、HTTPS、備份與還原流程。

## 重要資料結構

排程項目目前使用以下核心欄位：

```json
{
  "postId": "草稿 ID",
  "channel": "facebook",
  "accountId": "facebook:default",
  "contentType": "post",
  "contentSettings": {},
  "scheduledAt": "2026-08-13T10:00:00.000Z",
  "status": "pending"
}
```

`channel` 是平台，`accountId` 是該平台的帳號，`contentType` 是發布格式；三者不要合併成單一欄位。

## 開發與驗證

```powershell
npm install
npm start        # 一般啟動：http://localhost:3000
npm run dev      # 後端 server.js 自動監看模式
npm test         # 執行全部測試
```

- 修改 `server.js` 等後端邏輯，需重新啟動；開發時可用 `npm run dev`。
- 修改 `public/app.js`、`public/style.css` 或 HTML，使用者按 F5 即可。
- 修改前端資源後，請在 `public/index.html` 同步遞增 `?v=` 版號。
- 修改 `prompts/` 下的提示詞、schema 或產文上下文，下一次產文會重新讀取，不需重啟。

## 主要檔案

| 檔案 | 用途 |
| --- | --- |
| `server.js` | Express API、Gemini 產文、草稿、排程與啟動入口 |
| `public/index.html` | 頁面結構與表單 |
| `public/app.js` | 前端互動、路由、資料刷新、上傳、預覽與 API 呼叫 |
| `public/modules/` | Composer、內容、日曆、素材庫、發布紀錄與平台連線模組 |
| `public/style.css` | App Shell、元件樣式與桌機／平板／手機響應式布局 |
| `prompts/social.txt` | Gemini 系統提示詞 |
| `prompts/social-schema.json` | Gemini JSON 輸出格式 |
| `prompts/generation-context.json` | 產文上下文標籤與 fallback 文字 |
| `lib/platforms.js` | 平台與發布格式定義 |
| `lib/platform-accounts.js` | 平台帳號模型 |
| `lib/facebook.js` | Facebook Graph API publisher |
| `lib/gemini-retry.js` | Gemini 重試與錯誤處理 |
| `data/gods.json` | 舊版神明資料，僅供 legacy 相容 |
| `data/posts.json` | 草稿與貼文資料 |
| `data/schedule.json` | 排程資料 |
| `data/templates.json` | 可重用內容模板 |
| `data/campaigns.json` | Campaign 與內容關聯 |

