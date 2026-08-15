# ShrineFlow 通用型單人社群發布系統——產品與實作規劃

> 日期：2026-08-14  
> 規劃基線：v0.3.19  
> 文件狀態：已依需求重新分析，作為後續開發主規格  
> 適用架構：Express + 靜態 HTML/CSS/JavaScript + 本機 JSON 檔案

響應式網頁與手機介面細節另見：`2026-08-14-responsive-web-ui-plan.md`。

## 0. 已確認的產品決策

本規格以以下四項要求為最高優先：

1. **產品改為通用型社群內容工具，不再限定神明、宮廟、宗教或神像內容。**
2. **目前只有一位操作使用者。** 不做多使用者、角色、權限矩陣、送審與核准流程，但資料模型保留未來擴充空間。
3. **在單人與本機架構下盡可能完善。** 完整度優先放在內容管理、AI 產文、跨平台變體、素材、排程、發布可靠性、紀錄、版本、備份與成效回看。
4. **不使用資料庫。** 所有結構化資料使用 JSON 檔案；媒體保留在 `uploads/`，並強化原子寫入、備份、復原、遷移與檔案輪替。

另有一項延續現況的合理假設：

- **保留多客戶／多品牌／多平台發布。**「單人」指一位操作員，不代表只能管理一個品牌或只能發布到一個平台。這也是目前 `clients + accounts + targets` 架構最有價值的部分。

## 1. 重新分析競品後的產品方向

### 1.1 Hootsuite 可借鑑的部分

Hootsuite 的核心不是單純排程，而是把建立、排程、發布、訊息、分析、協作與社群聆聽整合成一個營運中台。適合 ShrineFlow 借鑑的部分：

- 統一內容日曆與列表。
- 一則內容對應多個社群帳號。
- 平台個別文案與素材。
- 發布前檢查。
- 每個 target 獨立發布結果。
- 發布紀錄、失敗原因與重試。
- 最佳發布時間與成效資料可作為後續功能。

目前不採用：

- 企業級多層審核。
- 多部門與多使用者權限。
- SSO、合規整合、團隊績效。
- 大規模社群聆聽、情緒分析與競品監控。

### 1.2 Buffer 可借鑑的部分

Buffer 的價值在於把複雜社群工作拆成容易理解的 Create、Publish、Community、Insights 與 Collaborate。ShrineFlow 應採用其「低學習成本」原則：

- 主導覽不超過一眼可理解的範圍。
- 先建立共用內容，再按平台調整。
- AI 是編輯輔助，不應綁死整個工作流。
- 草稿、排程、已發布與失敗內容都能在同一內容中心搜尋。
- 日曆與佇列是內容營運核心，不是附屬畫面。

目前不採用 Collaborate 的團隊審核，但保留版本歷史與操作紀錄，讓單人也能復原誤改。

### 1.3 Meta Business Suite 可借鑑的部分

Meta Business Suite 的最大優勢是原生平台狀態。ShrineFlow 對 Facebook／Instagram 應遵守：

- 遠端平台是已發布與原生排程狀態的權威來源。
- 建立原生排程後必須保存 `externalId`。
- 本機 scheduler 不得再次發布已交給 Meta 原生排程的 target。
- 支援編輯、複製、改期、取消、移回草稿等常用動作。
- 成效資料應標示來源與最後同步時間。

第二輪對照（核心閉環完成後、v0.5.42）：見 `2026-08-15-competitor-feature-gap-analysis.md`。本節保留當時方向，不覆蓋後續 Queue／首則留言／危機暫停等缺口分級。

### 1.4 競品結論

ShrineFlow 不應成為縮小版 Hootsuite，而應成為：

> **單人操作、多品牌、多平台、AI 輔助、檔案式儲存的完整社群內容營運工具。**

核心閉環：

```text
品牌設定
  → 建立主題與素材
  → AI 產生共用內容
  → 平台個別調整
  → 儲存／版本
  → 排程或立即發布
  → 每平台結果與重試
  → 成效回看／再次利用
```

## 2. 現況盤點與真正的領域耦合

目前限制不只存在於文案，已深入前後端資料模型。

| 現有位置 | 現況 | 必要修改 |
|---|---|---|
| `public/index.html` | 必填「神明名稱」、作品介紹／聖誕祝壽、宮廟預設 Hashtag | 改為主題、內容目的、受眾、語氣、重點與 CTA |
| `public/app.js` | 載入 `/api/gods` | 改為品牌設定與內容預設資料 |
| `public/modules/editor.js` | 草稿使用 `godName`、`postType` | 改為 `subject`、`contentGoal` |
| `public/modules/drafts.js` | 草稿卡片以神明名稱當標題 | 改為內部標題／內容主題 |
| `public/modules/state.js` | 預設宮廟 Hashtag | 改由品牌設定決定，沒有品牌設定時為空 |
| `lib/routes/generate.js` | `godName` 必填 | 改為 `subject` 必填，其他通用欄位選填 |
| `lib/ai-service.js` | 查詢 `gods.json`，把神明資料組進 prompt | 改讀品牌 profile、內容目的、受眾與限制 |
| `lib/routes/posts.js` | `godName` 與 Facebook 文案必填 | 改為平台中立的標題／主題與 base content |
| `lib/routes/gods.js` | 神明資料 API | 改為 presets／brand profiles API |
| `lib/store.js` | 固定建立 `gods.json` | 加入通用 JSON 實體、schema 與備份 |
| `prompts/social.txt` | 宮廟文化與神像專用 prompt | 改為通用繁中社群編輯 prompt |
| `prompts/generation-context.json` | 神明欄位標籤 | 改為品牌、主題、受眾、目標、語氣、CTA |
| `data/gods.json` | 神明與宮廟標籤 | 遷移為可選內容 preset，不刪除既有資料 |

