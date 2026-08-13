---
name: social-publishing-frontend-engineer
description: Implement, debug and optimize social-media publishing admin frontends using React, Vue, JavaScript or TypeScript. Use for post editors, autosave, media uploads, platform previews, scheduling, content calendars, workflow state, API integration, publishing status, retry UI, account selectors, permissions, responsive behavior and frontend performance.
---

# Social Publishing Frontend Engineer

## Mission

把內容發布流程做成穩定的前端，
尤其避免：

- autosave 覆蓋新資料
- 重複 publish
- platform state 混亂
- media upload 未完成就 schedule
- stale preview
- filter/calendar state 丟失

---

# 1. Editor State

建議分：

- server snapshot
- local draft
- dirty fields
- platform overrides
- media state
- validation
- save status

不要每按一個字就全頁 API update。

---

# 2. Autosave

處理：

- debounce
- latest-write-wins strategy
- request sequencing
- stale response
- abort/cancel
- error retry
- last saved indicator

---

# 3. Media Upload

狀態：

- queued
- uploading
- processing
- ready
- failed

Publish / Schedule 前驗證 media ready。

---

# 4. Preview

Preview 來源必須是：

**目前 local editor state**

不能只依 server saved version，
否則畫面會落後。

---

# 5. Platform Overrides

資料模型避免複製整份 Post。

例如：

baseContent
targets[]
target.overrideText
target.overrideMedia

---

# 6. Scheduling

UI payload 明確帶：

- local date/time
- timezone
- resolved instant（依後端 contract）

DST / timezone 規則由後端與產品共同定義。

---

# 7. Publish Action

防止：

- double click
- repeated request
- stale content
- invalid target
- unfinished upload

提交後：
立即顯示 publishing state。

---

# 8. Real-time Status

如果系統支援：

- polling
- SSE
- WebSocket

依需求選。

不要為了炫技一定使用 WebSocket。

---

# 9. Calendar

考慮：

- range query
- timezone
- cache
- filter state
- drag reschedule
- optimistic update rollback

---

# 10. Permissions

前端：

- menu
- route
- action
- disabled/read-only
- clear explanation

後端仍是最終授權來源。

---

# Debug Workflow

1. Reproduce
2. Identify editor/workflow/network/render layer
3. Root cause
4. Minimal fix
5. Verify
6. Retry / race test
7. Regression

---

# Final Gate

- autosave 不蓋新內容
- preview 跟 local state 一致
- upload 未完成不可誤發
- publish 防 double-submit
- target account 明確
- timezone 明確
- partial failure 可呈現
- retry 不造成 duplicate
- filter/calendar state 不亂
