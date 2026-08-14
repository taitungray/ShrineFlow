# ShrineFlow 多使用者與品牌權限規劃

> 日期：2026-08-14  
> 狀態：已規劃，尚未實作  
> 適用架構：Express + 靜態 HTML/CSS/JavaScript + Firebase Authentication + Cloud Run + Firestore  
> 核心原則：`clientId` 是品牌資料邊界；前端只負責呈現，後端負責最終授權

## 1. 目標

將現有「單一操作員共用密碼」升級為：

- 每位操作員有自己的登入帳號與可追蹤身分。
- 使用者可加入一個或多個品牌。
- 同一使用者在不同品牌可以有不同角色。
- 所有資料讀寫、排程與發布都由後端驗證品牌權限。
- 高風險操作保留完整 actor 與 audit trail。
- 現有單一操作員可以無資料遺失地轉成第一位 Owner。

本階段不做完整 SaaS 組織、計費、企業 SSO 或任意自訂權限。ShrineFlow 仍是一個部署實例，`client` 代表其中的一個品牌／客戶資料範圍。

## 2. 現況與缺口

目前系統已具備：

- 單一操作員密碼登入。
- 記憶體 Session 與 HttpOnly Cookie。
- `clientId` 品牌資料欄位。
- Post 樂觀鎖版本 `baseVersion`。
- Post Version、Publish Attempt 與 Firestore `auditEvents` repository 預留。
- Scheduler／Webhook 獨立於一般操作員登入。

多人化前必須修正的缺口：

1. 登入後只有 `operatorAuthenticated`，沒有 UID、Email、角色或品牌 Membership。
2. 多數 API 接受前端傳入的 `clientId`，尚未驗證使用者是否屬於該品牌。
3. 部分 API 先讀取整個集合，再用 `clientId` 篩選；不得把這種篩選當成授權。
4. Firestore repository 的 `mutate` 會讀寫整個集合，不適合多使用者並行。
5. Post Version 的 actor 目前固定為 `operator`，無法追蹤真實操作者。
6. 目前沒有邀請、停權、Membership、角色管理與完整 Audit UI。

## 3. 建議架構

```text
使用者
  -> Firebase Google Sign-in
  -> 取得 Firebase ID Token
  -> POST /api/auth/session（含 CSRF token）
  -> Express 驗證 ID Token 並建立 HttpOnly Session Cookie
  -> 後續 API 驗證 Session Cookie
  -> 載入 User + Client Membership
  -> 檢查 Permission
  -> 執行 client-scoped service
  -> 寫入 Audit Event

Cloud Scheduler / Meta Webhook
  -> 使用獨立 machine identity
  -> 執行既有排程／Webhook 流程
  -> actorId = system:scheduler / system:webhook
```

### 3.1 驗證與授權分離

- Authentication：確認「你是誰」，由 Firebase Authentication 與 Session Cookie 負責。
- Authorization：確認「你可對哪個品牌做什麼」，由 ShrineFlow 後端 Membership 與 Permission 負責。
- UI 可以隱藏或停用按鈕，但不能作為安全邊界。

### 3.2 Session 原則