現有可保留並擴充的良好基礎：

- `clients.json` 的多品牌／多客戶概念。
- 一篇貼文內含多個 `targets`。
- Facebook、Instagram、Threads publisher。
- Facebook 原生排程與非 Facebook 本機排程。
- 每 target 的 `status`、`externalId`、`attempts`、`lastError`。
- `store.js` 已有 `.tmp → rename` 原子寫入與 process 內 mutation queue。
- Express + 原生 JavaScript 模組化前端。

## 3. 產品定位與範圍

### 3.1 目標使用者

- 一位本機操作員。
- 可管理一個或多個品牌／客戶。
- 可連接每個品牌的 Facebook、Instagram、Threads 等帳號。
- 可製作商品、服務、活動、公告、知識、互動、品牌故事、節慶與自訂內容。

### 3.2 本次完整規劃納入

- 品牌與社群帳號管理。
- 通用 AI 產文。
- Content 列表與搜尋篩選。
- Composer 與即時預覽。
- 共用內容＋平台個別覆寫。
- 媒體上傳、排序、重用與清理。
- 自動儲存與版本歷史。
- 月／週／列表日曆。
- 立即發布、排程、改期、取消、複製、封存。
- 發布佇列、部分成功、錯誤分類與安全重試。
- Templates、Campaigns、Publishing Logs。
- JSON 備份、匯出、還原與 schema migration。
- 後續 Meta Insights。
- 後續輕量 Inbox。

### 3.3 明確不做

- 多使用者帳號系統。
- Writer／Reviewer／Admin 等角色。
- 送審、核准、退件流程。
- 多人即時共同編輯。
- 資料庫。
- 企業級社群聆聽與競品情緒分析。
- CRM、客服 SLA、廣告投放管理。

## 4. 目標資訊架構

主導覽建議：

```text
總覽
內容
日曆
素材
模板
活動
發布紀錄
帳號
設定
```

後續可加入：

```text
成效
訊息
```

### 4.1 總覽

只呈現能採取行動的摘要：

- 今日待發布。
- 未來七天排程。
- 發布失敗。
- 最近已發布。
- 帳號連線異常。
- 素材／Token／公開媒體網址警告。

不建立大量無法操作的 KPI 卡片。

### 4.2 內容

一個列表容納所有狀態，不再把草稿與排程拆成互不相干的資料區。

欄位：

- 縮圖。
- 內部標題／主題。
- 品牌。
- 平台。
- 整體狀態。
- 最近排程時間。
- 最近更新時間。
- 快速動作。

篩選：

- 關鍵字。
- 品牌。
- 平台。
- 帳號。
- 狀態。
- Campaign。
- 日期範圍。

### 4.3 Composer

- 共用內容編輯。
- 平台／帳號 target 選擇。
- 平台覆寫狀態。
- 媒體管理。
- 即時預覽。
- 驗證警告。
- 儲存狀態。
- 版本歷史。
- 排程與立即發布。

### 4.4 日曆

- 月、週、列表三種檢視。
- 顯示品牌、時間、平台、格式、狀態。
- 點擊開啟內容。
- 改期、取消、複製、移回草稿。
- 可支援拖曳改期，但必須有失敗 rollback。

### 4.5 素材

- 上傳進度。
- 圖片／影片預覽。
- 檔名、大小、類型、建立時間。
- 標籤、替代文字、備註。
- 使用中的貼文數量。
- 未使用素材清理。
- 替換與重新排序。

### 4.6 模板與活動

- 模板：常用結構、語氣、Hashtag、CTA 與平台預設。
- Campaign：把多篇內容組成一次活動並集中篩選與回看。
- 不強制每篇內容一定要有模板或 Campaign。

## 5. 通用內容模型

### 5.1 Brand／Client

保留現有 `client` 名稱，語意調整為「品牌／客戶工作區」。

```json
{
  "id": "client-...",
  "name": "品牌名稱",
  "notes": "內部備註",
  "profile": {
    "industry": "產業或內容領域",
    "brandVoice": "品牌語氣",
    "audience": "主要受眾",
    "defaultLanguage": "zh-Hant",
    "defaultTimezone": "Asia/Taipei",
    "defaultHashtags": [],
    "defaultCallToAction": "",
    "requiredPhrases": [],
    "forbiddenClaims": []
  },
  "accounts": []
}
```

