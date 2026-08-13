# ShrineFlow 多客戶／多平台發布 — 設計規格

日期：2026-08-13  
狀態：待使用者確認後再寫實作計畫  
決策：代操模式＋方案 1（客戶為頂層、一則貼文多發布目標）＋本機 JSON＋Phase 1 骨架（僅 Facebook 真發布）

---

## 1. 這次要解決什麼

現況是「一台電腦、一個 Facebook 粉專、一篇草稿對一個平台」。  
實際代操會有多間客戶，每家有自己的 FB／IG／LINE 等；同一檔宣傳可能要發到多個平台，文案與時間可以一樣也可以不一樣。

本規格把產品改成：

- 一個後台管很多客戶（代操／工作室模式）
- 一則貼文可掛多個「發布目標」（每個目標＝一個平台帳號）
- 每個目標的文案、發布方式、時間可獨立
- 編輯畫面一次只看某一個帳號會發出去的樣子
- 第一版先把骨架與網頁做對；真正發得出去的仍只有 Facebook

---

## 2. 誰在用、怎麼成功

| 項目 | 決定 |
| --- | --- |
| 使用者 | 你（或少數小編），不是客戶自己登入 |
| 成功標準（Phase 1） | 可新增／切換客戶；一則貼文可為多帳號各寫各的、各排時間；編輯時只見當前帳號；到期時 FB 目標會真的發布；IG／LINE 可建帳號與預覽，不真發 |
| 非目標（Phase 1） | 客戶登入、權限矩陣、審核佇列、完整月曆牆、IG／LINE／Threads 真發布、SQLite／雲端 DB |

---

## 3. 白話概念（給一般人看）

### 客戶
每一間宮廟／品牌是一個客戶。  
客戶底下有自己的社群帳號；帳號與授權只屬於這家，不跟別家混。

### 一則貼文
為某個客戶做的「這一檔內容」。  
可有共用素材與 AI 母稿（神明名稱、說明、共同圖片／影片等）。

### 發布目標
同一則貼文可勾多個帳號（例如這家的 FB＋這家的 IG）。  
每個目標可以：不同文案、不同發布方式（貼文／Reel／限時…）、不同時間、各自成功或失敗。

### 畫面上怎麼看
一次只看「目前選的那個帳號」那一版。  
粉絲在 FB 只會看到 FB 那則，在 IG 只會看到 IG 那則。

### 時間
各目標自己的時間；設成相同＝一起發，不同＝錯開。

---

## 4. 網頁資訊架構與操作流

### 頂欄
新增「目前客戶」切換器。切換後，草稿／排程／該客戶帳號設定都只顯示這家。

### 分頁（沿用並微調）

1. **產生文案** — 在當前客戶下產母稿與共用素材，建立／更新一則貼文。
2. **編輯預覽** — 主戰場：勾選發布目標帳號；點一個帳號只編／預覽該版（文案、格式、排程時間）。
3. **草稿** — 當前客戶未完成貼文列表。
4. **排程** — 以「帳號目標」列查看時間與狀態；可改時間、取消、對 FB 立刻發布。
5. **設定** — 全站（如 Gemini）＋當前客戶的平台帳號連線。

### 典型流程
切客戶 → 產文存貼文 → 編輯預覽勾帳號並逐個調整 → 存草稿或排程 → 到期由排程器處理（Phase 1 僅 FB 真發）。

### UI 約束
沿用既有 `ui-ux-pro-max`／`AGENTS.md`：`form-group-card`、`.field`、少項用 `radio-pill-group`、觸控 44px、禁止水平捲軸、面板 min-height。前端維持 Express 靜態 HTML／CSS／JS，不因本規格重寫成 React。

---

## 5. 資料模型（實作用）

儲存：本機 JSON（`data/`），與現況一致。

### 5.1 `data/clients.json`

```json
[
  {
    "id": "client_xxx",
    "name": "範例宮廟",
    "notes": "",
    "createdAt": "2026-08-13T00:00:00.000Z",
    "accounts": [
      {
        "id": "facebook:pageId",
        "platformId": "facebook",
        "name": "粉專顯示名稱",
        "enabled": true,
        "configured": true,
        "credentials": {
          "pageId": "...",
          "pageAccessToken": "..."
        }
      }
    ]
  }
]
```

規則：

- `credentials` 只存在伺服器；API 回前端時 token 必須遮罩（例如只回「已設定」）。
- 非 FB 平台 Phase 1 可 `configured: false`，仍可出現在目標勾選與預覽。
- 從現有 `.env` 的單一 FB 設定遷移：建立預設客戶「預設客戶」，寫入一筆 FB 帳號。

### 5.2 `data/posts.json`（一則貼文＋多目標）

