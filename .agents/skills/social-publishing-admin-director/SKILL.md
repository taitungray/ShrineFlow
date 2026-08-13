---
name: social-publishing-admin-director
description: Orchestrate the design and development of a social-media content publishing admin system. Use for post management, multi-platform publishing, scheduling, approvals, media libraries, content calendars, drafts, publishing status, retry workflows, permissions, audit logs, templates, campaigns, and MVP planning.
---

# Social Publishing Admin Director

## Mission

把社群內容工作整理成：

**能寫、能審、能排、能發、能追蹤。**

最重要的不是做很多管理頁，
而是讓一篇文章從想法到成功發布的流程非常順。

---

# 1. Define Operators

常見角色：

- Writer
- Editor
- Reviewer
- Publisher
- Admin

不要預設所有人都有全部權限。

---

# 2. Define Post Lifecycle

預設模型：

```text
DRAFT
→ IN_REVIEW
→ APPROVED
→ SCHEDULED
→ PUBLISHING
→ PUBLISHED
```

失敗分支：

```text
PUBLISHING
→ FAILED
→ RETRYING
→ PUBLISHED / FAILED
```

其他：

- CANCELLED
- ARCHIVED

產品實際不需要的狀態可移除。

---

# 3. Content Model

一篇 Post 至少區分：

## Shared Content
跨平台共用：
- title/internal name
- base caption/body
- media
- campaign
- tags

## Platform Target
每個平台：
- selected account
- enabled
- content override
- media override
- publish status
- publish result
- remote id/url（若 API 提供）

不要把「一篇內容」和「一次平台發布」混成同一筆狀態。

---

# 4. Core Modules

依實際需求選：

- Dashboard
- Content
- Composer
- Calendar
- Review Queue
- Media Library
- Templates
- Campaigns
- Social Accounts
- Publishing Logs
- Audit Logs
- Settings

Composer 優先級通常高於 Dashboard。

---

# 5. Composer Flow

理想流程：

1. 建立草稿
2. 撰寫共用內容
3. 加入媒體
4. 選平台 / 帳號
5. 覆寫平台內容（需要時）
6. Preview
7. Save / Review / Publish / Schedule

避免使用者在第一步就被迫設定所有平台差異。

---

# 6. Scheduling

一定定義：

- scheduled_at
- timezone
- status
- who scheduled
- editable until?
- conflict behavior
- cancellation behavior

畫面必須顯示時區。

---

# 7. Publishing Reliability

發布不是單純按鈕。

需要：

- queued/publishing state
- per-platform result
- failure reason
- retry
- idempotency strategy
- duplicate protection
- audit trail

---

# 8. Approval

如果需要審核：

定義：

- who can submit
- who can approve
- can author approve own post?
- edit after approval?
- schedule before approval?
- what happens after edit?

任何會讓已核准內容改變的操作都要重新定義 approval 行為。

---

# 9. Permissions

至少可拆：

- view
- create
- edit
- submit review
- approve
- schedule
- publish
- retry
- delete/archive
- manage accounts
- manage permissions

---

# 10. MVP

第一版通常優先：

- Content list
- Composer
- Media upload
- Platform selection
- Draft
- Schedule
- Publish
- Per-platform status
- Failed + Retry
- Basic permission

Calendar / Campaign / Templates 可依需求延後。

---

# Required Output

### Operators
### Post Lifecycle
### Data Model
### Modules
### Composer Flow
### Scheduling Rules
### Publishing Rules
### Approval Rules
### Permission Matrix
### MVP
### Risks
### Next Build Target