### 5.2 Post

`Post` 是內容企劃與共用母稿，不代表任何單一平台。

```json
{
  "schemaVersion": 2,
  "id": "post-...",
  "clientId": "client-...",
  "internalTitle": "八月新品上市",
  "subject": "秋季新品系列",
  "contentGoal": "promotion",
  "audience": "既有客戶與新品關注者",
  "tone": "溫暖、清楚、有行動感",
  "keyPoints": ["新品特色", "上市日期"],
  "callToAction": "前往官網查看",
  "extraNotes": "不要使用限量字眼",
  "baseContent": {
    "text": "共用長文案",
    "shortText": "共用短文案",
    "hashtags": ["#品牌", "#新品"],
    "mediaDescription": "素材視覺摘要"
  },
  "mediaPaths": ["/uploads/example.jpg"],
  "campaignId": null,
  "targets": [],
  "status": "draft",
  "version": 1,
  "createdAt": "2026-08-14T00:00:00.000Z",
  "updatedAt": "2026-08-14T00:00:00.000Z",
  "archivedAt": null
}
```

### 5.3 Target

`Target` 代表「這一篇內容要用哪個帳號、格式與時間發布」。

```json
{
  "id": "target-...",
  "accountId": "facebook:...",
  "platformId": "facebook",
  "contentType": "post",
  "enabled": true,
  "copyMode": "inherit",
  "copyOverride": null,
  "hashtagsOverride": null,
  "mediaPaths": null,
  "contentSettings": {},
  "scheduledAt": null,
  "timezone": "Asia/Taipei",
  "scheduleMode": null,
  "status": "draft",
  "externalId": null,
  "externalUrl": null,
  "publishedAt": null,
  "attempts": 0,
  "lastAttemptAt": null,
  "nextAttemptAt": null,
  "lastError": null
}
```

規則：

- `copyMode=inherit`：使用 `baseContent`。
- `copyMode=override`：使用 target 個別文案。
- `mediaPaths=null`：繼承 Post 素材。
- `mediaPaths=[]`：明確設定為無素材。
- 每個 target 獨立排程、發布、失敗與重試。

### 5.4 Publish Attempt

每次真正呼叫平台 API 都建立一筆 attempt，避免只把最後錯誤覆蓋在 target 上。

```json
{
  "id": "attempt-...",
  "postId": "post-...",
  "targetId": "target-...",
  "idempotencyKey": "...",
  "trigger": "manual",
  "status": "failed",
  "startedAt": "...",
  "finishedAt": "...",
  "retryable": true,
  "failureCategory": "rate_limit",
  "providerCode": "...",
  "providerSubcode": "...",
  "providerTraceId": "...",
  "message": "平台暫時限制，稍後重試",
  "externalId": null
}
```

禁止在 attempt 中保存 Token、完整 request header 或未遮罩憑證。

### 5.5 Media Asset

```json
{
  "id": "media-...",
  "path": "/uploads/example.jpg",
  "originalName": "example.jpg",
  "mimeType": "image/jpeg",
  "size": 123456,
  "width": 1080,
  "height": 1350,
  "durationSeconds": null,
  "altText": "",
  "tags": [],
  "createdAt": "...",
  "checksum": "..."
}
```

### 5.6 Template

```json
{
  "id": "template-...",
  "clientId": null,
  "name": "新品公告",
  "contentGoal": "promotion",
  "tone": "清楚、期待",
  "structure": "開場／特色／時間／CTA",
  "defaultHashtags": [],
  "targetDefaults": []
}
```

### 5.7 Activity／Audit Event

即使只有一位操作員，仍需記錄重要行為以便除錯與復原。

```json
{
  "id": "event-...",
  "actor": "local-user",
  "action": "post.scheduled",
  "entityType": "post",
  "entityId": "post-...",
  "targetId": "target-...",
  "at": "...",
  "summary": "Facebook 排程至 2026-08-20 10:00",
  "metadata": {}
}
```

`actor` 目前固定為 `local-user`；未來若增加多使用者，不需改事件格式。

## 6. 單人狀態機

多使用者審核狀態移除，改為單人自我檢查流程。

### 6.1 Post 整體狀態

```text
DRAFT
  → READY
  → SCHEDULED
  → PUBLISHING
  → PUBLISHED

PUBLISHING
  → PARTIAL_SUCCESS
  → FAILED

其他：CANCELLED、ARCHIVED
```

語意：

| 狀態 | 意義 |
|---|---|
| `draft` | 仍在編輯或尚未通過必要檢查 |
| `ready` | 使用者已確認內容，但尚未排程／發布 |
| `scheduled` | 至少一個 target 已排程，且沒有正在發布的 target |
| `publishing` | 至少一個 target 正在發布 |
| `published` | 所有啟用 target 都成功發布 |
| `partial_success` | 有成功，也有失敗／取消／尚未發布 |
| `failed` | 沒有成功 target，且至少一個失敗 |
| `cancelled` | 全部排程已取消，保留紀錄 |
| `archived` | 內容不再出現在預設列表 |

