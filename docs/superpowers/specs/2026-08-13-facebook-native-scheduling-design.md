# Facebook 原生排程 — 設計規格

日期：2026-08-13  
狀態：設計核准，待實作計畫  
前置：`2026-08-13-multi-client-publishing-design.md`（多客戶／多目標）  
決策：排程＝立刻進 FB 粉專排程佇列（方案 1）；改時間／取消同步 FB；限時禁止排程

---

## 1. 這次要解決什麼

現況「排程」只把 `scheduledAt` 寫進本機 JSON，由本機 `scheduler` 到點再呼叫 Graph **立刻發布**。  
缺點：服務／電腦沒開就發不出去；與粉專後台「排程貼文」體驗不一致。

本規格改成：

- 使用者按排程時，**立刻**把內容送到 Facebook，並指定公開時間
- 內容進入粉專原生排程佇列；到點由 **Facebook** 公開，不依賴本機開機
- 本後台改時間／取消時，**同步**增刪 FB 排程貼，避免兩邊不一致

---

## 2. 成功標準與非目標

| 項目 | 決定 |
| --- | --- |
| 成功標準 | FB「貼文」「Reel」排程成功後，粉專後台可見對應排程；關機仍會到點公開；改時間／取消會反映到 FB |
| 成功標準 | 限時動態無法排程（UI＋API 明確拒絕）；立刻發布仍可用 |
| 成功標準 | 本機不再對已交 FB 排程的 target 執行「到期真發」，避免雙重發布 |
| 非目標 | Instagram／LINE／Threads 真排程；完整自動把 FB 已公開狀態同步回本機（可 Phase 後補） |
| 非目標 | 限時動態原生排程（Graph 無對等能力） |

---

## 3. 白話行為

1. 選 FB 帳號＋貼文或 Reel＋未來時間 → 確認排程  
2. ShrineFlow **當下**上傳／建立內容，並告訴 FB「這時間再公開」  
3. 本機標記 `scheduled`，記下 FB 回傳的 `externalId`  
4. 到點：FB 自己公開；本機可仍顯示 `scheduled` 直到之後手動刷新或後續同步（Phase 1 不強制自動改 `published`）  
5. 改時間：刪除（或替換）舊 FB 排程 → 再建新排程 → 更新本機時間與 `externalId`  
6. 取消：刪 FB 排程貼 → 本機回到可編輯狀態（清排程欄位）  
7. 限時：不能排程，只能立刻發  

---

## 4. 與多客戶規格的關係

沿用 `posts.targets[]` 為唯一排程真相：

- `scheduledAt`：預計公開時間（ISO）  
- `status: scheduled`：**語意改為**「已交 FB 排程佇列」（不再是「等本機 scheduler 發」）  
- `externalId`：FB 排程貼／影片 ID（改時間、取消、除錯用）  
- 仍以 target 為單位；一則貼文多帳號各自排各自的  

`2026-08-13-multi-client-publishing-design.md` 中「到期由排程器處理」對 **Facebook 貼文／Reel** 改為本規格；其他平台 Phase 1 仍不真排。

---

## 5. Graph／發布規則

### 5.1 支援矩陣（Facebook）

| contentType | 排程 | 立刻發布 |
| --- | --- | --- |
| `post`（文字／單圖／多圖／單影片） | ✅ 原生 `scheduled_publish_time` | ✅ |
| `reel` | ✅ 原生排程（依現有 Reel 上傳流程加上排程參數） | ✅ |
| `story` | ❌ 禁止 | ✅ |

### 5.2 時間窗

- 必須晚於「現在」足夠緩衝（實作對齊 Graph：約 **≥ 10 分鐘**）  
- 不得超過 Graph 允許上界（約 **6 個月**）  
- 不合規：API 回 400，中文錯誤說明，本機不寫成 `scheduled`

### 5.3 建立排程（概念）

對 `post`／`reel` 的既有上傳／`feed`／`photos`／`videos`／Reel 路徑，在「建立公開內容」時改為：

- `published=false`（或平台等價「未公開」）  
- `scheduled_publish_time=<unix 秒>`  

回傳 ID 寫入 target.`externalId`。

### 5.4 改時間

