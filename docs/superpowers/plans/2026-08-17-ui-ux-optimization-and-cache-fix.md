# ShrineFlow UI/UX 優化、版號同步、手機快取穿透與 Facebook 設定完整紀錄

**紀錄日期**：2026-08-17  
**目標版本**：`v0.6.34`  
**記錄人員**：Antigravity Agent  
**語言規範**：繁體中文（全流程詳細記錄）

---

## 📌 一、任務背景與優化需求

使用者針對 ShrineFlow 提出畫面質感提升、UI/UX 流暢度優化、手機端除錯、版號自動化同步與 Facebook 連線設定等需求。我們在不改動既有資料結構的前提下，完成了全站體驗升級與深層技術排查。

---

## 🎨 二、UI/UX 優化實作內容（9 大面向）

1. **設計 Token 與基礎樣式**（`public/css/tokens.css`, `public/css/base.css`）：
   - 新增 `--transition-fast: 0.12s`（按鈕 hover 靈敏反饋）與 `--transition-smooth: 0.28s`（面板/彈窗過渡）。
   - 加入全域平滑滾動 `scroll-behavior: smooth`。

2. **按鈕點擊反饋**（`public/css/components/buttons.css`）：
   - 主要按鈕（`.primary-button`、`.btn-save`、`.btn-secondary`）加入 `:active` 按下時 `scale(0.97)` 的彈性觸控回饋。
   - 次要按鈕 hover 加入 `translateY(-1px)` 微浮感。

3. **卡片與區塊容器**（`public/css/components/cards.css`）：
   - 總覽數據卡（`.summary-card`）hover 加入 `translateY(-2px)` 與品牌邊框柔光。
   - 表單卡片（`<fieldset class="form-group-card">`）加入 `:focus-within` 柔和聚焦光暈，視覺焦點更直覺。
   - 面板進入動畫 `panelFadeIn` 增加 `scale(0.995) → 1` 深度微縮放。

4. **表單輸入聚焦體驗**（`public/css/components/forms.css`）：
   - 輸入框（Input / Textarea）聚焦時上浮 `translateY(-1px)` 與提亮背景。
   - 欄位聚焦時對應 Label 文字自動漸變為品牌紅褐色（`var(--brand)`）。

5. **側邊欄動態與標籤**（`public/css/layout.css`）：
   - 導覽圖示 hover 加入 `scale(1.15)` 微彈跳。
   - 導覽項 active 左側滑動過渡。
   - 未讀/警示標籤（`.nav-badge`）加入 `badgeAppear` 彈入動畫。
   - 空狀態與載入狀態圖示加入 `emptyPulse` 呼吸動畫。

6. **內容清單卡片**（`public/css/views/workflow.css`）：
   - 內容卡片 hover 時左側滑出品牌色指示線（`border-left-color: var(--brand)`）。
   - 狀態標籤切換時具備 `statusAppear` 縮放動畫。
   - 卡片操作按鈕 hover 時微放大 `scale(1.04)`。

7. **編輯器與預覽體驗**（`public/css/views/editor.css`）：
   - 平台頁籤（`.platform-tab`）平滑過渡。
   - 貼文預覽卡（`.copy-card`）加入 hover 陰影提升感。
   - 主題晶片（`.topic-chip`）與快捷 Hashtag 標籤加入點擊彈簧回饋（`scale(0.92)`）。

8. **Toast 即時通知動畫**（`public/css/components/feedback.css`）：
   - 彈出時加入平滑上滑 + 縮放進場動效（`scale(0.96) → 1`）與淡出機制。

9. **鍵盤快捷鍵擴充**（`public/modules/shortcuts.js`）：
   - `Escape`：Composer 開啟時按 Escape 返回內容列表。
   - `Ctrl + Shift + P`：編輯器切換「編輯 ⇄ 預覽」模式。
   - `Alt + 1 ~ 5`：快速切換側邊欄分頁（1: 總覽、2: 內容、3: 日曆、4: 素材庫、5: 設定）。

---

## 🔍 三、問題排查與解決過程（Troubleshooting）

### 1. 版號顯示舊版 `v0.6.26`（單一真相來源）
- **現象**：左上角品牌標籤顯示 `v0.6.26`，但 `package.json` 已更新至 `0.6.34`。
- **原因**：`lib/routes/config.js` 舊程式碼中有硬編碼的 fallback `'0.6.26'`，當解析工作目錄失敗時觸發 fallback。
- **解決方案**：
  1. 使用 `fileURLToPath` 與 `process.cwd()` 多重候選路徑動態定位 `package.json`。
  2. 徹底移除任何寫死的版本號碼字串，以 `package.json` 作為**唯一真相來源 (Single Source of Truth)**。

---

