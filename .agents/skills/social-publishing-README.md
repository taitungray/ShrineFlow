# Social Publishing Admin Skills

專門用於「社群文章發布管理後台」的 AI Skill Pack。

> **ShrineFlow 安裝方式**：Skills 已放在 repo 的 `.agents/skills/`（單一副本）。
> 入口：`AGENTS.md`（Codex）、`.cursorrules`（Cursor）、`GEMINI.md`（Gemini）皆指向此路徑。
> **不要**再跑 `install-codex-user.ps1` 複製到 `~/.codex/skills`，避免三端各一份。

適合：

- Facebook / Instagram / Threads / X / LinkedIn 等多平台內容管理
- 草稿管理
- 文章編輯
- 圖片 / 影片素材
- 多平台預覽
- 排程發布
- 審核流程
- 發布狀態
- 失敗重試
- 內容日曆
- 標籤 / 活動 / 系列管理
- 範本
- 版本紀錄
- 權限與操作紀錄

> 平台限制、字數、API 規則等容易變動的資訊，不硬編碼在 Skill 內。
> 實作時應由平台 adapter / configuration 提供。

---

# Skills

## 1. social-publishing-admin-director
總控。

負責：
- 功能模組
- 文章生命週期
- 多平台發布流程
- 排程
- 審核
- 權限
- 失敗重試
- MVP
- 模組之間的協調

## 2. social-publishing-ui-designer-pro
這套最重要的 UI/UX Skill。

負責：
- Post Composer
- Media Manager
- Platform Preview
- Content Calendar
- Draft List
- Scheduling
- Approval
- Publishing Status
- Filter / Search
- Bulk Actions
- Responsive
- Design System
- Screenshot Review

## 3. social-content-workflow
專門管理內容流程。

負責：
- Draft
- In Review
- Approved
- Scheduled
- Publishing
- Published
- Failed
- Cancelled
- Versioning
- Autosave
- Retry
- Platform overrides
- Duplicate / Repost
- Approval rules

## 4. social-publishing-frontend-engineer
前端實作。

負責：
- React / Vue / TS / JS
- Editor state
- Autosave
- Media upload
- Preview
- Calendar
- Scheduling
- API
- Optimistic / pessimistic update
- Retry UI
- Permission UI
- RWD
- Performance

## 5. social-publishing-qa
專門測社群發布後台。

負責：
- 草稿
- 自動儲存
- 排程
- 時區
- 多平台選擇
- 失敗發布
- 重試
- 權限
- 版本
- 媒體
- Calendar
- Bulk action
- Regression

---

# 核心工作流

```text
建立文章
   ↓
撰寫內容
   ↓
加入圖片 / 影片
   ↓
選擇平台
   ↓
依平台調整內容
   ↓
預覽
   ↓
草稿 / 送審
   ↓
核准
   ↓
立即發布 / 排程
   ↓
Publishing
   ↓
Published / Failed
   ↓
Retry / Duplicate / Edit New Version
```

---

# 建議畫面

## Dashboard
- 今日排程
- 待審核
- 發布失敗
- 即將發布
- 最近文章

## Content
- 全部文章
- 草稿
- 待審
- 已排程
- 已發布
- 失敗

## Composer
- 文章內容
- 媒體
- 平台選擇
- 平台差異
- Preview
- Schedule
- Approval

## Calendar
- Month / Week / List
- Drag reschedule（若產品允許）
- Platform filter
- Campaign filter
- Status filter

## Media
- 圖片
- 影片
- 搜尋
- Tags
- Usage
- Upload status

## Templates
- 常用文案
- Hashtag group
- CTA
- Campaign templates

## Accounts
- 社群帳號
- Channel / Page
- Connection status
- Permission

## Audit
- 誰建立
- 誰修改
- 誰核准
- 誰發布
- 發布結果

---

# 設計原則

1. Composer 是核心，不是 Dashboard。
2. 一篇文章可以有「共用內容」與「平台覆寫內容」。
3. 發布狀態必須非常清楚。
4. 排程一定要顯示時區。
5. Autosave 不能讓使用者猜有沒有存。
6. Failed 必須能看到原因與 Retry。
7. 不要讓多平台差異塞滿整個主畫面。
8. Preview 要能快速切換平台。
9. 不用 Modal 承載超長文章編輯。
10. 高風險操作要可追蹤。