- 正式環境使用 Firebase Server-side Session Cookie。
- Cookie 設為 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`。
- 建議 Session 有效期 12 小時。
- 建立 Session 的 endpoint 必須驗證 CSRF token。
- 停權或高風險帳號異動時撤銷 Firebase Refresh Token。
- 正式環境完成切換後停用 `SHRINEFLOW_OPERATOR_PASSWORD` 後門。
- 本機開發使用 Firebase Auth Emulator；舊登入模式只作短期遷移。

### 3.3 Firebase Custom Claims 使用限制

Custom Claims 只存少量全域控制，例如：

- `systemAdmin: true`
- `authVersion`

不要把品牌 Membership 或完整 permission list 放入 Claims，避免大小限制、Token 更新延遲與角色撤銷不同步。品牌權限的唯一真相放在 Firestore Membership。

## 4. Operators 與角色

### 4.1 角色定義

- `owner`：部署實例與品牌最高管理者。
- `admin`：管理品牌、人員、平台帳號與操作流程。
- `editor`：建立、編輯、管理內容與素材，不能直接發布。
- `reviewer`：審核、核准、退回內容，不直接編輯或發布。
- `publisher`：可編輯、排程、發布、取消與重試，不能管理成員或 Token。
- `viewer`：唯讀查看內容、發布結果、Inbox 與 Insights。

同一個 User 可在不同 `clientId` 擁有不同角色。

### 4.2 Permission Matrix

| Permission | Owner | Admin | Editor | Reviewer | Publisher | Viewer |
|---|---:|---:|---:|---:|---:|---:|
| `content.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `content.create` | ✓ | ✓ | ✓ |  | ✓ |  |
| `content.edit` | ✓ | ✓ | ✓ |  | ✓ |  |
| `content.submit_review` | ✓ | ✓ | ✓ |  | ✓ |  |
| `content.approve` | ✓ | ✓ |  | ✓ |  |  |
| `content.archive` | ✓ | ✓ | ✓ |  | ✓ |  |
| `schedule.manage` | ✓ | ✓ |  |  | ✓ |  |
| `publish.execute` | ✓ | ✓ |  |  | ✓ |  |
| `publish.retry` | ✓ | ✓ |  |  | ✓ |  |
| `media.manage` | ✓ | ✓ | ✓ |  | ✓ |  |
| `template.manage` | ✓ | ✓ | ✓ |  | ✓ |  |
| `campaign.manage` | ✓ | ✓ | ✓ |  | ✓ |  |
| `account.manage` | ✓ | ✓ |  |  |  |  |
| `member.manage` | ✓ | ✓* |  |  |  |  |
| `audit.view` | ✓ | ✓ |  |  |  |  |
| `system.manage` | ✓ |  |  |  |  |  |

`Admin` 不得移除 Owner、將自己升級為 Owner、指派新 Owner，或修改 Owner 的權限。

MVP 若尚未啟用審核流程，可以先隱藏 `reviewer`，但保留角色與 Permission 定義，避免之後重做資料模型。

## 5. Data Model

### 5.1 `users`

```json
{
  "uid": "firebase-uid",
  "email": "user@example.com",
  "emailNormalized": "user@example.com",
  "displayName": "王小明",
  "photoUrl": "",
  "authProvider": "google.com",
  "status": "active",
  "lastLoginAt": "2026-08-14T00:00:00.000Z",
  "createdAt": "2026-08-14T00:00:00.000Z",
  "updatedAt": "2026-08-14T00:00:00.000Z"
}
```

`status`：

- `active`
- `suspended`

### 5.2 `memberships`

```json
{
  "id": "clientId__firebaseUid",
  "clientId": "client-id",
  "userId": "firebase-uid",
  "role": "editor",
  "status": "active",
  "invitedBy": "owner-uid",
  "createdAt": "2026-08-14T00:00:00.000Z",
  "updatedAt": "2026-08-14T00:00:00.000Z"
}
```

`status`：

- `active`
- `revoked`

建議索引：

- `userId + status`
- `clientId + status`
- `clientId + role + status`

### 5.3 `invitations`

```json
{
  "id": "invitation-id",
  "emailNormalized": "new-user@example.com",
  "grants": [
    { "clientId": "client-a", "role": "editor" },
    { "clientId": "client-b", "role": "viewer" }
  ],
  "status": "pending",
  "tokenHash": "sha256-hash-only",
  "expiresAt": "2026-08-21T00:00:00.000Z",
  "invitedBy": "owner-uid",
  "acceptedBy": null,
  "acceptedAt": null,
  "createdAt": "2026-08-14T00:00:00.000Z"
}
```

`status`：

- `pending`
- `accepted`
- `expired`
- `revoked`

只保存邀請 Token 的 Hash，不保存原始 Token。

### 5.4 `auditEvents`

```json
{
  "id": "event-id",
  "clientId": "client-id",
  "actorId": "firebase-uid",
  "actorEmail": "user@example.com",
  "actorType": "user",
  "action": "post.approved",
  "resourceType": "post",
  "resourceId": "post-id",
  "requestId": "request-id",
  "metadata": {
    "fromVersion": 3,
    "approvedVersion": 3
  },
  "ip": "masked-or-truncated-ip",
  "userAgent": "",
  "createdAt": "2026-08-14T00:00:00.000Z"
}
```

Audit 不保存：

- 密碼
- Session Cookie
- Firebase ID Token
- Meta Token／Gemini Key／R2 Secret
- 完整貼文內容
- 完整 request body

### 5.5 現有 Entity 補充欄位

