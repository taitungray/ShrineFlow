# ShrineFlow

這是本機執行、單一操作員使用的 AI 社群內容營運工作台。資料保存於 `data/` JSON，媒體保存於 `uploads/`，不需要資料庫；可管理多品牌與多平台內容，但不預設多人權限系統。

目前版本為 **v0.5.16**：內容主題已不再侷限神明，並提供響應式 App Shell、內容列表、單頁 Composer、平台預覽、日曆、素材庫、模板、Campaign、發布紀錄、營運摘要、收件匣接入狀態、平台連線與設定頁。手機 drawer 導覽支援垂直滑動，並可點擊選單外區域、關閉按鈕或使用 Escape 收起，同時保留安全區避讓。Composer 已加入立即發布，且未儲存變更時會暫停排程與發布。發布流程會保存完整 attempt 歷史，target 僅保留近期摘要，完整事件依月份分檔；同一請求可用 idempotency key 防止重複發布。Insights 已可在平台憑證與權限具備時讀取 Facebook、Instagram、Threads 的真實帳號成效，並以月份分檔保存完整同步快照；即時同步失敗時只顯示有時間戳的 cached 資料，不補推測數字。Inbox 第一階段採 provider-backed 模式，顯示 Facebook／Instagram 對話與 Threads 回覆；未讀、標籤、備註與 cursor 只保存本機 metadata，不建立永久訊息倉儲；具備必要權限時可直接送出 provider reply，送出結果只保留平台 message ID；Meta webhook 具備 verify token／HMAC 簽章驗證，事件只回 ACK 不落地。備份管理提供 JSON／成效與發布歷史備份、可選素材複製、還原前安全備份與未使用素材預覽／清理；不打包 `.env` 或 Token；備份最多保留最近 30 份，超過 180 天自動清理，完整歷史紀錄仍按月份保存。平台 Token 健康檢查會保存最後驗證時間與失敗狀態，設定頁可填寫選填到期日；未提供日期時明確顯示未知。對外產品用語統一使用「多平台」；「帳號」只保留在平台連線、憑證與 target 的技術語境。

完整狀態請參考 [PROJECT_STATUS.md](PROJECT_STATUS.md)。產品規劃：[通用社群發布 roadmap](docs/superpowers/specs/2026-08-14-general-social-publishing-roadmap.md)、[響應式 Web UI 規劃](docs/superpowers/specs/2026-08-14-responsive-web-ui-plan.md)。

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

Token 只會保留在伺服器端，不會回傳到瀏覽器。正式提供多人使用前，應改用 Meta OAuth、完成所需的 App Review／Business Verification，並將 Token 加密存放。

## 使用流程

1. 建立或切換目前品牌，輸入內容主題或對象，例如商品、服務、活動、公告、知識或品牌故事。
2. 選填圖片／影片素材（最多 10 個、單檔 20MB），可拖曳或用上下按鈕調整順序。
3. 按「AI 產生文案」，在同一個 Composer 編輯母稿、選擇發布平台並查看平台預覽。
4. 儲存草稿、建立排程或立即發布；內容會寫入 `data/posts.json`，排程會寫入 `data/schedule.json`。
5. 到內容、日曆、素材庫、模板、活動與發布紀錄查看後續狀態；失敗 target 可單獨重試。

內容採「共用母稿＋平台目標」結構，平台文案、格式、媒體與時間可以分開調整。平台憑證只會留在後端設定，不會送到前端。

Facebook 自動發布支援「多張圖片」或「單一影片」；Instagram／Threads 依各平台格式與媒體公開網址設定發布。圖片與影片混合、或一次多段影片若不符合平台能力，會在發布前阻擋。

排程器在本機 Node.js 程式內執行，因此預定發布時間到達時，電腦與本程式都必須保持開啟且可連上網路。