1. 若已有 `externalId`：刪除該 FB 排程物件（Graph DELETE 或文件規定之取消方式）  
2. 以新時間重新走「建立排程」  
3. 更新本機 `scheduledAt`、`externalId`；失敗則保留舊狀態並回錯誤（不可靜默只改本機）

### 5.5 取消

1. 有 `externalId` → 刪 FB 排程  
2. 本機：`status` 回到 `draft`（或明確 `cancelled` 若既有狀態機已有；否則 `draft`），`scheduledAt=null`，`externalId=null`，清 `lastError`  
3. FB 刪除失敗 → 本機不假裝已取消，回錯誤

### 5.6 立刻發布

不帶 `scheduled_publish_time`；行為維持現況 `publisher.publish(...)`。

---

## 6. API／模組變更

| 模組 | 變更 |
| --- | --- |
| `lib/facebook.js` | `publish` 支援 `scheduledAt`／`schedule: true`；新增刪除排程貼；Reel／貼文路徑帶排程參數 |
| `lib/routes/schedule.js` | `POST /schedule`：對 FB post／reel **當下**呼叫原生排程；story → 400；成功才寫 `scheduled`＋`externalId` |
| 取消／改時間路由 | 既有或新增 endpoint：同步 FB；禁止只改 JSON |
| `lib/scheduler.js` | **停用**對 FB `scheduled` target 的「到期真發」；避免與 FB 佇列雙發。可保留 timer 空轉或僅處理非 FB／舊 pending 遷移清理 |
| 前端 | 限時選中時禁用排程按鈕／時間欄並提示；錯誤訊息顯示 Graph／時間窗原因 |

---

## 7. 狀態語意（FB target）

| status | 意義 |
| --- | --- |
| `draft` | 未交 FB，或已取消排程 |
| `scheduled` | 已在 FB 排程佇列（有 `externalId`＋`scheduledAt`） |
| `publishing` | 僅用於立刻發布進行中（若適用）；原生排程建立過程可用短暫狀態或直接成功／失敗 |
| `published` | 已知已公開（立刻發成功；或之後同步補上） |
| `failed` | 交 FB 排程或刪除／重建失敗 |

貼文層彙總規則仍依多客戶規格（任一 target `scheduled` → 貼文可顯示 `scheduled` 等）。

---

## 8. 錯誤處理

- 單一 target 失敗不影響其他 target  
- 建立排程失敗：本機不標 `scheduled`  
- 改時間時「刪成功、建失敗」：標 `failed`＋`lastError`，提示可能需到粉專後台檢查（實作盡量用交易式順序降低此窗）  
- Token／帳號未設定：400／明確訊息  

---

## 9. 測試範圍

- `facebook` publisher：帶／不帶 `scheduled_publish_time`；刪除排程；Reel 排程參數  
- `schedule` 路由：post／reel 成功路徑（mock Graph）；story 拒絕；時間窗拒絕  
- 改時間、取消：mock 刪＋建順序  
- `scheduler`：到期掃描**不會**再對已 `scheduled` 的 FB target 呼叫立刻 `publish`  
- 純前端擋限時排程可不跑後端全套；後端改動跑對應 `node --test` 檔  

---

## 10. Phase 邊界

### 本規格

- FB 貼文＋Reel 原生排程  
- 改時間／取消同步 FB  
- 限時禁止排程  
- 停用本機對 FB 到期真發  

### 之後（不承諾）

- 輪詢／webhook 把 FB 已公開同步成 `published`  
- Reel 若某 Graph 版本參數差異的相容表擴充  
- 其他平台原生排程  

---

## 11. 決策紀錄

| 問題 | 選擇 |
| --- | --- |
| 排程模型 | 立刻進 FB 佇列（方案 1） |
| 改時間／取消 | 同步 FB（A） |
| 格式範圍 | 有排程能力的都要；限時因 API 禁止排程（A） |
| 本機 scheduler | 不再對 FB scheduled 到期真發 |

---

## 12. 自檢摘要

- 無 TBD；限時／時間窗／雙重發布風險已寫明  
- 與多客戶 `targets` 模型一致；僅改 FB 排程語意與執行點  
- 失敗不靜默只改本機  
- Phase 邊界清楚：不做跨平台、不做強制公開狀態自動同步  
