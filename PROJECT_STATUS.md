# AI社群小編：專案狀態與後續規劃

更新日期：2026-08-13

## 專案定位

本專案是本機執行的 AI 社群內容工具：輸入神明名稱、補充說明與可選的圖片／影片，由 Gemini 產生社群文案，編輯後保存草稿並排程發布。目前正式發布串接只有 Facebook 粉專。

## 多客戶／多目標（Phase 1 骨架）

- [x] 代操模式：頂欄切換客戶；資料存 `data/clients.json`
- [x] 一則貼文可掛多個發布目標（文案／時間可異）；排程以 target 為準
- [x] 編輯預覽一次只編一個帳號目標
- [x] 非 Facebook 到期標 `skipped_unsupported`；僅 FB 真發布
- [x] 設計規格：`docs/superpowers/specs/2026-08-13-multi-client-publishing-design.md`
- [x] 手機優化（v0.3.3／v0.3.4）：頂欄精簡、導覽／pill 依文字縮寬
- [x] UX（v0.3.5）：產生頁不再選平台／帳號（只留格式）；「要發哪裡」只在編輯預覽勾帳號；預覽版型跟目前帳號走
- [x] Facebook 發布格式（v0.3.6）：貼文＋Reel（`video_reels`）＋限時動態（`photo_stories`／`video_stories`）皆可真發；編輯預覽可選此帳號格式

## 已完成

### 產文與媒體

- [x] 圖片／影片可選填；沒有素材也可以產生文案。
- [x] 最多 10 個媒體檔案，單檔 20MB。
- [x] 支援拖曳上傳、檔案選擇與媒體預覽。
- [x] 媒體卡片可拖曳或用上下按鈕調整順序。
- [x] 產文時將媒體順序保存到 `mediaPaths`。
- [x] 預設 Hashtag 可在產文前修改，預設為 `#神像彩繪 #宮廟藝術 #傳統工藝 #台灣信仰`。
- [x] Facebook 文案與 Reel 文案自動分段。
- [x] Gemini 503／429 等暫時性錯誤會自動退避重試並切換備援模型。

### 使用介面

- [x] 工作區分頁：產生文案、編輯預覽、草稿、排程。
- [x] 編輯與即時預覽在同一個畫面，避免反覆切換。
- [x] 預覽頁可切換 Facebook、Instagram、Threads、LINE VOOM 版型。
- [x] 產生文案頁可選發布平台、帳號、發布格式與格式設定。
- [x] 桌機左右布局、窄螢幕上下布局。
- [x] 前端資源使用 `?v=YYYYMMDD-N` 版號避免快取。

### 資料與發布

- [x] 神明資料保存於 `data/gods.json`。
- [x] 草稿保存於 `data/posts.json`。
- [x] 排程保存於 `data/schedule.json`。
- [x] 草稿保存媒體順序、平台、帳號、發布格式與 `contentSettings`。
- [x] Facebook 支援文字貼文、多張圖片、單一影片發布。
- [x] Facebook 排程器每 30 秒檢查到期項目，暫時性發布錯誤最多重試 3 次。
- [x] 平台與連線設定分離，已建立多平台發布目標資料模型。

### 可編輯設定

- [x] AI 系統提示詞：`prompts/social.txt`。
- [x] Gemini 輸出 schema：`prompts/social-schema.json`。
- [x] 產文上下文標籤與無素材規則：`prompts/generation-context.json`。
- [x] Gemini 模型、備援模型、重試次數與延遲：`.env`。

## 尚未完成／後續工作

### 高優先

- [ ] 完成 Facebook Reel API 發布。
- [ ] 完成 Facebook 限時動態 API 發布。
- [ ] 完成 Instagram 帳號連接與發布 API。
- [ ] 完成 Threads 帳號連接與發布 API。
- [ ] 完成 LINE VOOM 帳號連接與發布 API。
- [ ] 為每個平台建立獨立 publisher adapter，依 `channel + contentType` 發布。
- [ ] 建立真正的帳號管理介面：新增、重新授權、停用、刪除帳號。
- [ ] 使用 OAuth 管理平台授權，不再只依賴 `.env` 單一 Facebook 帳號。

### 中優先

- [ ] 為不同平台產生真正不同的文案欄位，目前預覽主要沿用 Facebook／Reel 文案。
- [ ] 完成各平台格式設定的實際驗證，例如影片比例、長度、圖片數量與文字長度。
- [ ] 排程編輯、取消、刪除與手動立即發布。
- [ ] 排程時區、夏令時間與失敗通知處理。
- [ ] 上傳檔案清理策略，避免 `uploads/` 長期累積。
- [ ] 更完整的無素材產文測試、多平台設定測試與 API 錯誤測試。

### 上線前必要工作

- [ ] 加入登入與權限控管。
- [ ] 將 JSON 檔案改為正式資料庫或具鎖定／備份機制的儲存層。
- [ ] Token 加密保存與輪替。
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
| `public/app.js` | 前端互動、分頁、上傳、預覽與 API 呼叫 |
| `public/style.css` | 介面樣式與響應式布局 |
| `prompts/social.txt` | Gemini 系統提示詞 |
| `prompts/social-schema.json` | Gemini JSON 輸出格式 |
| `prompts/generation-context.json` | 產文上下文標籤與 fallback 文字 |
| `lib/platforms.js` | 平台與發布格式定義 |
| `lib/platform-accounts.js` | 平台帳號模型 |
| `lib/facebook.js` | Facebook Graph API publisher |
| `lib/gemini-retry.js` | Gemini 重試與錯誤處理 |
| `data/gods.json` | 神明資料 |
| `data/posts.json` | 草稿與貼文資料 |
| `data/schedule.json` | 排程資料 |

