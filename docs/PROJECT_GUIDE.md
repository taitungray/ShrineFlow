# ShrineFlow 專案導覽

> 給第一次接觸 ShrineFlow 的產品、營運、設計與工程夥伴。這份文件用簡單的方式說明目前已完成的功能與限制。

更新日期：2026-08-15　目前版本：`v0.5.67`

## 一句話介紹

ShrineFlow 是一個「AI 產生內容＋多平台編輯＋排程發布＋成效追蹤」的社群內容工作台。

使用者可以先建立一份共用母稿，再針對 Facebook、Instagram、Threads 個別調整文案、格式、素材與發布時間。

## 目前可以做什麼

| 功能 | 白話說明 | 目前狀態 |
| --- | --- | --- |
| 品牌管理 | 切換不同品牌，分開保存各品牌的平台連線與內容。 | 可用 |
| AI 產文 | 輸入主題、方向、備註與素材，請 Gemini 產生社群文案。 | 可用 |
| 多平台 Composer | 一次編輯母稿，再分別調整各平台版本。 | 可用 |
| 平台預覽 | 直接查看 Facebook、Instagram、Threads 的文字與版型預覽。 | 可用 |
| 素材上傳與素材庫 | 上傳圖片／影片、預覽、排序，並查看素材使用在哪些內容。 | 可用 |
| 草稿與內容列表 | 搜尋、篩選、編輯、複製、封存與還原內容。 | 可用 |
| Idea 靈感 | 先快速保存想法，不必一開始就填完整文案。 | 可用 |
| 審核流程 | 可選擇啟用送審、核准、要求修改。 | 可用；企業級審核不在本輪 |
| 日曆與排程 | 用月／週／列表查看排程，支援改期、取消與失敗重試。 | 可用 |
| Queue | 為平台帳號設定固定時段，內容自動放入下一個可用時段。 | 可用 |
| 立即發布 | 從 Composer 直接發布指定平台 target。 | 可用 |
| 發布重試 | 暫時性錯誤會保留 attempt，並依規則重試。 | 可用 |
| CSV 批次匯入 | 先 dry-run 逐列檢查，再一次建立草稿；任一列失敗就整批不寫入。 | 可用 |
| CSV 批次排程 | CSV 草稿確認後，可一次套用為本機排程。 | 可用；不代表遠端 Meta 排程 |
| 影片驗證 | 影片必須通過格式、數量、類型、長度與尺寸檢查。 | 可用 |
| Evergreen | 從已發布內容建立固定間隔的下一篇本機排程，可設定上限與暫停。 | v1 可用 |
| Insights | 讀取有權限的平台成效，顯示資料來源與同步時間。 | 可用；沒有真實資料就顯示無資料 |
| 最佳時段 | 用已發布樣本計算建議時段。 | 可用；樣本不足時不猜測 |
| 已發布再製 | 從真實成效較好的已發布內容建立獨立草稿副本。 | 可用 |
| Inbox | 查看平台對話／回覆、標籤、未讀與待回狀態，必要時直接回覆。 | 可用；部分資料是 provider 即時接入 |
| 模板與 Campaign | 保存常用內容模板，並把貼文關聯到活動查看進度。 | 可用 |
| 危機暫停 | 暫停指定品牌、平台或帳號的本機排程，並記錄取消結果。 | 可用 |
| Autosave 與版本 | 自動保存、版本衝突保護、版本歷史與安全還原。 | 可用 |
| 備份與健康檢查 | 備份資料、檢查儲存／素材／錯誤狀態，必要時還原。 | 可用 |

## 最常見的使用流程

1. 在「設定」建立或切換品牌，測試 Facebook、Instagram 或 Threads 連線。
2. 到「新增內容」輸入主題，選擇圖片／影片與發布平台。
3. 按「AI 產生文案」，在 Composer 裡調整母稿與平台版本。
4. 儲存草稿；如果品牌啟用審核，先送審並取得核准。
5. 選擇立即發布、手動排程，或加入 Queue。
6. 到「日曆」、「發布紀錄」、「Insights」與「Inbox」追蹤後續狀態。

