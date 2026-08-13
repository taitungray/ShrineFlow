---
name: social-publishing-qa
description: Test social-media publishing admin systems. Use for draft/autosave behavior, multi-platform targets, content overrides, media uploads, scheduling, timezone behavior, approvals, publish-now, publishing failures, retries, partial success, permissions, content calendars, filters, version history, audit behavior and regression testing.
---

# Social Publishing QA

## Mission

最重要的是避免：

- 發錯平台
- 發錯帳號
- 發錯時間
- 發舊版本
- 重複發布
- 使用者以為成功但其實失敗

---

# Test Areas

## Draft
- create
- edit
- autosave
- refresh
- network fail
- recover

## Platform
- one
- multiple
- remove target
- disabled account
- override
- reset override

## Media
- upload
- fail
- reorder
- replace
- remove
- publish before ready

## Review
- submit
- reject/request changes
- approve
- edit after approval
- permission

## Schedule
- future
- near future
- invalid past
- timezone
- edit
- cancel
- reschedule

## Publish
- now
- double click
- partial success
- total failure
- retry
- repeated retry
- stale content

## Status
- queued
- publishing
- published
- failed
- partial

## Calendar
- month
- week
- filters
- timezone
- reschedule

## Permission
- writer
- reviewer
- publisher
- admin
- direct URL
- action API rejection

---

# Test Case

### TC-xxx

Given:
When:
Then:
Priority:
Result:

---

# Mandatory High-risk Cases

1. 三平台發布，其中一個失敗。
2. Publish 按鈕快速連點。
3. Autosave 舊 response 晚於新 response 回來。
4. Approved 後再次修改內容。
5. 排程後修改時區。
6. Media 還在 processing 就按 Publish。
7. Retry 時 provider 其實已經成功。
8. 兩個人同時修改同一草稿。
9. 權限被移除但頁面仍開著。
10. Session 過期時正準備發布。

---

# Ship Gate

- PASS
- PASS WITH ISSUES
- FAIL

FAIL 條件例：

- 可能 duplicate publish
- platform/account 不明確
- timezone 不明確
- partial failure 顯示為成功
- autosave 可能覆蓋新內容