### 6.2 Target 狀態

```text
DRAFT
  → SCHEDULED
  → QUEUED
  → PUBLISHING
  → PUBLISHED

PUBLISHING
  → RETRYING
  → FAILED

其他：CANCELLED、SKIPPED
```

Post 狀態永遠由 targets 彙總，不直接由 UI 任意指定。

## 7. 自動儲存與版本歷史

單人仍會遇到快速輸入、舊 request 晚回來、F5、瀏覽器關閉與網路錯誤，因此 autosave 必須完整設計。

### 7.1 Autosave 規則

- 新貼文首次手動建立後才啟動 autosave，避免空白內容不斷新增檔案。
- 輸入停止 800～1200ms 後儲存。
- 前端維護 `serverSnapshot`、`localDraft`、`dirtyFields`、`saveSequence`。
- 舊 response 不得覆蓋較新的本機內容。
- 儲存中、已儲存、儲存失敗、正在重試都要有明確狀態。
- 失敗時保留本機 draft，允許手動重試。
- 發布與排程前必須等待最新 autosave 完成。
- 瀏覽器關閉前若仍 dirty，顯示離開警告。

### 7.2 Post version

- 每次 autosave 增加 `version`，用於阻止 stale update。
- 重要節點保存完整快照：手動儲存、排程前、立即發布前、從歷史版本還原前。
- 每篇保留最近 20 個版本；超過後保留每日最後一版。
- 還原版本會產生新版本，不直接覆蓋歷史。

版本歷史不是多使用者審核功能，而是單人誤改復原與發布追溯功能。

## 8. 通用 AI 產文設計

### 8.1 輸入欄位

以以下欄位取代神明資料：

- `subject`：內容主題，必填。
- `contentGoal`：內容目的。
- `audience`：目標受眾。
- `tone`：語氣。
- `keyPoints`：必須傳達的重點。
- `callToAction`：希望讀者採取的行動。
- `extraNotes`：補充與限制。
- `defaultHashtags`：可選。
- `brandProfile`：品牌語氣、禁用宣稱等。
- `media`：圖片／影片，可選。

建議內容目的：

- 品牌／作品介紹。
- 商品／服務推廣。
- 活動／公告。
- 知識／教學。
- 互動／提問。
- 節慶／祝福。
- 品牌故事。
- 自訂。

選項超過四個時使用可換行的卡片／pill grid，不使用狹窄下拉選單隱藏常用選項。

### 8.2 AI 輸出

第一階段 AI 產生平台中立母稿：

```json
{
  "internalTitle": "...",
  "baseText": "...",
  "shortText": "...",
  "hashtags": ["#..."],
  "mediaDescription": "...",
  "warnings": []
}
```

之後在 Composer 針對單一 target 提供「AI 調整成此平台版本」，而不是第一次產文就強迫同時生成所有平台。

理由：

- 使用者可能尚未決定平台。
- 可避免 Facebook 欄位成為所有內容的母體。
- 同一母稿可以之後增加平台。
- 平台限制改變時只需更新平台改寫規則。

### 8.3 AI 安全與品質規則

- 只能描述素材或輸入資訊中可確認的內容。
- 不虛構價格、日期、地點、人物、規格、功效與保證。
- 品牌 `forbiddenClaims` 必須加入 system context。
- 無素材時不得假裝看過圖片。
- Hashtag 去重並限制數量。
- 回傳 warnings，提示缺少日期、價格、連結或 CTA，而不是自行補造。

## 9. 舊資料相容與遷移

不得直接刪除舊神明資料或使既有草稿無法開啟。

### 9.1 欄位遷移

| 舊欄位 | 新欄位／處理 |
|---|---|
| `godName` | `subject` |
| `postType=work` | `contentGoal=showcase` |
| `postType=birthday` | `contentGoal=celebration` |
| `facebook` | `baseContent.text`，同時保留一版 compatibility reader |
| `reel` | `baseContent.shortText` |
| `hashtags` | `baseContent.hashtags` |
| `imageDescription` | `baseContent.mediaDescription` |

### 9.2 API 過渡

- 新 API 使用 `subject` 與 `contentGoal`。
- 一個相容版本內接受 `subject ?? godName`。
- response 只以新欄位為主；舊前端相容期間可額外回 `godName`。
- `/api/gods` 改為 deprecated alias。
- 新 API 使用 `/api/presets` 或直接使用 client profile。
- 完成前後端切換後移除 deprecated alias。

### 9.3 `gods.json`

- 啟動 migration 將每筆資料轉為通用 preset。
- 原始名稱、intro、tags 全部保留。
- 新檔建議為 `data/presets.json`。
- 遷移成功後建立備份，不直接刪除舊檔。

## 10. Composer 操作流程

```text
選擇品牌
  → 新增內容
  → 填主題／目的／受眾／語氣／重點
  → 上傳或選擇素材
  → AI 產生母稿（或自行撰寫）
  → 選擇發布帳號
  → 逐平台調整文案、格式、素材與時間
  → 平台規格檢查
  → 儲存／標記 READY
  → 排程或立即發布
  → 查看每個 target 結果
```

