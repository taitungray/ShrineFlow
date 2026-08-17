# ShrineFlow UI/UX 優化、版號同步與快取修復紀錄

**紀錄日期**：2026-08-17  
**目標版本**：`v0.6.34`  
**記錄人員**：Antigravity Agent  

---

## 📌 一、任務背景與優化需求

使用者針對 ShrineFlow 提出畫面顯示與操作流暢度優化需求。經全面盤點專案的前端結構（CSS Tokens、Layout、Components、業務 Views、JS 模組），在不改動後端邏輯與資料庫前提下，完成了 9 大面向的 UI/UX 微動效與體驗升級。

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

### 問題 1：版號顯示舊版 `v0.6.26`
- **現象**：左上角品牌標籤顯示 `v0.6.26`，但 `package.json` 已更新至 `0.6.34`。
- **原因**：`lib/routes/config.js` 舊程式碼中有硬編碼的 fallback `'0.6.26'`，當解析工作目錄失敗時觸發 fallback。
- **解決方案**：
  1. 使用 `fileURLToPath` 與 `process.cwd()` 多重候選路徑精準定位 `package.json`。
  2. 徹底移除任何寫死的版本號碼字串，以 `package.json` 作為**唯一真相來源 (Single Source of Truth)**。

---

### 問題 2：頁面卡在「正在確認登入狀態…」
- **現象**：重新整理頁面後，畫面停在登入遮罩，Console 出現報錯：
  `Uncaught SyntaxError: The requested module './editor.js' does not provide an export named 'restoreRecoverySnapshotForPost' (at drafts.js:5:27)`
- **原因**：`drafts.js` 早期遺留了未使用的 `restoreRecoverySnapshotForPost` 引用，而 `editor.js` 並未 export 該函式，導致 ES Module 解析直接噴出 SyntaxError 中斷整個前端執行緒。
- **解決方案**：
  1. 移除 `public/modules/drafts.js` 中的無效引用。
  2. 強化 `public/modules/auth.js` 的 `initializeAuth()`，加入全面 `try ... catch` 與狀態超時防護，杜絕畫面無響應。
  3. 透過 Node.js 執行全模組解析測試（49 個 JS 模組），確保 100% 通過零語法錯誤。

---

### 問題 3：手機端瀏覽器快取卡住
- **現象**：手機打開頁面依舊卡在舊版快取。
- **原因**：
  1. `public/index.html` 底部的 `<script src="/app.js?v=0.6.33">` 未同步更新到 `0.6.34`。
  2. `server.js` 在 production 模式下對 `.js` 檔案設置了 `max-age=86400`（1 天），手機端不會主動向伺服器驗證最新版。
- **解決方案**：
  1. 更新 `index.html` 中的 script 標籤為 `?v=0.6.34`（Cache Busting）。
  2. 修改 `server.js` 的 `staticOptions`，將所有 JavaScript 檔案（`.js`）與 HTML 改為 `Cache-Control: no-cache, must-revalidate`，強制瀏覽器發送 ETag 驗證，確保程式碼修改後手機立即生效。

---

## 🧪 四、驗證結果

1. **後端單元測試**：執行 `npm test`，全套 **343/343 項測試 100% 通過 (PASS)**。
2. **前端模組驗證**：全部 49 個 JS 模組透過 DOM Mock 匯入測試，無任何語法錯誤。
3. **版本控制**：所有修復均已提交 Commit 並推送至 GitHub `main` 分支。
