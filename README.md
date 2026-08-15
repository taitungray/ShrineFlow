# ShrineFlow

這是本機執行、單一操作員使用的 AI 社群內容營運工作台。資料保存於 `data/` JSON，媒體保存於 `uploads/`，不需要資料庫；可管理多品牌與多平台內容，但不預設多人權限系統。

給第一次接觸專案的讀者，請先看 [ShrineFlow 專案導覽](docs/PROJECT_GUIDE.md)；裡面以白話整理目前每一個功能、使用流程、平台限制與尚未支援的能力。

目前版本為 **v0.5.67**。完整功能、使用流程與限制請看 [ShrineFlow 專案導覽](docs/PROJECT_GUIDE.md)；工程狀態與後續規劃請看 [PROJECT_STATUS.md](PROJECT_STATUS.md)。

貼文生命週期已提供封存、還原與複製為草稿；封存會阻止直接編輯、排程與發布，並在內容列表提供 archived 篩選。所有生命週期事件以有上限的 JSON 紀錄保存，封存／還原也會留下版本快照，不使用資料庫。 設定頁的部署檢查也會提示 Meta webhook、單一操作員登入與 HTTPS 媒體網址是否完整。 系統健康檢查在 JSON 或素材配額達 80% 時也會提示先整理、封存或清理。

完整狀態請參考 [PROJECT_STATUS.md](PROJECT_STATUS.md)。產品規劃：[通用社群發布 roadmap](docs/superpowers/specs/2026-08-14-general-social-publishing-roadmap.md)、[響應式 Web UI 規劃](docs/superpowers/specs/2026-08-14-responsive-web-ui-plan.md)、[競品第二輪功能缺口分析](docs/superpowers/specs/2026-08-15-competitor-feature-gap-analysis.md)。部署：[本機／單一操作員部署前置手冊](docs/superpowers/specs/2026-08-14-local-deployment-runbook.md)、[雲端部署 Runbook](docs/superpowers/specs/2026-08-14-cloud-deployment-runbook.md)、[Meta App Review／Business Verification 清單](docs/superpowers/specs/2026-08-14-meta-app-review-checklist.md)。

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