### 10.1 桌面布局

```text
┌─────────────────────────────────────────────────────────┐
│ 返回  內部標題  儲存狀態       儲存／排程／立即發布     │
├──────────────────────────────┬──────────────────────────┤
│ 內容編輯                     │ 平台預覽                 │
│ 品牌／主題／目的             │ Facebook / IG / Threads │
│ 母稿                         │ 規格警告                 │
│ 素材                         │ 文案與媒體預覽           │
│ 平台 target 與覆寫           │ target 發布狀態          │
└──────────────────────────────┴──────────────────────────┘
```

### 10.2 UI 規則

- 保留 ShrineFlow 暖色陶金設計系統，但文案與圖像語意改為通用品牌工具。
- 常用欄位使用 `.field` 與 `.form-group-card` 分組。
- 2～4 個選項使用 segmented radio pills。
- 平台 tabs 使用 `flex-wrap`，不使用水平捲軸。
- Editor／Preview 高度穩定，切 target 不跳動。
- 所有主要操作觸控區至少 44×44px。
- 手機版使用「編輯／預覽」切換與底部 sticky action bar。
- 平台覆寫需顯示「沿用母稿／已覆寫」，並提供「還原母稿」。

### 10.3 發布前檢查

每個 target 顯示：

- 帳號是否已連線。
- 文案是否為空。
- 文字長度。
- 圖片／影片數量。
- 媒體類型、比例、尺寸、長度。
- 是否需要公開媒體 URL。
- 排程時間是否符合平台窗口。
- 是否仍有上傳中的素材。
- 是否有重複發布風險。

錯誤阻止發布；警告允許使用者確認後繼續。

## 11. 平台能力 Registry

平台規則集中在一個 capability registry，不散落在 UI 與 routes。

```json
{
  "platformId": "instagram",
  "contentType": "reel",
  "canPublish": true,
  "canSchedule": true,
  "nativeScheduling": false,
  "requiresPublicMediaUrl": true,
  "allowedMediaTypes": ["video/mp4"],
  "maxMediaCount": 1,
  "maxTextLength": 2200,
  "supportsFirstComment": false,
  "supportsAltText": false
}
```

建議新增：

- `lib/platform-capabilities.js`
- `lib/platform-validation.js`

前端由 `/api/platforms/capabilities` 取得資料，避免前後端規則不同步。

## 12. 排程規則

### 12.1 時間資料

- UI 顯示使用者選擇的 timezone。
- API 同時接受 `localDateTime + timezone` 或明確 ISO instant。
- 儲存 `scheduledAt` 為 UTC ISO。
- Target 另外保存 `timezone`，讓之後顯示與改期不失去原始時區語意。

### 12.2 Native 與 Local

| 模式 | 行為 |
|---|---|
| `native` | 建立平台原生排程，保存 `externalId`，本機不再到期發布 |
| `local` | 本機 scheduler 到期後呼叫 publisher |

Target 必須保存 `scheduleMode`，不能只靠 platform 猜測。

### 12.3 改期與取消

- Native：先更新／刪除遠端，再更新本機。
- Local：更新本機 `scheduledAt`。
- 遠端成功、本機失敗時記錄 reconciliation event，啟動時進行修復提示。
- 取消排程預設回到 `ready`，而不是刪除內容。
- 已進入 `publishing` 後不保證可取消。

### 12.4 日曆互動

- 拖曳改期先顯示 optimistic update。
- API 失敗必須 rollback 並顯示原因。
- 同帳號、同時間的多篇內容顯示衝突警告，但不一律禁止。
- Calendar query 使用日期範圍，避免每次載入全部歷史內容。

## 13. 發布可靠性

### 13.1 Publisher adapter

每個平台實作一致介面：

```text
verifyAccount()
validateTarget()
publish()
scheduleNative()
rescheduleNative()
cancelNative()
fetchStatus()
fetchInsights()
```

平台差異留在 adapter，不進入共用 route。

### 13.2 發布流程

```text
取得 Post + Target
  → 驗證 target 與帳號
  → 等待素材 ready
  → 建立 idempotencyKey
  → 寫入 Publish Attempt
  → target = publishing
  → 呼叫平台
  → 保存 externalId / externalUrl
  → target = published 或 failed/retrying
  → 重算 Post 整體狀態
  → 寫入 Activity Event
```

### 13.3 防重複

- 前端發布按鈕立即 disabled。
- 後端以 target、content version 與 trigger 建立 idempotency key。
- 同一 key 正在執行或已成功時不再呼叫平台。
- 有 `externalId` 的成功 target 不得直接重發。
- 「再次發布」必須透過 Duplicate／Repost 建立新 Post 或新 target。

### 13.4 錯誤分類

