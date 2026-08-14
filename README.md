# ShrineFlow

這是本機執行、單一操作員使用的 AI 社群內容營運工作台。資料保存於 `data/` JSON，媒體保存於 `uploads/`，不需要資料庫；可管理多品牌與多平台內容，但不預設多人權限系統。

目前版本為 **v0.5.37**：內容主題已不再侷限神明，並提供響應式 App Shell、內容列表、單頁 Composer、平台預覽、日曆、素材庫、模板、Campaign、發布紀錄、營運摘要、收件匣接入狀態、平台連線與設定頁。手機 drawer 導覽支援垂直滑動，並可點擊選單外區域、關閉按鈕或使用 Escape 收起，同時保留安全區避讓。Composer 已加入立即發布，且未儲存變更時會暫停排程與發布。多平台內容的總狀態現在可區分 `partial_success`，並在內容列表與 Composer 顯示各平台 target 結果。 Composer 具備 800ms Autosave、版本衝突提示、離開頁面提醒與受上限／期限控制的本機草稿復原。發布流程會保存 attempt 歷史，target 僅保留近期摘要，事件依月份分檔；同一請求可用 idempotency key 防止重複發布，歷史最多保留 24 個月且單月有筆數上限。Insights 已可在平台憑證與權限具備時讀取 Facebook、Instagram、Threads 的真實帳號成效，並以月份分檔保存快照；即時同步失敗時只顯示有時間戳的 cached 資料，不補推測數字，歷史最多保留 24 個月且單月有筆數上限。Composer 可針對不同平台主動 AI 改寫，並明確顯示沿用母稿／已覆寫／還原母稿；改寫建議不會自動累積，只有儲存後才寫入平台 target override。平台格式驗證在儲存、排程與發布前檢查文字長度、媒體數量、影片比例與長度；無法讀取媒體 metadata 時保留可追蹤警告，不把未驗證當成已通過。每個 target 的素材路徑最多保存 20 筆，平台規則另行阻擋超過實際上限。`uploads/` 只會自動清理未被引用且超過 7 天的孤兒素材，啟動與每日週期執行；總量限制為 1,000 個檔案／5GB，單次最多 10 個、單檔 20MB，保留人工確認清理作為例外處理。Inbox 第一階段採 provider-backed 模式，顯示 Facebook／Instagram 對話與 Threads 回覆；未讀、標籤、備註、cursor 與 webhook 同步提示只保存本機 metadata，不建立永久訊息倉儲；具備必要權限時可直接送出 provider reply，送出結果只保留平台 message ID；Meta webhook 具備 verify token／HMAC 簽章驗證，驗證後會依品牌平台擁有者 ID 清除舊 cursor，下一次讀取從最新資料重新同步，事件正文不落地。備份管理提供 JSON／成效與發布歷史備份、可選素材複製、還原前安全備份與未使用素材預覽／清理；不打包 `.env` 或 Token；備份最多保留最近 30 份，超過 180 天自動清理。平台 Token 健康檢查會保存最後驗證時間與失敗狀態，設定頁可填寫選填到期日；未提供日期時明確顯示未知。排程採本地時間搭配 IANA 時區解析後保存 UTC，會拒絕夏令時間不存在或重複的時間；排程失敗通知只保存必要 metadata，最多 200 筆，已讀項目最多保留 180 天。JSON 寫入採單檔跨程序鎖定、原子替換與唯一暫存檔，每個檔案最多保留一份 `.bak` 復原快照；品牌／內容／模板／活動與舊排程另有筆數硬上限，JSON 檔案也有 bytes 上限，達上限時停止新增並提示先封存、刪除或匯出。平台發布、Inbox 與 Insights 共用有上限的 provider 節流器；HTTP 429／5xx、scheduler 與清理錯誤只保存遮罩後 metadata，錯誤記錄最多 500 筆、保留 30 天。設定頁提供 `/api/system/health` 健康檢查，可確認 JSON 復原狀態、備份、素材配額、錯誤記錄與各主要集合使用量，不暴露實體路徑或秘密；另提供 `/api/system/readiness` 與本機部署前置手冊，確認主密鑰、HTTPS 媒體網址、production 模式、可寫入目錄與備份前提。若設定 `SHRINEFLOW_OPERATOR_PASSWORD` 與 `SHRINEFLOW_SESSION_SECRET`，會啟用最多 4 個 session、12 小時到期的單一操作員登入閘門；未設定時維持本機免登入模式。對外產品用語統一使用「多平台」；「帳號」只保留在平台連線、憑證與 target 的技術語境。

貼文生命週期已提供封存、還原與複製為草稿；封存會阻止直接編輯、排程與發布，並在內容列表提供 archived 篩選。所有生命週期事件以有上限的 JSON 紀錄保存，封存／還原也會留下版本快照，不使用資料庫。 設定頁的部署檢查也會提示 Meta webhook、單一操作員登入與 HTTPS 媒體網址是否完整。

