# ShrineFlow 開發與 UI/UX 設計準則 (Agent Guidelines)

## 📱 手機與行動裝置執行準則 (Mobile Support)

1. **網路綁定與區域網存取 (Local Network Binding)**
   - 伺服器須綁定 `0.0.0.0` 介面，並在啟動時自動輸出本機區域網路 IP (`http://192.168.x.x:3000`)，確保同網域的手機可以直接瀏覽連線。

2. **行動端響應式 UI (Mobile Responsive & Touch Usability)**
   - **觸控親和性**：按鈕、頁籤與輸入框必須符合手機觸控最小尺寸限制 (≥ 44×44px 觸控區域)。
   - **單欄動態排版**：手機螢幕 (小於 768px) 下自動轉為單欄佈局，導覽分頁支援水平換行不溢出與不產生無謂捲軸。
   - **防止縮放錯亂**：確保 `<meta name="viewport" content="width=device-width, initial-scale=1" />` 正確設定。

## 🎨 UI/UX 設計與版面排版準則

1. **標準表單結構與防重疊 (Form Structure & Anti-Overlap Rules)**
   - **獨立 Div 容器**：表單欄位必須採用 `<div class="field">` 作為外層容器，搭配獨立 `<label for="xxx" class="field-label">` 與輸入框 (`<input>`, `<select>`, `<textarea>`)。**嚴禁以 `<label>` 直接包裹整組 `<div>` 與輸入框**，避免瀏覽器將原生 `label` 視為 inline 元素導致文字與輸入框重疊。
   - **雙欄對齊與間距**：`.field-row` 雙欄佈局中，兩側必須為同等高度與結構的 `.field` 區塊，禁止在欄位側邊直接放置無 label 的浮動說明文字，避免欄位對齊錯位與文字撞字。
   - **預覽區塊縱向對齊**：預覽區域 (`.review-preview`) 中的平台頁籤 (`.platform-tabs`)、描述文字 (`.platform-status`) 與媒體預覽框 (`.preview-image-wrap`) 必須使用 `display: flex; flex-direction: column; gap: 12px;` 確保垂直順序排列，嚴禁使用 `position: absolute` 或負 margin 導致元素重疊。
   - **全展開頁籤無滾動條 (No Horizontal Scrollbars)**：所有分頁導覽與平台切換按鈕 (`.platform-tabs`) 必須完全平舖展示 (`flex-wrap: wrap`)，**禁止設定 `overflow-x: auto`**，避免出現擠壓與水平滑動條。

2. **視覺層級 (Visual Hierarchy)**
   - **文字輕重分明**：透過字體大小 (font-size)、字重 (font-weight: 700/800 vs 400)、顏色對比度（主標/主要標籤高對比 `#1e1917`，次要說明中對比 `#5c504a`，輔助說明/Placeholder 低對比 `#8c7b73`）引導視覺。
   - **醒目欄示標記**：必填欄位使用醒目的紅星 (`*` / `#d32f2f`)，選填欄位使用優雅的灰色標記 `(選填)`，一眼就能區分欄位優先度。
   - **簡潔不雜亂**：說明應以 Placeholder 暗示、提示文字或 Tooltip 呈現，維持版面極簡透氣。

3. **操作方便性與佈局 (Usability & Layout)**
   - **避免過度折疊與嵌套**：不要盲目將所有東西縮起來或做成選單/折疊選單 (`<details>`)。常用的重要操作（如媒體上傳、神明名稱、發布平台與格式）必須直接展開在畫面上，減少點擊層級與步驟。
   - **直覺預覽與動作**：編輯區與預覽區並排呈現，按鈕具備明確的主次階層（Primary CTA: 漸變主色按鈕、Secondary: 邊框按鈕、Dark: 暗色按鈕）。

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