| 類別 | 自動重試 | UI 指引 |
|---|---:|---|
| `validation` | 否 | 修改文案、格式或素材 |
| `authentication` | 否 | 重新設定 Token／帳號 |
| `permission` | 否 | 檢查 App 權限與帳號角色 |
| `rate_limit` | 是 | 顯示下次重試時間 |
| `temporary_provider` | 是 | 平台暫時異常 |
| `network` | 是 | 網路或逾時 |
| `media` | 視錯誤 | 顯示比例、格式、URL 或處理狀態 |
| `unknown` | 否 | 保存 traceId 供診斷 |

自動重試建議最多 3 次，使用指數退避；手動重試只執行指定 target。

## 14. JSON 儲存架構

### 14.1 建議檔案

```text
data/
  meta.json
  clients.json
  presets.json
  posts.json
  post-versions.json
  media.json
  templates.json
  campaigns.json
  publish-attempts.json
  activity.json
  sync-state.json
  secrets.json

uploads/
backups/
```

`schedule.json` 僅做舊資料遷移；排程唯一真相應放在 `posts[].targets[]`。

### 14.2 必要可靠性

現有 `store.js` 的 `.tmp → rename` 與 mutation queue 應保留，並新增：

- `schemaVersion`。
- 啟動時 schema migration。
- 寫入前 last-known-good 備份。
- JSON parse 失敗時從 `.bak` 復原並留下錯誤紀錄。
- migration 前建立完整 snapshot。
- 寫入後重新 parse 驗證。
- 每日自動備份。
- 手動匯出 ZIP／JSON bundle。
- 還原前自動再備份目前資料。
- 備份保留策略，例如每日 14 份、每週 8 份。
- Activity 與 Publish Attempts 按月份輪替，避免單檔無限增長。
- 舊貼文封存到 `data/archive/posts-YYYY.json`，預設內容列表只載入活動資料。

### 14.3 Repository 邊界

新增 repository 層，業務邏輯不得直接知道實體 JSON 路徑：

```text
lib/repositories/posts-repository.js
lib/repositories/media-repository.js
lib/repositories/activity-repository.js
lib/repositories/publish-attempts-repository.js
```

好處：

- 目前仍完全使用 JSON。
- 可集中處理 schema、備份、查詢與 mutation queue。
- 未來即使改儲存方式，routes、scheduler、publisher 不必重寫。

這是保留彈性，不代表規劃導入資料庫。

### 14.4 單人 JSON 的合理限制

本架構適合：

- 單 process。
- 單人操作。
- 中小量內容與素材。
- 本機或單一伺服器。

不支援多個 Node process 同時寫同一 data 目錄。啟動時應建立 process lock；第二個 server 偵測到 lock 時停止並顯示明確訊息。

## 15. 帳號與憑證安全

即使不做多使用者，憑證仍需要保護。

- 帳號 metadata 與 secrets 分離。
- API response 永遠只回遮罩 token。
- 前端不保存完整 token 到 localStorage。
- `data/secrets.json` 加入 `.gitignore`。
- 可使用 `.env` 中的 `APP_SECRET` 對 token 做 AES-GCM 加密；沒有設定時顯示安全警告。
- 匯出備份預設不含 secrets，另提供明確勾選。
- 記錄 Token 最後驗證時間與連線錯誤，不記錄 token 本身。
- 維持 same-origin，不開放不必要 CORS。

由於 server 綁定 `0.0.0.0` 供手機使用，設定頁要提醒「同一區域網路上的裝置可能可以連入」。後續可加入單一管理 PIN，但不需要建立多使用者系統。

## 16. 後續 Insights 與 Inbox

### 16.1 Insights

先支援 Meta，按 post target 保存：

- Reach。
- Impressions。
- Engagement。
- Reactions。
- Comments。
- Shares。
- Video views。
- Clicks（平台提供時）。
- `fetchedAt` 與資料來源。

Insights 以定期同步與手動刷新為主，不宣稱即時。

### 16.2 Inbox

因不用資料庫，Inbox 採 provider-backed 輕量模式：

- 優先即時向平台讀取最近訊息／留言。
- JSON 只保存 sync cursor、已讀狀態、標籤、備註與必要快取。
- 不建立永久訊息資料倉儲。
- 單人模式不需要指派與 SLA。
- 支援未處理／處理中／完成、常用回覆與搜尋。

Inbox 應在內容發布與成效穩定後再做。

## 17. API 規劃

### 17.1 Content

```text
GET    /api/posts?clientId=&status=&platform=&from=&to=&q=
POST   /api/posts
GET    /api/posts/:postId
PATCH  /api/posts/:postId
POST   /api/posts/:postId/duplicate
POST   /api/posts/:postId/archive
POST   /api/posts/:postId/restore
GET    /api/posts/:postId/versions
POST   /api/posts/:postId/versions/:versionId/restore
```

### 17.2 Targets／Publish

```text
POST   /api/posts/:postId/targets/:targetId/schedule
PATCH  /api/posts/:postId/targets/:targetId/schedule
DELETE /api/posts/:postId/targets/:targetId/schedule
POST   /api/posts/:postId/targets/:targetId/publish
POST   /api/posts/:postId/targets/:targetId/retry
GET    /api/posts/:postId/targets/:targetId/attempts
```