## 各功能怎麼理解

### 1. 品牌與平台連線

每個品牌都有自己的平台連線、帳號、token 健康狀態與 capability。畫面會把「已連線」、「未設定」、「需要權限」與「尚未支援」分開顯示。

Token 只在伺服器端使用，不會送到瀏覽器。設定 `SHRINEFLOW_MASTER_KEY` 後，後續寫入的敏感設定可使用 AES-256-GCM 加密保存。

### 2. AI 產文與 Composer

AI 產文需要：

- 內容主題或對象。
- 內容方向與補充說明。
- 可選的圖片／影片。
- 預設 hashtag。

產生後會得到一份共用母稿。每個平台 target 可以獨立調整文案、格式、素材、帳號與時間；「平台 AI 改寫」只提供一次建議，儲存後才會真正寫入平台覆寫內容。

### 3. 草稿、Idea 與內容生命週期

- `Idea`：只保存靈感，不會出現在排程，也不能直接發布。
- `Draft`：可以編輯、送審、排程與發布。
- `In review`／`Approved`／`Changes requested`：審核流程的狀態。
- `Archived`：封存內容，不能直接編輯、排程或發布。
- `Published`／`Failed`／`Partial success`：依各平台 target 的實際結果顯示。

Idea 可以一鍵轉成 Draft。複製與已發布再製都會建立獨立草稿，不會修改原始內容。

### 4. 素材與影片

支援圖片與影片上傳，單次最多 10 個檔案，單檔上限 20MB。素材可以拖曳或用按鈕調整順序。

平台發布前會檢查：

- 素材數量是否符合格式。
- 圖片與影片是否混用。
- Reel／Story 是否只有一支影片。
- 影片類型、長度與尺寸是否符合平台規則。
- Instagram／Threads 的媒體是否有公開網址可供平台讀取。

無法驗證影片 metadata 時，批次 CSV 匯入會直接拒絕該列，不把「未驗證」當成「已通過」。

### 5. 排程、日曆與 Queue

排程時間以使用者輸入的本地時間與 IANA 時區解析，系統內保存 UTC。不存在或重複的夏令時間會被拒絕。

- Facebook：排程交給 Facebook 原生佇列，伺服器關機仍可能照平台排程發布。
- Instagram／Threads：由 ShrineFlow 本機 scheduler 到期發布，因此服務與網路必須保持運作。
- Queue：依品牌＋平台帳號設定固定時段，內容放入後占用下一個可用 slot。
- 拖曳改期：會重新套用時區、格式與平台排程規則。

### 6. CSV 批次匯入

CSV 建議欄位：

```text
contentTopic,facebook,platform,contentType,mediaPaths,mediaIds,scheduledLocal,timeZone
```

使用方式：

1. 貼上 CSV。
2. 按「驗證 CSV」執行 dry-run。
3. 修正標示錯誤的列。
4. 全部通過後按「建立草稿」。
5. 如有排程欄位，再按「套用匯入排程（本機）」。

批次匯入有三個安全保證：

- dry-run 不會寫入資料。
- 任一列驗證失敗，整批不建立草稿。
- 批次套用排程時發生錯誤或版本衝突，整批不部分更新。

素材可用 `mediaPaths` 指向既有 `/uploads/...` 檔案，也可用 `mediaIds` 綁定目前品牌的 ready 素材資產。CSV 不會建立 Meta Planner 遠端排程。

### 7. Evergreen

Evergreen 只能從已發布內容開始。設定間隔天數與最多再發布次數後，系統會建立下一篇獨立內容並放入本機排程。

- 可暫停、恢復或停用。
- 有固定次數上限，避免無限複製。
- 每次生成都留下 lifecycle event 與版本紀錄。
- 不會繞過啟用中的品牌審核。
- 停用時已經建立的本機排程仍需另外處理。