Post：

- `createdBy`
- `updatedBy`
- `submittedBy`
- `submittedAt`
- `approvedBy`
- `approvedAt`
- `approvedVersion`
- `approvalState`

Target：

- `scheduledBy`
- `publishedBy`
- `cancelledBy`
- `lastRetriedBy`

Post Version：

- `actorId`
- `actorEmail`
- `source`

Publish Attempt：

- `requestedBy`
- `executedBy`
- `actorType: user | system`

## 6. 後端授權管線

每個一般 API Request 依序通過：

1. `authenticateSession`
   - 驗證 Session Cookie。
   - 建立 `request.actor = { uid, email, displayName }`。
2. `loadActiveUser`
   - 確認 User 存在且不是 `suspended`。
3. `resolveClientScope`
   - 從已存在資源取得真實 `clientId`。
   - 建立資源時才讀取 body 的 `clientId`，並立即驗證 Membership。
4. `requirePermission(permission)`
   - 載入 Membership 並將 Role 轉換為 Permission Set。
5. 執行 Service。
6. 成功後寫入 Audit Event；必要時也記錄拒絕或異常事件。

### 6.1 資源範圍規則

- 不信任 body、query、header 送入的 actor、role 或 owner 欄位。
- 更新 Post 時，以資料庫中既有 Post 的 `clientId` 驗證權限。
- 更新 Media／Template／Campaign／Platform Account 亦採相同規則。
- 禁止透過 PATCH 改變既有資源的 `clientId`；跨品牌複製必須走專用 duplicate endpoint。
- 無權查看的資源回傳 `404`，避免洩漏其他品牌資源是否存在。
- `GET /api/clients` 只回傳登入者有效 Membership 可見的品牌。

### 6.2 Permission Middleware 建議介面

```js
requirePermission('content.edit', {
  resolveClientId: async (request) => getPostClientId(request.params.postId),
});
```

Route 不直接判斷 `role === 'admin'`，避免角色規則散落各處。

## 7. API 規劃

### 7.1 Authentication

```text
GET    /api/auth/csrf
POST   /api/auth/session
DELETE /api/auth/session
GET    /api/me
```

`GET /api/me` 回傳：

- 使用者基本資料。
- 可使用的品牌。
- 各品牌角色與 Permission。
- Session 到期資訊。

### 7.2 Team Management

```text
GET    /api/clients/:clientId/members
POST   /api/invitations
GET    /api/invitations
POST   /api/invitations/:invitationId/revoke
POST   /api/invitations/:invitationId/accept
PATCH  /api/clients/:clientId/members/:userId
DELETE /api/clients/:clientId/members/:userId
GET    /api/audit-events?clientId=&action=&actorId=&from=&to=
```

### 7.3 現有 API 權限化

- Posts、Versions、Generate、Rewrite：`content.*`
- Schedule：`schedule.manage`
- Publish／Retry：`publish.*`
- Media、Templates、Campaigns：對應 `*.manage`
- Insights、Inbox：至少 `content.view`
- Inbox Reply：另設 `inbox.reply`，預設 Publisher/Admin/Owner。
- Clients、Platform Accounts、Token Test：`account.manage`
- Settings、Backup、Restore、Media Cleanup、Error Log：`system.manage`
- Scheduler Trigger：維持 scheduler token 或受信任 machine identity，不套用人員 Membership。
- Meta Webhook：維持 webhook verify/HMAC，不套用人員 Membership。

## 8. 邀請與帳號生命週期

### 8.1 邀請流程

```text
Admin 建立邀請
  -> PENDING
  -> 使用者以相同且已驗證 Email 登入
  -> 後端交易建立 Membership
  -> ACCEPTED
```

失敗分支：

```text
PENDING -> EXPIRED
PENDING -> REVOKED
```

第一版不需要寄信服務：建立邀請後顯示可複製連結。後續若有通知需求再串 Gmail、SendGrid 或其他寄信服務。

### 8.2 使用者狀態

```text
INVITED -> ACTIVE -> SUSPENDED
                    -> ACTIVE
```

停權時：

- 將 User 設為 `suspended`。
- 撤銷 Membership 或保留 Membership 但禁止使用。
- 撤銷 Firebase Refresh Token。
- 寫入 `user.suspended` Audit Event。

### 8.3 Owner 防鎖死