現有 `/api/schedule` 與 `/api/publish/target` 可先保留相容，之後逐步轉至 resource-oriented 路由。

### 17.3 Media／Templates／Campaigns

```text
GET/POST/PATCH/DELETE /api/media
GET/POST/PATCH/DELETE /api/templates
GET/POST/PATCH/DELETE /api/campaigns
```

### 17.4 System

```text
GET  /api/dashboard
GET  /api/activity
GET  /api/platforms/capabilities
POST /api/system/backup
GET  /api/system/backups
POST /api/system/restore
GET  /api/system/storage-health
```

## 18. 實作分期與版本

### v0.4.0——通用化與 JSON 基礎

目標：徹底解除神明領域耦合，同時不破壞舊資料。

- 建立 schema version 與 migration runner。
- `godName → subject`、`postType → contentGoal`。
- `gods.json → presets.json` 相容遷移。
- 重寫通用 AI prompt、context 與 schema。
- 新增 brand profile。
- 移除宮廟預設 Hashtag。
- Post 改為 `baseContent + targets`。
- 新增 platform capability registry。
- 加入 JSON 備份、復原與 storage health。
- 更新 README、PROJECT_STATUS、版號與前端 `?v=`。

### v0.5.0——Content Workspace 與完整 Composer

- 統一內容列表。
- 搜尋與篩選。
- 新增／編輯／複製／封存。
- 平台覆寫與還原母稿。
- Autosave、dirty state、stale response 防護。
- Post version history 與還原。
- 平台規格即時驗證。
- 桌面雙欄與手機編輯／預覽切換。

### v0.6.0——Calendar 與發布可靠性

- 月／週／列表 Calendar。
- Timezone 與 range query。
- Native／Local scheduleMode。
- 改期、取消、移回 ready。
- Publish Attempt。
- Idempotency 與 double-submit 防護。
- 部分成功與 target 級重試。
- 發布紀錄與錯誤分類。
- 遠端／本機排程 reconciliation。

### v0.7.0——素材、模板、Campaign 與維運

- Media Library。
- 素材 metadata、標籤、替代文字與使用狀態。
- 未使用素材清理與保留策略。
- Templates。
- Campaigns。
- 批次複製／批次排程。
- 完整備份／匯出／還原 UI。
- Activity log 與 archive rotation。

### v0.8.0——成效與帳號健康

- Meta Insights。
- Target 級成效。
- 品牌／平台／Campaign 報表。
- CSV 匯出。
- 帳號 Token 健康檢查與到期提示。
- 發布時間建議的資料基礎。

### v0.9.0——輕量 Inbox（可選）

- Facebook／Instagram 留言與訊息。
- 未處理／處理中／完成。
- 搜尋、標籤、備註、常用回覆。
- JSON sync cursor 與短期快取。

## 19. 檔案落地地圖

### 優先修改

```text
package.json
server.js
lib/store.js
lib/ai-service.js
lib/post-targets.js
lib/platforms.js
lib/routes/generate.js
lib/routes/posts.js
lib/routes/schedule.js
lib/routes/publish.js
public/index.html
public/app.js
public/style.css
public/modules/state.js
public/modules/editor.js
public/modules/drafts.js
public/modules/schedule.js
prompts/social.txt
prompts/social-schema.json
prompts/generation-context.json
```

### 建議新增

```text
lib/schema-migrations.js
lib/platform-capabilities.js
lib/platform-validation.js
lib/workflow.js
lib/post-versions.js
lib/publish-attempts.js
lib/activity.js
lib/backup.js
lib/storage-health.js
lib/repositories/
public/modules/content.js
public/modules/calendar.js
public/modules/media.js
public/modules/templates.js
public/modules/campaigns.js
public/modules/activity.js
```

## 20. 測試策略

依專案規範採 targeted testing。

### v0.4.0

- 舊 `godName` 草稿可遷移並開啟。
- 舊 `gods.json` 不遺失。
- 通用 subject 可產文。
- 無素材時 prompt 不聲稱看過素材。
- JSON 寫入中斷可從 backup 復原。
- schema migration 可重複執行且不重複遷移。
- capability 前後端一致。

### v0.5.0

- Autosave sequencing。
- stale response 不覆蓋新內容。
- 版本還原產生新版本。
- target override／reset。
- 平台預覽以 local editor state 為準。
- 上傳未完成時阻止排程／發布。

### v0.6.0

- Native 排程不被本機重發。
- Local 排程只發布一次。
- 同一 idempotency key 不重複呼叫 provider。
- 部分成功彙總正確。
- 只重試失敗 target。
- 改期失敗會 rollback。
- 取消後回到 ready。
- 時區轉換正確。

### UI 驗證

- 1440px 桌面。
- 768px 平板／窄螢幕。
- 360px 手機。
- 所有重要操作至少 44×44px。
- 平台 tabs 無水平捲軸。
- 切換 target／格式不產生明顯高度跳動。
- F5 後資料與版本號正確。

