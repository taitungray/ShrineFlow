# ShrineFlow 開發與 UI/UX 設計準則 (Agent Guidelines)

> [!TIP]
> 本專案已啟用 **`ui-ux-pro-max`** 設計系統與規範 (.agents/skills/ui-ux-pro-max/SKILL.md)。

## 🔗 多機／多 Agent 共用 Skills（單一真相來源）

> **Cursor / Codex / Gemini 一律讀同一份檔案，禁止複製成三份。**

| Agent | 入口檔（僅指標，不複製內容） | Skills 實體路徑 |
|---|---|---|
| Cursor | `.cursorrules` → 本檔 | `.agents/skills/**` |
| Codex | `AGENTS.md`（本檔） | `.agents/skills/**` |
| Gemini | `GEMINI.md` → 本檔 | `.agents/skills/**` |

- 所有 Skill 只放在 **`.agents/skills/<skill-name>/SKILL.md`**
- 路由表：`.agents/skills/social-publishing-ROUTING.md`
- 總覽：`.agents/skills/social-publishing-README.md`
- **禁止**再複製到 `~/.codex/skills`、`~/.cursor/skills`、`.cursor/skills`、Gemini 個人目錄等第二／第三份

### Social Publishing Admin Skills

| 需求 | Skill |
|---|---|
| 完整社群後台規劃 | `social-publishing-admin-director` |
| Composer / Calendar / UI / UX | `social-publishing-ui-designer-pro` |
| 草稿、審核、排程、狀態流程 | `social-content-workflow` |
| React/Vue/API/Autosave/Upload | `social-publishing-frontend-engineer` |
| 發布、排程、權限、Regression | `social-publishing-qa` |

路徑皆為：`.agents/skills/<上表名稱>/SKILL.md`。與既有 `ui-ux-pro-max` 並存；做社群發布後台時先讀 ROUTING，再依情境載入對應 Skill。若與 `ui-ux-pro-max` 衝突，**以 `ui-ux-pro-max`（本專案設計系統）為準**。

## 🏷️ 版本號與快取管理準則 (Versioning Rules)

1. **版號同步 (Version Bumping)**
   - 每次進行重要功能開發、介面大改版或修復時，**必須同步更新 `package.json` 中的 `version` 號碼**（如 `v0.2.0`）。
   - 前端畫面上（品牌 Header `v0.2.0` 標籤）必須透過 API (`/api/config`) 自動讀取並即時渲染版號，禁止人工手動寫死。
   - 前端引用的 CSS / JS 靜態資源帶上的 `?v=...` 查詢參數須維持為最新版號，確保瀏覽器 F5 時不會抓到舊快取。

## 📱 手機與行動裝置執行準則 (Mobile Support)

1. **網路綁定與區域網存取 (Local Network Binding)**
   - 伺服器須綁定 `0.0.0.0` 介面，並在啟動時自動輸出本機區域網路 IP (`http://192.168.x.x:3000`)，確保同網域的手機可以直接瀏覽連線。

2. **行動端響應式 UI (Mobile Responsive & Touch Usability)**
   - **觸控親和性**：按鈕、頁籤與輸入框必須符合手機觸控最小尺寸限制 (≥ 44×44px 觸控區域)。
   - **單欄動態排版**：手機螢幕 (小於 768px) 下自動轉為單欄佈局，導覽分頁支援水平換行不溢出與不產生無謂捲軸。
   - **防止縮放錯亂**：確保 `<meta name="viewport" content="width=device-width, initial-scale=1" />` 正確設定。

## 🎨 UI/UX 設計與版面排版準則 (ui-ux-pro-max)

1. **邏輯分組與卡片容器 (Group Concept & Fieldsets)**
   - **相關欄位群組化**：嚴禁將所有輸入欄位一口氣由上到下長串平舖。相近功能的欄位必須透過分組卡片/分頁框 (`.form-group-card` / `<fieldset>`) 進行視覺隔離與主題標記（例如：【📸 素材與文案設定】、【🚀 社群發布與格式】）。
   - **區塊快速定位**：欄位分組必須搭配明確的小區塊標題（Group Title），讓使用者一眼定位所需設定，毋須從頭搜尋到尾。