- 系統至少保留一位 Active Owner。
- 最後一位 Owner 不得被移除、停權或降級。
- Owner 轉移必須由目前 Owner 執行。
- 緊急 bootstrap Owner 只透過部署環境變數或一次性管理腳本建立，不提供公開 API。

## 9. Post Lifecycle 與 Approval

審核狀態與發布狀態分開，不把兩種概念塞進同一欄位。

### 9.1 Approval State

```text
DRAFT
  -> IN_REVIEW
      -> APPROVED
      -> CHANGES_REQUESTED
          -> DRAFT
```

### 9.2 Target Publish State

沿用 Target 為發布真相：

```text
draft
  -> scheduled
  -> publishing
      -> published
      -> failed
          -> retrying
              -> published / failed
```

Post 的整體發布狀態仍由 Target 狀態彙總，不取代 Target 詳細結果。

### 9.3 Approval Rules

- 作者預設不能核准自己的貼文。
- 核准時保存 `approvedVersion`、`approvedBy`、`approvedAt`。
- 核准後只要文字、媒體、平台 Override 或 Target 被修改，就撤銷核准並回到 `DRAFT`。
- 若品牌啟用 `approvalRequired`，排程與發布前必須確認目前版本等於 `approvedVersion`。
- Owner 的緊急越權核准必須輸入原因並寫入 Audit。
- 審核未啟用時，現有 Draft -> Schedule/Publish 流程保持相容。

## 10. Composer、Autosave 與 Version Rules

Composer 流程：

1. 建立草稿。
2. 撰寫共用內容。
3. 加入媒體。
4. 選擇平台／帳號。
5. 視需求覆寫平台內容。
6. Preview。
7. Save／Submit Review／Schedule／Publish。

Autosave 規則：

- 保留現有 debounce。
- 每次更新帶入 `baseVersion`。
- 伺服器版本不同時回傳 `409 POST_VERSION_CONFLICT`。
- 慢 Request 不得覆蓋較新的內容。
- 衝突 UI 提供「載入最新版」或「複製成新草稿」。
- 不提供不透明的自動 merge。

重要節點建立版本：

- `submitted_review`
- `approved`
- `scheduled`
- `published`
- `restored`

每個版本保存真實 `actorId`，不再使用固定 `operator`。

## 11. Scheduling Rules

- 排程以 Target 為單位。
- 儲存 UTC `scheduledAt`，並保存 IANA `timeZone`。
- UI 必須明確顯示時區。
- 只有 `schedule.manage` 可以新增、改期、取消。
- 品牌啟用審核時，只有核准版本可以排程。
- 內容修改導致核准撤銷時，尚未執行的排程應變成 `approval_required` 或被阻擋執行，不能默默發布舊核准。
- `publishing` 狀態不保證可以取消。
- Scheduler 的 actor 固定為 `system:scheduler`，但 Target 同時保存原始 `scheduledBy`。

## 12. Publishing、Failure 與 Retry

### 12.1 Publishing Rules

- 只有 `publish.execute` 可以立即發布。
- 每次發布以 Target 建立 Publish Attempt。
- 使用 idempotency key 防止快速連點、網路重試與 Scheduler 重複執行。
- 發布前重新驗證 Membership、品牌、Target、平台帳號與核准版本。
- `published` Target 不允許用 Retry 再次發布；再次發布必須 Duplicate／Repost。
- 社群 Token 永遠不回傳完整值給前端。

### 12.2 Failure Categories

- `validation`
- `authentication`
- `permission`
- `rate_limit`
- `temporary`
- `media`
- `network`
- `platform`
- `unknown`

UI 顯示可行下一步，不直接暴露內部 stack、Token 或 provider 原始敏感資料。

### 12.3 Retry Rules

- 只有 `publish.retry` 可以手動重試。
- 重試前確認 remote ID 是否已存在。
- 重用或重新產生明確的 idempotency key。
- 重新驗證 Token、媒體 URL 與 Approval Version。
- 非 retryable 錯誤不顯示 Retry CTA。
- 每次 Retry 保存 `requestedBy`，實際背景執行者保存為 `executedBy`。

## 13. Audit Events

至少記錄：