## 21. 主要風險與處理

| 風險 | 影響 | 處理 |
|---|---|---|
| 通用化只改 UI、後端仍是 `godName` | 新領域資料仍受限制 | v0.4.0 同步改 prompt、API、data model 與 migration |
| JSON 損壞 | 全部內容無法讀取 | 原子寫入、`.bak`、每日備份、startup health check |
| 單檔持續變大 | 讀寫變慢 | logs 月份輪替、舊貼文 archive、range query |
| Native／Local 雙重發布 | 重複貼文 | 明確 `scheduleMode`、`externalId`、idempotency |
| Autosave response 亂序 | 新文案被舊資料覆蓋 | `saveSequence + version` |
| 平台規則變動 | UI 與 API 驗證失準 | capability registry 集中管理 |
| Token 暴露 | 帳號安全風險 | metadata/secrets 分離、遮罩、選擇性加密 |
| 公開媒體 URL 失效 | IG／Threads 發布失敗 | preflight URL 檢查與帳號健康提示 |
| 功能過多拖慢核心 | 排程發布不穩定 | 嚴格依 v0.4 → v0.6 先完成核心閉環 |
| 未來多使用者 | 需要重寫資料 | 保留 `actor`、`version`、repository 邊界，但目前不做 UI／權限 |

## 22. 各階段完成定義

### 核心完成

一篇內容必須能：

1. 使用任意主題建立，不含神明必填或宗教預設。
2. 選擇一個品牌與多個社群帳號。
3. 使用共用母稿並逐平台覆寫。
4. 自動儲存並查看／還原版本。
5. 通過每平台發布前驗證。
6. 分別排程或立即發布。
7. 顯示每個 target 的外部 ID、時間與結果。
8. 部分失敗時只重試失敗 target。
9. Native 與 Local 排程都不重複發布。
10. 備份、匯出並可還原 JSON 資料。

### 完整產品完成

- Content、Composer、Calendar、Media、Templates、Campaigns、Logs、Accounts、Settings 都可實際使用。
- 手機可完成建立、編輯、排程與查看失敗。
- 舊資料成功遷移。
- 儲存健康狀態可見。
- Token 不出現在前端 response、log 或備份預設內容。
- Meta Insights 可回看已發布內容效果。

## 23. 下一個實際開發目標

下一步應只執行 **v0.4.0：通用化與 JSON 基礎**，順序如下：

1. 先為 `data/` 建立 migration 前 snapshot。
2. 新增 `schemaVersion` 與可重入 migration runner。
3. 建立 `subject/contentGoal/baseContent` 新模型與舊欄位 compatibility reader。
4. 將 `gods.json` 遷移為 presets。
5. 重寫 AI prompt、context、schema 與 generate API。
6. 把 UI 的神明名稱、作品介紹、聖誕祝壽與宮廟 Hashtag 全部通用化。
7. 建立品牌 profile。
8. 建立 platform capability registry。
9. 加入 JSON backup、recovery 與 storage health。
10. 執行遷移、AI、posts、targets 與設定的精準測試。
11. 同步更新 `package.json`、`/api/config`、CSS／JS `?v=`、README 與 PROJECT_STATUS。

完成 v0.4.0 後，再開始 Content Workspace 與 Composer 大改，避免 UI 先建立在舊的神明資料模型上。

## 24. 決策紀錄

| 決策 | 結果 |
|---|---|
| 內容領域 | 通用，不限定宗教、神明、宮廟或特定產業 |
| 操作模式 | 單一操作員，可管理多品牌／多平台 |
| 產品用語 | 對外統一使用「多平台」；「帳號」只用於平台連線設定、憑證與 target 的技術語境 |
| 多使用者 | 不做；只保留 `actor/version/repository` 擴充點 |
| 審核流程 | 不做；以 `ready` 自我檢查取代 |
| 儲存 | JSON + uploads，不使用資料庫 |
| 儲存可靠性 | 原子寫入、queue、backup、recovery、migration、rotation |
| 前端 | 維持 Express + 靜態 HTML/CSS/JavaScript |
| 設計系統 | 延續 ShrineFlow 色彩與元件規範，移除宗教限定語意 |
| 品牌名稱 | 暫時保留 ShrineFlow；是否改名不阻擋通用化 |
| 開發優先 | 先通用模型與可靠儲存，再做完整 Content／Calendar UI |

## 25. 研究來源

- Hootsuite Platform：<https://www.hootsuite.com/platform>
- Hootsuite Publishing：<https://www.hootsuite.com/platform/publishing>
- Hootsuite Enterprise：<https://www.hootsuite.com/plans/enterprise>
- Buffer：<https://buffer.com/>
- Meta Business Suite：<https://creators.facebook.com/tools/meta-business-suite/>
- Meta 排程說明：<https://www.facebook.com/help/389849807718635>
- Meta Inbox 說明：<https://www.facebook.com/help/messenger-app/294426838452244?locale=en_GB>
- Meta Insights 說明：<https://www.facebook.com/help/131809553587433>
