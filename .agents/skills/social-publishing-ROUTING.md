# Skill Routing

> 實體只在 `.agents/skills/`。Cursor / Codex / Gemini 共用；勿複製到 user 目錄。
> 與 `ui-ux-pro-max` 衝突時，以本專案 `ui-ux-pro-max` 為準。

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
