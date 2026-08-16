# 隱藏、真取消、日曆列對齊內容卡片 — 設計規格

日期：2026-08-17  
狀態：已實作  
決策：隱藏用 `hiddenAt`（方案 B）；日曆「發布行程」版面跟內容列表卡片相同。

---

## 1. 要解決什麼

1. Facebook Token 過期時，日曆遠端對帳失敗、取消打 Graph 也失敗；操作員需要清楚下一步，且本機列表仍可用。
2. Token 有效後，「取消」必須真的刪 Facebook 遠端排程；Business Suite 已刪、Graph 回 does not exist 時，本機仍要清掉排程。
3. 本機幽靈／重複列要能**隱藏**：不取消、不封存、不打 Meta。
4. 日曆兩筆同標題同時間分不出來。發布行程改用內容列表那套卡片（縮圖、建立時間、排程時間、文案摘要、平台、狀態）。

成功標準：

- 隱藏後內容「目前」與日曆預設看不到；篩選「已隱藏」可取消隱藏。
- 隱藏不改 `targets.status` / `scheduledAt` / `externalId`；scheduler 仍會發（若 Facebook 還有排程）。
- `DELETE /api/schedule/:targetId`：遠端已不存在視為成功並清本機；Token 過期（code 190）仍失敗。
- 日曆列與內容列同樣資訊層級；目前月／週範圍最多 40 筆（不再只切 8 筆）。

---

## 2. 非目標

- 永久刪除貼文。
- 隱藏時自動取消 Facebook。
- 代產生新 Page Token。
- 改月曆格子短標題（仍短標；點格子捲到下方完整卡片）。

---

## 3. 資料與 API

### 隱藏

貼文欄位：`hiddenAt`（ISO string 或 `null`）。不是新的 `status`。

- `POST /api/posts/:postId/hide` — 已隱藏則 idempotent
- `POST /api/posts/:postId/unhide`
- 權限：`content.edit`；audit：`post.hidden` / `post.unhidden`
- 生命週期事件：`hidden` / `unhidden`
- 不 bump 內容 version（不碰審核）
- 複製：`hiddenAt` 清空
- `GET /api/posts` 仍回傳隱藏筆（前端篩）
- `GET /api/schedule` **略過** `hiddenAt` 有值的貼文

### 真取消

`cancelFacebookTarget`：`deleteScheduled` 丟「物件不存在」（Graph code 100 + subcode 33，或原文 does not exist / unsupported delete）→ 當成功。code 190 不過期當成功。

---

## 4. UI

### 內容列表

- 狀態 pill 加「已隱藏」。
- 「目前」與其他狀態排除 `hiddenAt`。
- 未隱藏：封存、**隱藏**、複製。已隱藏：取消隱藏、複製。

### 日曆發布行程

每列用 `.content-card` 與內容列表相同結構：

- 縮圖
- 標題
- `建立／更新時間 · 排程：…`
- 文案前約 92 字
- 平台 chip
- `Facebook 粉專：已排程`
- 右側狀態徽章
- 已排程動作：改時間、取消、隱藏
- 點卡片主體：開啟該則內容（同內容列表）

Token 過期：遠端對帳區塊留提示＋「更新粉專 Token」連 `#/settings/facebook`。頂欄 FB 狀態照舊。不在進日曆時自動連噴 toast；取消／改時間失敗才 toast。

---

## 5. 測試

- `isFacebookScheduledPostGone`：100/33 true，190 false
- `cancelFacebookTarget` 遠端已沒有仍回 draft
- `DELETE /schedule/:id` 遠端 gone 後本機 scheduledAt/externalId 清空
- hide 後 GET schedule 不含該則；unhide 後回來；target 排程欄位不變
- duplicate 不帶 `hiddenAt`
