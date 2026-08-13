---
name: social-publishing-ui-designer-pro
description: Design, review and improve the UI/UX of a social-media publishing admin system. Use for post composers, multi-platform previews, content calendars, draft lists, media libraries, scheduling, approval queues, publishing status, filters, search, bulk actions, templates, account selectors, responsive layouts, design systems, and screenshot reviews.
---

# Social Publishing UI Designer Pro

## Mission

讓內容人員可以：

**快速寫 → 快速看 → 安心排程 → 清楚知道有沒有發成功。**

核心畫面不是 KPI Dashboard，
而是 Composer + Content List + Calendar。

---

# 1. Visual Direction

後台要乾淨，但不做成制式 SaaS 卡片牆。

優先：

- 內容本身是視覺主角
- 狀態清楚
- 平台辨識清楚
- 編輯區穩定
- 工具不搶內容

---

# 2. Primary Navigation

建議：

- Content
- Calendar
- Media
- Review
- Templates
- Accounts
- Settings

若模組少：
不要硬塞更多。

---

# 3. Content List

必要欄位依需求選：

- Thumbnail
- Internal title / first text
- Platforms
- Status
- Scheduled time
- Owner
- Last updated
- Actions

常用 Filter：

- Status
- Platform
- Account
- Author
- Campaign
- Date

Search：

- content keyword
- internal title
- post id

---

# 4. Composer Layout

推薦 Desktop：

```text
┌─────────────────────────────────────────────────────────────┐
│ Back   Draft name     Save status       Review/Schedule/Publish │
├───────────────────────────────┬─────────────────────────────┤
│                               │ Platform / Account          │
│  CONTENT EDITOR               │ Preview                     │
│                               │                             │
│  Text                         │ [FB] [IG] [Threads] ...     │
│                               │                             │
│  Media                        │ Platform-specific preview   │
│                               │                             │
│  Tags / Campaign              │ Warnings / validation       │
│                               │                             │
├───────────────────────────────┴─────────────────────────────┤
│ Autosaved • Last saved 11:20 • Timezone Asia/Taipei        │
└─────────────────────────────────────────────────────────────┘
```

## Principle

左邊：內容建立  
右邊：平台結果

不要讓使用者在 6 個 Tab 裡來回迷路。

---

# 5. Shared vs Platform Override

預設顯示 Shared Content。

當平台需要差異時：

- 顯示 Override indicator
- 可 reset to shared
- 清楚知道哪些平台已被修改
- 不要複製整份表單造成資訊爆炸

---

# 6. Autosave

畫面必須有：

- Saving…
- Saved
- Failed to save
- Retry

不能只偷偷 autosave。

如果尚未同步：
使用者離開頁面要有清楚處理。

---

# 7. Scheduling UX

Schedule UI 必須同時顯示：

- Date
- Time
- Timezone
- Target platforms/accounts
- Approval status

提交前提供 Summary：

「將於 XX 時間發布到 A、B、C」。

---

# 8. Publish Now

Publish Now 屬高風險操作。

Confirm 至少顯示：

- platforms
- accounts
- content state
- media
- publish immediately

不要只顯示「確定發布嗎？」

---

# 9. Platform Preview

Preview 重點：

- 快速切換平台
- 顯示實際 content override
- 顯示 media order
- 顯示截斷/驗證警告
- 不宣稱與平台 App 100% pixel-perfect，除非實際可以做到

---

# 10. Calendar

支援情境：

- Month
- Week
- List

每個 item 至少顯示：

- time
- content preview
- platform
- status

Filter：
- platform
- account
- campaign
- owner
- status

Drag reschedule 如果存在：
一定要有確認 / 明確 feedback。

---

# 11. Publishing Status

狀態視覺要一致：

- Draft
- Review
- Approved
- Scheduled
- Publishing
- Published
- Failed
- Cancelled

Failed 必須比一般 status 更容易被看到。

對多平台 Post：
顯示 overall + per-platform status。

---

# 12. Media Manager

需要：

- upload progress
- upload failure
- preview
- remove
- reorder
- replace
- usage information
- alt/accessibility text（產品需要時）

不要只顯示檔名。

---

# 13. Approval Queue

Review 畫面優先：

- content
- platform targets
- scheduled time
- author
- changes
- Approve
- Request changes

Reviewer 不應該需要跳很多頁才能知道要審什麼。

---

# 14. Mobile / Narrow Screen

若要支援手機：

Composer 不要硬保留左右雙欄。

改：

- Editor
- Preview toggle
- Sticky primary action
- Media horizontal strip
- Sheet/Drawer for scheduling

---

# 15. Screenshot Review Mode

使用：

### First Impression

### Top Problems
每個：

**[P0/P1/P2/P3]**
- 位置
- 問題
- 內容人員受到的影響
- 修改
- 驗收

### Keep

### Revised Workflow

### Acceptance Criteria

優先級：

- P0：可能發錯內容 / 發錯帳號 / 發錯時間
- P1：嚴重影響編輯效率
- P2：資訊層級 / 一致性
- P3：視覺 polish

---

# Final Gate

- 正在編輯哪篇很清楚？
- 是否已保存很清楚？
- 要發去哪裡很清楚？
- 何時發布很清楚？
- 時區清楚？
- 哪些平台有 override 很清楚？
- Publish / Schedule 不容易誤按？
- 發布成功/失敗清楚？
- 失敗後知道怎麼處理？