### 2. 前端 SyntaxError 導致畫面卡在「正在確認登入狀態…」
- **現象**：重新整理頁面後，畫面停在登入遮罩，Console 出現報錯：
  `Uncaught SyntaxError: The requested module './editor.js' does not provide an export named 'restoreRecoverySnapshotForPost' (at drafts.js:5:27)`
- **原因**：`drafts.js` 早期遺留了未使用的 `restoreRecoverySnapshotForPost` 引用，而 `editor.js` 並未 export 該函式，導致 ES Module 解析直接噴出 SyntaxError 中斷整個前端執行緒。
- **解決方案**：
  1. 移除 `public/modules/drafts.js` 中的無效引用。
  2. 強化 `public/modules/auth.js` 的 `initializeAuth()`，加入全面 `try ... catch` 與狀態超時防護，杜絕畫面無響應。
  3. 透過 Node.js 執行全模組解析測試（49 個 JS 模組），確保 100% 通過零語法錯誤。

---

### 3. 手機端深層 ES Module 磁碟快取卡死（Mobile WebKit Cache）
- **現象**：電腦端正常，但手機（iOS Safari / Android Chrome）重新整理後依然卡住，即便 Cloud Run 重新部署後仍無效，直到手動「清除瀏覽器快取」才恢復正常。
- **原因剖析**：
  1. 手機瀏覽器對原生 ES Module（`import ... from './modules/drafts.js'`）有極為嚴格的**磁碟快取 (Disk Cache)**。
  2. 舊版的 `app.js` 在引用子模組時**沒有加上版本查詢參數（`?v=...`）**。
  3. 當手機先前載入過包含 SyntaxError 的舊版 `drafts.js` 後，手機 WebKit 會將該網址的檔案寫入手機快閃記憶體。
  4. 即使伺服器部署了新版，手機再次載入 `app.js` 時，執行到 `import './modules/drafts.js'` 會直接命中本機快取，繼續讀取壞掉的舊檔案，造成卡死。
- **永久根治防護措施**：
  1. **全模組版本穿透 (Cache Busting)**：在 `public/app.js` 中，將所有子模組引用全面改為帶有版本字串（例如 `import ... from './modules/drafts.js?v=0.6.34'`），強制手機瀏覽器視為全新檔案下載。
  2. **伺服器端標頭**：在 `server.js` 中將所有 `.js` 與 `.html` 設定為 `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`。
  3. **自動化同步工具**：建立 `scripts/update-version.js`，並加入 `package.json` 指令 `npm run version:sync`。每次改版只要執行此指令，全站 HTML、CSS、JS 引用會自動同步更新版號。

---

### 4. Facebook 連線測試出現「未完整輸入 Facebook Page ID 或 Access Token」
- **現象**：在手機或電腦「⚙️ 設定」中的 Facebook 區塊點擊「🧪 測試連線」時，提示「未完整輸入 Facebook Page ID 或 Access Token」。
- **原因剖析**：
  1. 目前選擇的品牌尚未儲存 Facebook 的連線資訊，或者輸入欄位為空白。
  2. 點擊測試按鈕時，前端若偵測到當前輸入框為空且伺服器端此品牌尚未綁定 Token，會向後端送出測試請求，後端檢查發現缺少必要金鑰因而回傳 400 錯誤。
- **正確操作流程**：
  1. 前往「⚙️ 設定」→ 切換至「Facebook」分頁。
  2. 在「粉專 ID」欄位填入 Facebook 粉絲專頁的數字 ID（例如 `100088888888`）。
  3. 在「Page Access Token」欄位貼上從 Meta Graph Explorer 取得的粉專存取權杖（以 `EAA...` 開頭）。
  4. 點擊 **`💾 儲存此品牌 FB 連線`** 按鈕（系統會安全儲存並加密憑證）。
  5. 點擊 **`🧪 測試連線`**，即可成功顯示連線粉專名稱！

---

## 🧪 四、驗證與測試數據

1. **後端單元測試**：
   - 執行 `npm test`
   - 測試結果：**343 / 343 單元測試 100% 通過 (PASS)**，執行耗時約 9.9 秒。
2. **前端模組語法檢查**：
   - 49 個原生 JavaScript 模組皆通過 Node.js 模擬 DOM 匯入驗證。
3. **版本與快取控制**：
   - `public/index.html`：`style.css?v=0.6.34`、`app.js?v=0.6.34`
   - `public/style.css`：12 個 `@import` 皆帶 `?v=0.6.34`
   - `public/css/components.css`：5 個 `@import` 皆帶 `?v=0.6.34`
   - `public/app.js`：38 個子模組引用皆帶 `?v=0.6.34`
4. **Git 分支狀態**：
   - 所有修復與變更已全數 Commit 並 Push 至 GitHub `main` 分支。