```json
{
  "id": "post_xxx",
  "clientId": "client_xxx",
  "godName": "天上聖母",
  "postType": "work",
  "notes": "",
  "hashtags": [],
  "mediaPaths": [],
  "facebookCopy": "母稿…",
  "reelCopy": "",
  "status": "draft",
  "targets": [
    {
      "id": "tgt_xxx",
      "accountId": "facebook:pageId",
      "platformId": "facebook",
      "contentType": "post",
      "contentSettings": {},
      "copyOverride": null,
      "mediaPaths": null,
      "scheduledAt": "2026-08-14T02:00:00.000Z",
      "status": "scheduled",
      "externalId": null,
      "publishedAt": null,
      "lastError": null
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

規則：

- `copyOverride`／目標 `mediaPaths` 為 `null` 時沿用貼文母稿／共用媒體。
- 貼文層 `status` 為彙總（例如：任一 target scheduled → 可顯示「部分已排程」；實作時用明確彙總規則，見下）。
- 舊草稿遷移：補 `clientId`＝預設客戶；把原 `channel`＋`accountId`＋`contentType`＋`contentSettings`＋排程資訊收成單一 `targets[]` 元素。

### 5.3 排程存放

**排程掛在 target**（`scheduledAt`＋target `status`）。  
可選保留薄 `schedule.json` 當索引以相容舊排程器；若保留，必須與 target 雙寫或改為由 posts 派生，避免兩套真相。  
**本規格建議：Phase 1 以 posts.targets 為唯一真相；scheduler 改掃 posts；舊 `schedule.json` 遷移後可停止寫入或只讀遷移。**

### 5.4 貼文彙總狀態（明確規則）

| 條件 | 貼文 `status` |
| --- | --- |
| 無 targets 或全部為 draft | `draft` |
| 任一 target 為 `scheduled`／`publishing` | `scheduled` |
| 全部可發布目标已 `published`，且無 failed | `published` |
| 任一 `failed`，且沒有仍 pending／scheduled | `failed`（或部分失敗；UI 以 target 列為準） |
| 混合 published＋scheduled | `scheduled`（仍有未完成） |

UI 列表以 target 列為準，不依賴貼文彙總單獨判斷細節。

---

## 6. 後端架構

### 模組邊界

| 模組 | 職責 |
| --- | --- |
| `lib/clients.js`（新） | 讀寫客戶、帳號、遮罩憑證、選當前客戶用的帳號列表 |
| `lib/platforms.js` | 平台與 contentType 定義（既有，可擴） |
| `lib/publishers/*`（新方向） | 每平台 adapter；Phase 1 實作 `facebook`；其他回「尚未支援」 |
| `lib/scheduler.js` | 改為掃 `posts[].targets`，依 `platformId` 呼叫 adapter |
| `lib/routes/clients.js`（新） | 客戶 CRUD、帳號 CRUD、連線測試 |
| `lib/routes/posts.js` 等 | 所有貼文 API 帶 `clientId` 範圍；寫入／更新 targets |
| `lib/settings.js` | 全站 Gemini 等；FB 全域 `.env` 改為「遷移來源」，之後以客戶帳號為主 |

### 發布資料流

1. 前端對某 target 設 `scheduledAt` 或按立刻發布。  
2. Scheduler／立即 API 載入 post＋target＋該客戶 account 憑證。  
3. 選 publisher adapter。  
4. Facebook：沿用現有發布邏輯，改吃客戶帳號憑證而非唯一 `.env`。  
5. 其他平台：標記 `skipped_unsupported` 或同等明確狀態，不寫假成功。  
6. 更新該 target 的 `status`／`externalId`／`lastError`；貼文彙總狀態重算。

### 錯誤處理

- 單一 target 失敗不回滾其他 target。  
- 暫時性錯誤：沿用現有 FB 重試（最多 3 次之類）。  
- 永久錯誤／未支援：寫入 `lastError`，狀態 `failed` 或 `skipped_unsupported`。  
- API 對「客戶不存在／帳號不屬於該客戶／貼文不屬於該客戶」回 404／403 式明確錯誤。

---

## 7. 前端狀態（概念）

- `currentClientId`（localStorage 記住上次選擇）  
- 載入該客戶 posts／accounts  
- 編輯中：`activePostId`、`activeTargetId`（決定預覽與表單）  
- 切換 target 時只換「該目標覆寫欄位＋預覽版型」，共用素材區可保留  

不引入 React；在現有 `public/modules/*` 擴充。

---

## 8. 測試範圍（Phase 1）

- `clients`：CRUD、憑證遮罩、遷移自 `.env`  
- `posts` targets：新增／更新目標、時間相同與不同、彙總狀態  
- `scheduler`：只對 facebook configured target 真發；未支援平台不標 published  
- 既有 facebook／copy-format／settings 測試在憑證改掛客戶後仍通過（或更新 fixture）  

純前端 HTML／CSS 調整不強制跑後端全套測試。

---

## 9. Phase 邊界

### Phase 1（本規格）

- 客戶切換與客戶／帳號 JSON  
- 貼文多 targets；編輯一次一帳號  
- 排程掛 target；FB 真發布  
- IG／Threads／LINE：帳號欄位＋預覽＋未支援狀態  
- 舊資料遷移  

### 之後（不在本規格實作承諾內）

- Instagram／LINE／Threads 真發布 adapter  
- Token 加密、OAuth、App Review  
- SQLite、登入權限、審核、完整日曆  
- 每客戶獨立神明庫等  

---

## 10. 決策紀錄

| 問題 | 選擇 |
| --- | --- |
| 誰用 | 代操（A） |
| 架構方案 | 客戶頂層＋一則貼文多目標（方案 1） |
| 文案 | 每目標可不同；畫面一次一帳號 |
| 時間 | 每目標可相同或不同 |
| 儲存 | 本機 JSON（A） |
| Phase 1 深度 | 骨架優先，僅 FB 真發（A） |

---

## 11. 自檢摘要

- 無 TBD 佔位；Phase 邊界已劃清。  
- 排程唯一真相定為 `posts.targets`（避免與舊 `schedule.json` 雙寫含糊）。  
- 「一則貼文多目標」與「編輯一次一帳號」一致。  
- 單 target 失敗不影響其他 target。  
- 範圍適合一份實作計畫；真發布其他平台另開規格。