- `auth.login_succeeded`
- `auth.login_failed`
- `auth.logout`
- `invitation.created`
- `invitation.accepted`
- `invitation.revoked`
- `membership.created`
- `membership.role_changed`
- `membership.revoked`
- `user.suspended`
- `user.reactivated`
- `client.created`
- `client.updated`
- `platform_account.updated`
- `platform_account.connection_tested`
- `post.created`
- `post.updated`
- `post.submitted_review`
- `post.approved`
- `post.changes_requested`
- `post.archived`
- `post.restored`
- `target.scheduled`
- `target.rescheduled`
- `target.unscheduled`
- `target.publish_requested`
- `target.retry_requested`
- `settings.updated`
- `system.backup_created`
- `system.restore_executed`

Audit Event 採 append-only。一般 Admin 不得刪除或修改；保留與封存依現有 History Retention 策略擴充。

## 14. UI Modules

### 14.1 Header

- 顯示使用者頭像、姓名、目前品牌角色。
- 提供登出。
- 品牌切換器只顯示有權限的品牌。

### 14.2 團隊與權限

放在「設定」內的獨立 `form-group-card`：

- 成員列表。
- 邀請成員。
- 修改品牌角色。
- 暫停／恢復使用者。
- 撤銷邀請。
- 稽核紀錄入口。

UI 遵守現有 `ui-ux-pro-max`：

- 表單欄位使用 `.field`。
- 相關欄位用 `form-group-card` 分組。
- 按鈕與互動區至少 44×44px。
- 手機小於 768px 使用單欄。
- 權限不足的高風險按鈕隱藏或 disabled，後端仍必須再次驗證。

### 14.3 權限狀態

- `401`：Session 無效，導回登入。
- `403`：已登入但缺少一般功能權限，可顯示權限說明。
- `404`：資源不存在或使用者無權得知該資源。
- `409`：版本或狀態衝突，顯示重新載入／另存草稿。

## 15. Repository 與並行安全

多人化前應將 Firestore repository 從整集合操作擴充為文件級操作：

```text
getById(id)
query(filters, orderBy, limit)
create(record)
update(id, mutator, precondition)
delete(id, precondition)
transaction(callback)
```

優先改造：

1. Memberships
2. Users
3. Posts
4. Post Versions
5. Targets／Schedule／Publish Attempts
6. Audit Events

理由：目前整集合 `list + mutate` 在多人並行下容易產生交易衝突、讀取成本與不必要的大量寫入。Post 仍使用 `version`／`baseVersion` 作為業務層樂觀鎖。

本機 JSON adapter 可維持檔案鎖與原子寫入，主要用於單機開發與遷移；正式多人環境使用 Firestore。

## 16. MVP 範圍

第一版包含：

- Google Sign-in。
- Firebase Session Cookie。
- Bootstrap Owner。
- Users、Memberships、Invitations。
- 每品牌固定角色。
- `/api/me` 與可見品牌篩選。
- 所有現有 API 的 server-side client scope。
- 團隊管理基本 UI。
- 高風險 Audit Events。
- 使用者停權與 Session 撤銷。

第一版不包含：

- 任意自訂 Permission。
- 多組織／跨公司 Tenant。
- SAML／企業 SSO。
- 強制 MFA 管理。
- 自動寄送邀請信。
- 複雜審核層級或多階段簽核。
- 即時多人協作游標或文字 merge。

Reviewer／Review Queue 可列入第二階段；資料模型先保留。

## 17. 建置階段

### P0：授權基礎

- 新增 Users、Memberships、Invitations、Audit repositories。
- 建立 Permission registry。
- 建立 `request.actor`、client scope 與 `requirePermission`。
- Firestore repository 加入文件級 query／update。
- 建立 Bootstrap Owner 遷移策略。

### P1：Firebase 登入

- Google Sign-in。
- Session Cookie 與 CSRF。
- `/api/me`。
- 登出、停權與 Token 撤銷。
- Auth Emulator 本機開發流程。

### P2：現有 API 全面權限化

- Posts、Versions、Generate、Rewrite。
- Media、Templates、Campaigns。
- Schedule、Publish、Retry。
- Insights、Inbox。
- Clients、Accounts、Settings、System。
- Scheduler／Webhook machine identity 回歸驗證。

### P3：團隊管理 UI

- 邀請。
- 成員列表。
- 角色調整。
- 停權與恢復。
- Audit Log。

### P4：可選審核流程