### 8. Insights、最佳時段與再製

Insights 只顯示平台 API 回傳或有時間戳的 cached 資料。沒有真實資料時會顯示 `insufficient_data` 或不可用，不會自行估算數字。

最佳時段至少需要 10 筆已發布樣本。再製候選只從已保存真實 Insights 的已發布 target 產生，建立後是新的草稿，不會覆寫原貼文。

### 9. Inbox

Inbox 可接入 Facebook、Instagram 對話與 Threads 回覆，並支援：

- 未讀／待回篩選。
- 標籤與內部備註。
- Saved replies 快速回覆。
- Provider 回覆與發送結果。
- Webhook 驗證與同步提示。

訊息正文主要由平台即時提供；本機只保存必要的 metadata、cursor、標籤與備註，不建立永久訊息全文倉儲。

### 10. 危機暫停與失敗處理

危機暫停可以套用在目前品牌、指定平台或指定帳號。它會阻止本機 scheduler claim 新 target，並逐筆記錄 Facebook 原生排程的取消成功／失敗。

發布失敗會保存必要的錯誤 metadata、attempt 與重試狀態。多平台內容不會把部分成功藏起來，而是顯示 `partial_success`，讓使用者只處理失敗的 target。

## 平台能力與限制

| 平台 | 可發布內容 | 排程方式 | 重要限制 |
| --- | --- | --- | --- |
| Facebook | 貼文、Reel、Story | 貼文／Reel 可交原生排程；Story 只能立即發布 | 貼文支援多圖或單影片，不支援圖影混合 |
| Instagram | Feed、Reel、Story | 本機到點發布 | 有媒體需 `PUBLIC_MEDIA_BASE_URL`；需符合 Instagram 帳號與權限條件 |
| Threads | 文字貼文，可附單圖／單影片 | 本機到點發布 | 有媒體需公開網址；影片處理可能較久 |

目前不宣稱已支援：

- Meta Planner 遠端排程完整讀寫同步。
- Facebook Story 原生排程。
- 廣告投放、Boost、社群聆聽、競品監控、變現功能。
- 外部工具建立的所有排程完整匯入、暫停與取消。
- Reel 封面與其他尚未完成 API／權限驗證的能力。

遠端排程無法可靠取得時，系統會顯示 `remote_schedule_unavailable`，不會把「本機沒有排程」說成「遠端也沒有排程」。

## 資料與部署概念

預設不使用資料庫：

- `data/`：品牌、草稿、排程、模板、Campaign、通知、錯誤與歷史資料。
- `uploads/`：本機媒體檔案。
- `prompts/`：Gemini system prompt、schema 與產文上下文。
- `.env`：API key、平台設定與部署環境變數。

JSON 寫入具備檔案鎖、原子替換與 `.bak` 復原快照。系統會限制內容筆數、檔案大小、素材數量與備份保留量，接近上限時在健康檢查中提示。

## 快速啟動

需要 Node.js 18 或更新版本：

```powershell
npm install
Copy-Item .env.example .env
# 在 .env 填入 GEMINI_API_KEY
npm start
```

瀏覽器開啟 `http://localhost:3000`。伺服器會綁定 `0.0.0.0`，啟動時也會輸出區域網路網址，方便手機測試。

開發模式：

```powershell
npm run dev
```

測試：

```powershell
npm test
```

## 相關文件

- [專案狀態與後續規劃](../PROJECT_STATUS.md)：工程狀態、資料結構與待辦。
- [競品功能缺口分析](superpowers/specs/2026-08-15-competitor-feature-gap-analysis.md)：為什麼做這些功能，以及哪些能力刻意不做。
- [本機部署前置手冊](superpowers/specs/2026-08-14-local-deployment-runbook.md)：部署、備份、HTTPS 與 readiness 檢查。
- [Meta App Review／Business Verification 清單](superpowers/specs/2026-08-14-meta-app-review-checklist.md)：正式對外使用前的外部審查工作。
