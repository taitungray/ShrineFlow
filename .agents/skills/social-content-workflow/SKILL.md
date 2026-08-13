---
name: social-content-workflow
description: Design the content lifecycle and operational workflow of a social-media publishing system. Use for drafts, autosave, approvals, scheduling, multi-platform targets, platform-specific overrides, version history, publishing queues, failures, retries, cancellation, duplication, reposting, audit events, and workflow state machines.
---

# Social Content Workflow

## Mission

確保文章不會因為狀態混亂而：

- 發錯
- 重複發
- 改了卻還使用舊審核
- 排程時間錯
- 某平台失敗卻整篇顯示成功

---

# 1. Separate Entities

建議概念上拆：

## Post
內容本體。

## Target
平台 / 帳號的一次發布目標。

## Publish Attempt
一次實際發布嘗試。

這樣才能處理：
同一篇 3 平台，2 成功、1 失敗。

---

# 2. Post State

可使用：

- DRAFT
- IN_REVIEW
- APPROVED
- SCHEDULED
- PUBLISHING
- PUBLISHED
- PARTIALLY_FAILED
- FAILED
- CANCELLED
- ARCHIVED

依產品簡化。

---

# 3. Autosave

Autosave 要定義：

- debounce
- local dirty state
- server version
- save conflict
- network failure
- retry
- last_saved_at

避免：
前一次慢 request 蓋掉新內容。

---

# 4. Versioning

重要節點建立版本：

- submit review
- approved
- scheduled
- published

如果 approved 後內容被改：
定義是否：
- approval revoked
- re-review required

預設高風險內容應重新審核。

---

# 5. Platform Override

Base content + Override。

Override 可以獨立：

- text
- media
- metadata

提供：
reset to base。

---

# 6. Schedule

資料：

- scheduled_at
- timezone
- target
- status
- created_by
- updated_by

執行端最好儲存明確時間基準，
UI 顯示使用者時區。

---

# 7. Publish Queue

發布請求需要：

- idempotency
- queued state
- started_at
- finished_at
- provider result
- retryability
- failure reason

---

# 8. Failure

Failure 分：

- validation
- authentication
- permission
- rate/temporary
- media
- network
- platform/provider
- unknown

UI 不一定暴露內部錯誤碼，
但要給操作員可行下一步。

---

# 9. Retry

Retry 必須避免重複發布。

重試前：

- target 是否其實已成功？
- remote id 是否已回傳？
- request 是否 idempotent？
- 是否需要重新驗證 token/media？

---

# 10. Cancel / Unschedule

定義：

- 哪些狀態可以 cancel
- 發布前多久可取消
- publishing 中是否可取消
- cancel 後回 Draft 還是 Cancelled

---

# Required Output

### State Machine
### Entities
### Autosave Rules
### Version Rules
### Approval Rules
### Scheduling Rules
### Publish Queue
### Failure Categories
### Retry Rules
### Audit Events