- Review Queue。
- Submit／Approve／Changes Requested。
- Approved Version 鎖定。
- 排程與發布前的 Approval Gate。

### P5：安全強化

- 高風險操作重新驗證。
- 異常登入與越權監控。
- Audit retention／export。
- 邀請寄信與網域限制。

## 18. 測試與驗收

### 18.1 身分與 Session

- 有效／無效／過期／撤銷 Session。
- 停權使用者立即被拒絕。
- Email 不相符時不能接受邀請。
- CSRF 缺失或錯誤時不能建立 Session。

### 18.2 Permission Matrix

- 每個 Role 的 allow／deny 測試。
- Editor 無法發布。
- Publisher 無法管理平台 Token。
- Reviewer 無法直接修改內容。
- Viewer 無法執行寫入。
- Admin 無法移除最後一位 Owner。

### 18.3 Client Isolation／IDOR

- 修改 query `clientId` 不能看到其他品牌。
- 猜測 Post／Media／Template／Campaign ID 不能跨品牌讀寫。
- 跨品牌 duplicate 必須同時具備來源查看與目的品牌建立權限。
- `/api/clients` 不會洩漏未授權品牌。

### 18.4 工作流

- 修改已核准內容會撤銷 Approval。
- 未核准版本不能排程／發布。
- 排程器使用原始 `scheduledBy` 與 machine actor。
- Retry 不會造成 duplicate publish。
- 兩人同時編輯時回傳 409，不覆蓋較新版本。

### 18.5 Audit

- 每個高風險操作都有 actor、clientId、resourceId、時間。
- Audit 不包含 Secret 或完整內容。
- 使用者無法偽造 actor 欄位。

## 19. Risks

| 風險 | 影響 | 對策 |
|---|---|---|
| 只做登入、不做資源 Scope | 跨品牌資料外洩 | 所有 Service 強制 Membership 與 stored `clientId` 驗證 |
| Firestore server access 繞過 Security Rules | 後端錯誤即可能讀寫全部資料 | Express Permission + scoped repository + IAM 最小權限 |
| 前端可送入 actor／role | 偽造身分與稽核 | 伺服器覆寫並移除受保護欄位 |
| Role 放入長效 Token | 降權後仍可操作 | Membership 為真相；高風險操作即時查詢與 Session 撤銷 |
| 整集合 Firestore mutate | 多人衝突、成本與大量寫入 | 文件級 transaction／precondition |
| 邀請 Token 外洩 | 未授權加入品牌 | 只存 Hash、短效、一次性、驗證 Email |
| 最後 Owner 被移除 | 系統無管理者 | 至少保留一位 Active Owner |
| Scheduler 被套用人員權限 | 背景發布失效 | 獨立 machine identity 與明確 Audit actor |
| 核准後內容被修改 | 發布未審內容 | `approvedVersion` Gate，修改即撤銷核准 |

## 20. Next Build Target

第一個實作目標是 **P0 授權基礎＋P1 Firebase 登入**，依序：

1. 新增 User／Membership／Invitation／Audit schema 與 repository。
2. 新增 Permission registry 與 client scope middleware。
3. 建立 Firebase Session Cookie 登入與 `/api/me`。
4. 將 `GET /api/clients` 改為只回傳有權限品牌。
5. 先權限化 Posts、Media、Schedule、Publish 四個高風險模組。
6. 再完成其餘 API 與團隊管理 UI。

在所有 API 完成品牌 Scope 保護以前，不應先對正式使用者開放多人登入。

## 21. 參考資料

- Firebase：Verify ID Tokens  
  <https://firebase.google.com/docs/auth/admin/verify-id-tokens>
- Firebase：Manage Session Cookies  
  <https://firebase.google.com/docs/auth/admin/manage-cookies>
- Firebase：Custom Claims  
  <https://firebase.google.com/docs/auth/admin/custom-claims>
- Firestore：Security Rules Conditions  
  <https://firebase.google.com/docs/firestore/security/rules-conditions>
- ShrineFlow 雲端部署架構：`docs/superpowers/specs/2026-08-14-cloud-deployment-architecture.md`
- ShrineFlow 通用社群發布 Roadmap：`docs/superpowers/specs/2026-08-14-general-social-publishing-roadmap.md`
- ShrineFlow 多品牌發布設計：`docs/superpowers/specs/2026-08-13-multi-client-publishing-design.md`
