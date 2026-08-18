# Skill Routing

> 實體只在 `.agents/skills/`。Cursor / Codex / Gemini 共用；勿複製到 user 目錄。
> 與 `ui-ux-pro-max` 衝突時，以本專案 `ui-ux-pro-max` 為準。

## ShrineFlow 落地約束（必讀）

1. **UI 視覺／表單結構** → 永遠跟 `ui-ux-pro-max` + `AGENTS.md`  
   - 色票、字體、`.field`、`form-group-card`、`radio-pill-group`、觸控 44px、`flex-wrap` 禁止水平捲軸、面板 min-height 等，一律以既有規範為準。
   - **平台辨識**：掃台用官方 FB／IG／Threads ICON；說明、設定內文、錯誤句子用字。見 `.cursor/rules/platform-brand-icons.mdc`。  
   - 本 pack「不要做成制式 SaaS 卡片牆」指 Dashboard 亂卡堆疊；**不禁止**表單用 `form-group-card` 分組。

2. **前端實作** → 沿用現有 **Express + 靜態 HTML/CSS/JS** 架構  
   - `social-publishing-frontend-engineer` 取用其流程／狀態／autosave／upload／防重複發布等原則。  
   - **除非使用者明確要求**，否則不因 skill 提到 React/Vue/TS 就建議或執行前端重寫。

3. **產品範圍** → 審核佇列、完整 Calendar、權限矩陣、多 Target 部分失敗、Versioning 等進階模組  
   - **僅在產品／使用者明確要做時才啟用**。  
   - 改現有發布／排程頁時，以現況模組為界，勿硬塞完整 admin MVP。

| 需求 | Skill |
|---|---|
| 完整社群後台規劃 | social-publishing-admin-director |
| Composer / Calendar / UI / UX | social-publishing-ui-designer-pro |
| 草稿、審核、排程、狀態流程 | social-content-workflow |
| React/Vue/API/Autosave/Upload | social-publishing-frontend-engineer |
| 發布、排程、權限、Regression 測試 | social-publishing-qa |

## 常見情境

### 做文章發布頁
`social-publishing-ui-designer-pro`
→ `social-content-workflow`
→ `social-publishing-frontend-engineer`

### 做內容日曆
`social-publishing-ui-designer-pro`
→ `social-publishing-frontend-engineer`
→ `social-publishing-qa`

### 發布失敗重試
`social-content-workflow`
→ `social-publishing-frontend-engineer`
→ `social-publishing-qa`

### 完整 MVP
讓 `social-publishing-admin-director` 協調全部。