2. **標準表單結構與防重疊 (Form Structure & Anti-Overlap Rules)**
   - **獨立 Div 容器**：表單欄位必須採用 `<div class="field">` 作為外層容器，搭配獨立 `<label for="xxx" class="field-label">` 與輸入框 (`<input>`, `<select>`, `<textarea>`)。**嚴禁以 `<label>` 直接包裹整組 `<div>` 與輸入框**，避免瀏覽器將原生 `label` 視為 inline 元素導致文字與輸入框重疊。
   - **少項選項禁用下拉選單 (Segmented Radio Pills > Dropdowns)**：選項只有 2~4 個時（如貼文類型：作品介紹 / 聖誕祝壽），**嚴禁使用下拉選單 `<select>`**。必須一律採用按鈕切換卡/分段按鈕組 (`.radio-pill-group`) 直接平舖顯示在畫面上，點擊一次即可切換，減少二次點擊與選單覆蓋。
   - **雙欄對齊與間距**：`.field-row` 雙欄佈局中，兩側必須為同等高度與結構的 `.field` 區塊，禁止在欄位側邊直接放置無 label 的浮動說明文字，避免欄位對齊錯位與文字撞字。
   - **預覽區塊縱向對齊**：預覽區域 (`.review-preview`) 中的平台頁籤 (`.platform-tabs`)、描述文字 (`.platform-status`) 與媒體預覽框 (`.preview-image-wrap`) 必須使用 `display: flex; flex-direction: column; gap: 12px;` 確保垂直順序排列，嚴禁使用 `position: absolute` 或負 margin 導致元素重疊。
   - **全展開頁籤無滾動條 (No Horizontal Scrollbars)**：所有分頁導覽與平台切換按鈕 (`.platform-tabs`) 必須完全平舖展示 (`flex-wrap: wrap`)，**禁止設定 `overflow-x: auto`**，避免出現擠壓與水平滑動條。
   - **高度防跳動與鎖定 (Height Stability & Anti-Jitter)**：頁面面板 (`.panel`)、工作區 (`.workspace-grid`) 與動態設定區 (`.content-settings`) 必須設定合理的 `min-height`（面板 `540px`，動態設定 `42px`），切換選項與分頁時**嚴禁畫面忽大忽小、底部按鈕上跳下彈**。

3. **視覺層級 (Visual Hierarchy)**
   - **文字輕重分明**：透過字體大小 (font-size)、字重 (font-weight: 700/800 vs 400)、顏色對比度（主標/主要標籤高對比 `#1e1917`，次要說明中對比 `#5c504a`，輔助說明/Placeholder 低對比 `#8c7b73`）引導視覺。
   - **醒目欄示標記**：必填欄位使用醒目的紅星 (`*` / `#d32f2f`)，選填欄位使用優雅的灰色標記 `(選填)`，一眼就能區分欄位優先度。
   - **簡潔不雜亂**：說明應以 Placeholder 暗示、提示文字或 Tooltip 呈現，維持版面極簡透氣。

4. **操作方便性與佈局 (Usability & Layout)**
   - **避免過度折疊與嵌套**：不要盲目將所有東西縮起來或做成選單/折疊選單 (`<details>`)。常用的重要操作（如媒體上傳、神明名稱、發布平台與格式）必須直接展開在畫面上，減少點擊層級與步驟。
   - **直覺預覽與動作**：編輯區與預覽區並排呈現，按鈕具備明確的主次階層（Primary CTA: 漸變主色按鈕、Secondary: 邊框按鈕、Dark: 暗色按鈕）。

## 📦 版本控制準則 (Git Workflow)

1. **嚴格手動指令 Commit (Commit Only on Explicit Request)**
   - **禁止自動 Commit**：任何大小修改均不可自行自動 commit。
   - **Commit 時機**：**完全僅在使用者明確發出 `commit` 指令時才執行 Commit。**

## 🧪 測試執行準則 (Testing Guidelines)

1. **精準測試 (Targeted Testing)**
   - **修改純前端 (HTML / CSS / 靜態畫面)**：不執行後端單元測試，避免無謂干擾與等待。
   - **修改特定後端模組**：僅針對該模組的測試檔執行精準測試（如修改 `lib/settings.js` 僅跑 `node --test test/settings.test.js`）。
   - **全套測試**：僅在重構核心架構、跨模組大改動，或使用者明確指示時才執行 `node --test` 全套測試。

## ⚙️ 系統與架構運作準則

1. **免重啟開發 (Watch & Dynamic Reload)**
   - 啟動腳本 (`start.bat`) 使用 `node --watch` 運行，程式碼修改後後端自動重載。
   - 前端靜態檔案由 Express 搭配 `Cache-Control: no-store` 提供，修改 HTML/CSS/JS 後瀏覽器 F5 重新整理即生效，避免快取混淆。

2. **動態金鑰與設定管理 (Web-based Settings)**
   - API Key（Gemini API Key、Facebook Page ID / Token）需可在網頁「⚙️ 設定」介面直接讀取、修改與即時連線測試。
   - 儲存後寫入 `.env` 並在記憶體中動態重載，完全不需要重新啟動服務。
