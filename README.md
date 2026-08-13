# 神像 AI 社群小編

這是本機工具，資料放在 data JSON，圖片放在 uploads/。

**v0.3.0 起支援多客戶代操**：頂欄切換客戶；一則貼文可掛多個平台帳號目標（文案／時間可不同）；真正發布仍只有 Facebook。

完整狀態請參考 [PROJECT_STATUS.md](PROJECT_STATUS.md)。設計規格：`docs/superpowers/specs/2026-08-13-multi-client-publishing-design.md`。

## 啟動

1. 安裝 Node.js 18 或更新版本。
2. 到 Google AI Studio 建立 Gemini API Key。
3. 複製 .env.example 為 .env，填入 GEMINI_API_KEY。
4. 在本資料夾執行 npm install。
5. 執行 `npm start`，開啟 http://localhost:3000。修改前端畫面後按 F5 即可；只有修改後端程式（例如 `server.js`）才需要重新啟動伺服器。若希望後端自動重啟，可改用 `npm run dev`。

Gemini 的提示詞與輸出格式分別放在 `prompts/social.txt` 與 `prompts/social-schema.json`；修改文案描述、欄位限制或必填欄位後，不需要重啟伺服器，下一次產文會直接讀取最新設定。

每次修改 `public/app.js` 或 `public/style.css`，請同步遞增 `public/index.html` 上對應資源網址的 `?v=` 版號，例如 `20260813-5`，避免瀏覽器使用舊快取。

Gemini 若遇到 503「模型需求過高」或 429 限流，程式會使用指數退避自動重試。也可以在 `.env` 設定 `GEMINI_FALLBACK_MODELS`，填入目前帳號可用的備援模型（以逗號分隔）。

## 串接 Facebook 粉專

1. 在 Meta for Developers 建立應用程式，加入 Facebook Login for Business。
2. 讓管理粉專的帳號授權 `pages_show_list`、`pages_read_engagement` 與 `pages_manage_posts`。
3. 取得該粉專的 Page Access Token 與粉專 ID。
4. 在 `.env` 填入：

```env
FACEBOOK_PAGE_ID=你的粉專ID
FACEBOOK_PAGE_ACCESS_TOKEN=你的PageAccessToken
META_GRAPH_VERSION=v25.0
```

5. 重新啟動程式。右上角出現「Facebook 已連線」後，排程到期便會自動發布。

Token 只會保留在伺服器端，不會回傳到瀏覽器。正式提供多人使用前，應改用 Meta OAuth、完成所需的 App Review／Business Verification，並將 Token 加密存放。

## 使用流程

1. 上傳神像圖片或影片素材（單檔最大 20MB）、選擇神明與貼文類型（作品介紹／聖誕祝壽）；左側媒體卡片可拖曳排序，也可用上下箭頭調整。
2. 按「AI 產生文案」，在右側檢查與修改。
3. 按「儲存草稿」，內容會寫入 data/posts.json。
4. 按「排程發布」，時間會寫入 data/schedule.json。

發布平台已預留 Facebook、Instagram、Threads 與 LINE VOOM 欄位；目前只有 Facebook 已串接，其他平台會在介面中標示為即將支援。
編輯預覽頁也已提供四個平台的版型切換；目前僅切換預覽樣式與說明，不會對未串接平台送出發布請求。未來各平台會透過獨立 publisher adapter 接入，沿用同一份草稿與排程資料。
平台與帳號分開管理：排程會同時記錄 `channel` 與 `accountId`，因此未來可讓同一平台連接多個粉專／帳號，也可讓同一篇草稿排到不同平台帳號。帳號憑證只會留在後端設定，不會送到前端。
圖片與影片為選填；不提供素材時，Gemini 會只根據神明名稱與補充說明產生文案。
發布設定採階層式結構：平台 → 帳號 → 發布格式 → 格式設定。例如 Facebook 已預留「貼文／Reel／限時動態」與各自設定；目前只有 Facebook 貼文可實際發布，其餘格式先顯示規劃介面，避免尚未完成 API 時誤發。
5. 程式每 30 秒檢查到期排程；成功後記錄 Facebook 貼文 ID，暫時性錯誤最多自動重試 3 次。

Facebook 自動發布支援「多張圖片」或「單一影片」。圖片與影片混合、或一次多段影片可以在工具內預覽與保存，但目前不會允許加入 Facebook 排程。

排程器在本機 Node.js 程式內執行，因此預定發布時間到達時，電腦與本程式都必須保持開啟且可連上網路。