完整狀態請參考 [PROJECT_STATUS.md](PROJECT_STATUS.md)。產品規劃：[通用社群發布 roadmap](docs/superpowers/specs/2026-08-14-general-social-publishing-roadmap.md)、[響應式 Web UI 規劃](docs/superpowers/specs/2026-08-14-responsive-web-ui-plan.md)。部署與外部審查：[本機／單一操作員部署前置手冊](docs/superpowers/specs/2026-08-14-local-deployment-runbook.md)、[Meta App Review／Business Verification 清單](docs/superpowers/specs/2026-08-14-meta-app-review-checklist.md)。

## 啟動

1. 安裝 Node.js 18 或更新版本。
2. 到 Google AI Studio 建立 Gemini API Key。
3. 複製 .env.example 為 .env，填入 GEMINI_API_KEY。
4. 在本資料夾執行 npm install。
5. 執行 `npm start`，開啟 http://localhost:3000；伺服器會綁定 `0.0.0.0`，同一區域網路的手機可使用啟動時輸出的 IP 開啟。修改前端畫面後按 F5 即可；若希望後端自動重啟，可改用 `npm run dev`。

Gemini 的提示詞與輸出格式分別放在 `prompts/social.txt` 與 `prompts/social-schema.json`；修改文案描述、欄位限制或必填欄位後，不需要重啟伺服器，下一次產文會直接讀取最新設定。

重要功能或介面改版時，請同步更新 `package.json` 的版號，並讓 `public/index.html` 的 CSS／JS `?v=` 與 `/api/config` 版號一致，避免瀏覽器使用舊快取。

Gemini 若遇到 503「模型需求過高」或 429 限流，程式會使用指數退避自動重試。也可以在 `.env` 設定 `GEMINI_FALLBACK_MODELS`，填入目前帳號可用的備援模型（以逗號分隔）。

## 串接發布平台

Facebook、Instagram、Threads 的連線可在網頁「設定」中依目前品牌分開保存與測試。Facebook 也支援從 `.env` 提供初始全域設定：

1. 在 Meta for Developers 建立應用程式，取得所需平台憑證。
2. Facebook 讓管理粉專的使用者授權 `pages_show_list`、`pages_read_engagement` 與 `pages_manage_posts`。
3. 取得 Facebook Page Access Token 與粉專 ID。
4. 在 `.env` 填入：

```env
FACEBOOK_PAGE_ID=你的粉專ID
FACEBOOK_PAGE_ACCESS_TOKEN=你的PageAccessToken
META_GRAPH_VERSION=v25.0
```

5. 重新啟動程式或到「設定」測試連線；Facebook 排程會交給平台原生佇列，Instagram／Threads 排程則由本機服務到期發布。

Token 只會保留在伺服器端，不會回傳到瀏覽器；設定 SHRINEFLOW_MASTER_KEY 後，下一次寫入會以 AES-256-GCM 加密環境設定與品牌平台 Token，輪替必須先驗證舊密鑰。正式提供多人使用前，應改用 Meta OAuth、完成所需的 App Review／Business Verification，並將 Token 加密存放。

## 使用流程

1. 建立或切換目前品牌，輸入內容主題或對象，例如商品、服務、活動、公告、知識或品牌故事。
2. 選填圖片／影片素材（最多 10 個、單檔 20MB），可拖曳或用上下按鈕調整順序。
3. 按「AI 產生文案」，在同一個 Composer 編輯母稿、選擇發布平台並查看平台預覽。
4. 儲存草稿、建立排程或立即發布；內容會寫入 `data/posts.json`，排程會寫入 `data/schedule.json`。
5. 到內容、日曆、素材庫、模板、活動與發布紀錄查看後續狀態；失敗 target 可單獨重試。

內容採「共用母稿＋平台目標」結構，平台文案、格式、媒體與時間可以分開調整。平台憑證只會留在後端設定，不會送到前端。

Facebook 自動發布支援「多張圖片」或「單一影片」；Instagram／Threads 依各平台格式與媒體公開網址設定發布。圖片與影片混合、或一次多段影片若不符合平台能力，會在發布前阻擋。

排程器在本機 Node.js 程式內執行，因此預定發布時間到達時，電腦與本程式都必須保持開啟且可連上網路。
版本歷程不使用資料庫：貼文內容會按月份寫入 `data/post-versions/`，最多保留每篇 20 個 active 版本與 24 個月的月檔；備份與還原也會包含這些紀錄。Composer 支援 Autosave、版本衝突保護、版本列表與安全還原，手機版會自動換行版本操作列。
