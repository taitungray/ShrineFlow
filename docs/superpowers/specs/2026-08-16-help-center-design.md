# ShrineFlow 幫助中心 — 設計規格

日期：2026-08-16  
狀態：已核准，實作中  
前置：後台現況（Express + 靜態頁）、`docs/PROJECT_GUIDE.md`、設定頁 Meta 教學、既有平台／排程錯誤文案  
決策：側邊新增「幫助」頁；內容涵蓋**怎麼用每一個畫面**＋**會遇到的問題與解法**＋**系統做不到的事**。不是只寫近期踩雷。

---

## 1. 這次要解決什麼

營運／編輯進後台時，不知道：

- 每個側邊項目是做什麼、先做哪一步
- 母稿、平台覆寫、Idea、草稿、審核、排程差在哪
- Facebook／Instagram／Threads 憑證怎麼拿、為什麼測過了還發不出去
- 錯誤英文／狀態碼代表什麼、下一步去哪一頁修
- 哪些能力刻意沒做（廣告、Story 排程、關機後 IG 仍會發…）

現況：設定頁有 Meta 長步驟，散落 helper 與 toast。沒有一個可搜尋的幫助入口。

成功標準：

1. 側邊可進 `#/help`；搜尋可貼錯誤原文或症狀。
2. 每個主要畫面至少有一篇「這頁做什麼／怎麼用」。
3. 已知會擋人的限制與後端／平台錯誤，都有對應條目與解法。
4. 單則可分享：`#/help/<article-id>`。
5. 設定頁既有 Meta 步驟保留；幫助寫完整解法，並連回設定對應區塊。

---

## 2. 非目標

- 獨立後端 CMS、多語、客服工單、AI 客服。
- 第一版 toast 自動跳幫助（之後可加「查看說明」；本輪不做）。
- 工程／本機 Git／Cloud Run revision 教學（對象是後台操作者，不是部署工程）。
- 廣告投放、Boost、競品監控、外部工具排程完整匯入（條目只說明「不做」）。
- 把設定頁長文刪掉改只留幫助（兩處並存：填表時看設定，迷路時看幫助）。

---

## 3. 放哪、怎麼進

| 項目 | 決定 |
| --- | --- |
| 導覽 | 側邊「管理」最底，設定下方：**幫助** |
| 網址 | `#/help`；單則 `#/help/<id>`；搜尋 `#/help?q=...` |
| 手機底欄 | 仍是總覽／內容／新增／日曆。幫助走側邊選單（☰） |
| 權限 | 所有已登入且能看後台的人可開幫助（`content.view` 級）。內文不顯示 Token／密鑰 |
| 設定跳轉 | 幫助步驟可連 `#/settings`、`#/platforms`、`#/calendar` 等 |

`public/modules/tabs.js` 新增 `help` → `help`。

---

## 4. 頁面結構（好用優先）

上到下：

1. **標題＋一句話**：這是操作手冊。可貼錯誤、也可查「怎麼排程」。
2. **搜尋框**（autofocus 桌面）：placeholder「貼錯誤原文，或輸入：排程、Token、審核、Queue…」
3. **類型 pill**（2～4 項，必用 pill 不用 select）：
   - 全部
   - 怎麼做
   - 出問題了
   - 限制與做不到
4. **主題 pill**（`flex-wrap`，禁止水平捲軸）：
   - 全部
   - 開始使用
   - 編輯與 AI
   - 素材
   - Facebook
   - Instagram
   - Threads
   - 排程與日曆
   - 發布與失敗
   - 內容與審核
   - 團隊與權限
   - 成效與收件匣
   - 設定與備份
5. **結果列表**：卡片。無結果時提示改關鍵字，並列 3 則最常見（Token、粉專 ID、IG 媒體網址）。

卡片預設：標題＋一句症狀／一句用途。點開（或深連結）固定四段：

1. **這是什麼／你看到什麼**
2. **為什麼**（系統規則或平台限制，講人話）
3. **怎麼做**（編號步驟；能連畫面就連）
4. **相關畫面**

長教學（第一次接 Facebook）用 `<details>` 包進階步驟，開頭仍給 4 步摘要，避免一開頁被牆文淹沒。

視覺：既有 `panel`、`form-group-card`、`field`、`radio-pill-group`、`min-height: 540px`。不新增第二套設計語言。

---

## 5. 內容模型

靜態資料：`public/modules/help-articles.js`（前端模組，無 CMS）。

每則：

```text
id            網址用 kebab-case
kind          guide | troubleshoot | limit
topics        上列主題一或多個
title         使用者會搜的句子（症狀或任務，不要工程內部名當主標）
summary       列表一句
keywords      錯誤原文片段、狀態碼、畫面名、同義詞
symptoms      你看到什麼（troubleshoot 必填）
cause         為什麼
steps         怎麼做（字串陣列）
related       [{ label, href }]  例如 設定 Facebook、日曆
settingsHint  可選：指向設定頁既有 disclosure，避免兩份長文完全分叉時提醒維護者
```

搜尋：大小寫不敏感，比對 `title`、`summary`、`keywords`、`symptoms`、`cause`、`steps`。錯誤原文（`Unsupported post request`、`code 190`）必須能命中。

深連結找不到 id：顯示幫助首頁＋提示「找不到這則說明」。

---

## 6. 條目清單（第一版必須齊）

原則：對齊 `PROJECT_GUIDE` 與實際 API／UI 限制，不是只寫近期對話裡出現過的錯。實作時每則寫滿四段，下表是範圍與搜尋錨點。

### 6.1 開始使用（guide）

| id | 標題（使用者語言） | 必寫重點 |
| --- | --- | --- |
| `getting-started` | 第一次使用：建議順序 | 登入 → 選／建品牌 → 測平台連線 → 設 Gemini → 新增內容 → 存草稿 → 排程或立刻發 |
| `what-is-brand` | 品牌是什麼、為什麼要切換 | 每個品牌自己的 Token、內容、素材；發錯品牌＝發錯粉專 |
| `nav-map` | 側邊每一頁是做什麼 | 對照總覽／內容／新增／日曆／素材庫／模板／活動／發布紀錄／成效／收件匣／審核／團隊／平台連線／設定 |
| `login-expired` | 請先登入／登入已過期 | 重新整理再登；Firebase 與本機登入模式不要混用 |

### 6.2 編輯、AI、預覽（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `composer-basics` | 怎麼寫一篇：母稿與平台覆寫 | 先母稿，再勾平台；平台文案可獨立改；預覽≠已發布 |
| `ai-generate` | 怎麼用 AI 產生文案 | 主題必填；方向／備註／素材會進 prompt；沒 Key 會失敗 |
| `ai-rewrite` | 平台 AI 改寫與還原母稿 | 建議要按儲存才寫入覆寫；還原母稿清覆寫 |
| `gemini-key-invalid` | Gemini 連線失敗／Key 無效 | 設定貼 AI Studio Key、測連線、模型名與備援 |
| `hashtags-and-comment` | Hashtag 與第一則留言 | hashtag 會附在文案後；第一則留言需平台權限，失敗不回滾已發貼文 |
| `autosave-conflict` | 儲存衝突／版本已變更 | 兩分頁同編；重新整理後再存；看版本歷史再還原 |

### 6.3 素材（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `media-upload` | 怎麼上傳與排序素材 | 單次最多 10 檔、單檔 20MB、JPG／PNG／MP4；第 1 張主圖；素材庫可重用 |
| `media-file-too-large` | 檔案超過 20MB | 壓縮或縮短影片後再傳 |
| `media-mixed` | 不能圖影混在同一則 | FB／IG 貼文：多圖**或**單影片；拆兩則 |
| `media-format-limits` | 各格式要幾張、影片多長 | FB 貼文最多 10；Reel／Story 各 1 支影；FB Reel ≤90s、Story ≤60s；IG Reel 3～900s、Story ≤60s；Threads 最多 1 個媒體、影片 ≤300s |
| `public-media-url` | IG／Threads 有圖影發不出去 | 設 HTTPS `PUBLIC_MEDIA_BASE_URL`（不含 `/uploads`）；localhost 無效；雲端用公開媒體網域 |
| `media-library` | 素材庫、清理未使用 | 看用在哪篇；清理前確認沒被草稿引用 |

### 6.4 Facebook（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `facebook-connect` | 怎麼接 Facebook 粉專 | Graph Explorer → `me/accounts` 拿粉專 **id**＋**Page token**；測連線要出現粉專名；完整步驟可連設定頁 disclosure |
| `facebook-user-id` | Unsupported post／Object does not exist | 貼了 User ID 或 User token；必須 `me/accounts` 的粉專 id／Page token。關鍵字含英文原文 |
| `facebook-token-expired` | Token 已過期（code 190） | Debugger、Never、不要短效 User token；改密碼／撤 App／失去管理員會失效 |
| `facebook-permissions` | 權限不足 pages_manage_posts | App 使用案例加 `pages_show_list`、`pages_read_engagement`、`pages_manage_posts`；不要 `manage_pages` |
| `facebook-cannot-parse-token` | Cannot parse access token | 貼到 JSON 或數字 id，不是 `EAA...` |
| `facebook-accounts-empty` | me/accounts 是空的 | 登入者須為粉專管理員，且是同一個 App 角色的 Facebook 帳號 |
| `facebook-story-no-schedule` | 限時動態不能排程 | Graph 無原生排程；改貼文／Reel 或立刻發 Story |
| `facebook-schedule-window` | 須 10 分鐘後／不能超過約 6 個月 | FB 原生排程時間窗；本機 IG 最短約 1 分鐘 |
| `facebook-remote-schedule` | 遠端排程讀不到 | Token；遠端卡只讀；孤兒排程去 Meta Business Suite 刪 |
| `facebook-duplicate-posts` | 同一則出現很多篇排程 | 確認排程按一次；已排改時間用編輯；舊孤兒去 Meta 刪 |

### 6.5 Instagram（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `instagram-connect` | 怎麼接 Instagram | 專業帳號綁粉專；User ID＝`instagram_business_account.id` 不是 @帳號；Token 常與 Page token 同一串 |
| `instagram-not-linked` | 找不到 instagram_business_account | 沒綁粉專或權限沒加 `instagram_basic`／`instagram_content_publish` |
| `instagram-schedule-local` | IG 排程跟 Facebook 不一樣 | 本機到點才發；**服務要開著**；關機不會發；不預建 24h 過期的 container |

### 6.6 Threads（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `threads-connect` | 怎麼接 Threads | Threads Token 常 `THQVJ...`，**不要貼 FB 的 EAA**；User ID 來自 `graph.threads.net/me` |
| `threads-schedule-local` | Threads 排程也是本機到點發 | 同 IG：服務要開著；純文字可不設媒體網址 |

### 6.7 排程、日曆、Queue、Evergreen（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `schedule-how` | 怎麼排程、改期、取消 | 日曆月／週／列表；拖曳改期；取消＝FB 會刪遠端、IG／Threads 只改本機 |
| `schedule-already` | 已經排程不能再按一次確認 | 改時間用 PATCH／日曆；再 POST 會 409，避免重複打 Graph |
| `queue-how` | Queue 固定時段是什麼 | 品牌＋帳號時段；沒 slot 要加時段或暫停後再排 |
| `calendar-dst` | 夏令時間這格不存在／重複 | 改選其他本地時間；時區用 IANA（預設 Asia/Taipei） |
| `evergreen-how` | 固定間隔再發（Evergreen） | 只能從已發布；間隔 1～90 天、次數 1～50；不繞過審核；停用後已建排程要另取消 |
| `crisis-pause` | 危機暫停會怎樣 | 擋本機新 claim；會嘗試取消 FB 原生排程；恢復前不能新建排程 |
| `idea-cannot-schedule` | Ideas 不能直接排程 | 先轉成草稿 |
| `archived-cannot-schedule` | 封存不能排程／發布 | 先還原 |

### 6.8 發布與失敗（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `publish-now` | 立刻發布怎麼用 | 只發有勾且已串接的 target；按鈕會鎖，勿連點 |
| `publish-failed` | 狀態 failed／要重試 | 看發布紀錄錯誤；暫時性會重試；權限／媒體屬驗證錯誤要先修 |
| `partial-success` | 有的平台成功有的失敗 | 不是整篇失敗；只處理失敗的 target |
| `content-type-unsupported` | 此格式尚未串接發布 | 換已支援格式；預覽可以、真發不行 |
| `approval-required` | 品牌啟用審核就不能直接發 | 送審 → 核准後再排／發；改文案後可能要重新核准 |

### 6.9 內容生命週期（guide）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `content-statuses` | Idea／草稿／審核／已排／已發／失敗／封存 | 各能做什麼、不能做什麼 |
| `duplicate-and-repurpose` | 複製與已發布再製 | 都是新草稿；再製要已發布且有真實成效資料 |
| `bulk-csv` | CSV 批次匯入與批次排程 | 先驗證再建立；一列失敗整批不寫；批次排程＝本機，不是 Meta Planner；欄位說明 |

### 6.10 審核與團隊（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `review-queue` | 送審、核准、要求修改 | 誰看得到審核佇列；改完版本可能掉回未核准 |
| `roles-permissions` | 角色：擁有者／管理員／編輯／審核／發布／檢視 | 看不到設定＝沒 `system.manage`；發不了＝沒 `publish.execute`；403「你沒有執行此操作的權限」 |
| `member-invite` | 邀請成員與停權 | 停權＝失去各品牌登入；操作紀錄誰看得到 |

### 6.11 成效、收件匣、模板、活動（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `insights-empty` | 成效沒數字 | 只顯示平台真實資料；沒權限／沒貼文 ID／尚未接入就不猜 |
| `best-times` | 最佳時段不出現 | 至少約 10 筆已發布樣本才算 |
| `inbox-how` | 收件匣怎麼回 | 未讀／待回／Saved replies；部分平台需額外權限；本機不存完整聊天倉儲 |
| `templates-campaigns` | 模板與活動 | 存常用結構；貼文可掛活動看進度 |

### 6.12 平台連線、設定、備份（guide + troubleshoot）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `platforms-page` | 平台連線頁的狀態是什麼 | 已連線／未設定／需權限／尚未支援 |
| `settings-save-order` | 設定要先存再測 | Gemini／全站一個儲存；FB／IG／Threads 各有「儲存此品牌連線」 |
| `backup-restore` | 備份含什麼、不含什麼 | JSON 內容與紀錄；**不含** `.env`／Token；還原前會再備一份 |
| `master-key` | 主密鑰遺失 | 設了 `SHRINEFLOW_MASTER_KEY` 才加密；遺失無法解密，系統不重設 |
| `error-log` | 錯誤記錄在哪看 | 設定 → 備份區「查看錯誤記錄」；幫助搜尋可貼那裡的原文 |

### 6.13 限制與做不到（limit）

| id | 標題 | 必寫重點 |
| --- | --- | --- |
| `cannot-do` | 目前不做／不宣稱的功能 | 廣告／Boost、社群聆聽、完整 Meta Planner 雙向同步、外部排程全部匯入、FB Story 排程、Reel 封面、LINE |
| `ig-offline` | 電腦或雲端服務關了，IG／Threads 排程還會發嗎 | 不會。只有 Facebook 原生排程可能仍由 Meta 到點公開 |
| `line-removed` | 有沒有 LINE | 產品已移除 LINE VOOM |

---

## 7. 與設定頁長教學的關係

- **設定頁**：填憑證當下展開步驟（已存在，不刪）。
- **幫助**：同一件事用「症狀／任務」當標題，步驟寫完整到操作者能做完；文末連設定對應卡片。
- Facebook Graph 逐步操作允許兩邊都有；幫助版以任務標題為主（「發文說 Object does not exist」），設定版以「正在填這個欄位」為主。

---

## 8. 實作要點

- `public/index.html`：`data-view-panel="help"` 面板；側邊連結。
- `public/modules/help.js`：搜尋、pill 篩選、深連結、渲染卡片。
- `public/modules/help-articles.js`：條目資料（本規格第 6 節全部落地）。
- `public/modules/tabs.js`：路由與頁面標題「幫助」。
- `public/style.css`：幫助列表／搜尋／展開，沿用既有間距與 pill，不引入水平捲軸。
- 版號：實作時同步 `package.json` 與 `index.html` 的 `?v=`。
- 測試：純前端為主；若抽搜尋函式，可對 `filterHelpArticles(query, filters)` 做小測試（關鍵字命中英文錯誤原文）。不為此跑全套後端測試。

---

## 9. 維護規則

之後新增會擋人的 API 錯誤或畫面，**同一 PR** 要加幫助條目（至少 keywords 含錯誤原文）。幫助不是一次性文案牆。

---

## 10. 自我檢查

- [x] 涵蓋側邊所有主要畫面，不是只有 FB Token。
- [x] 教學、疑難、限制三類都有入口。
- [x] 搜尋能吃 Graph 英文錯誤。
- [x] 寫明 IG／Threads 關機不發 vs FB 原生排程。
- [x] 不做 CMS／toast 自動跳轉／工程部署教學。
- [x] UI 跟 `ui-ux-pro-max`（pill、fieldset、無橫向捲軸、panel 高度）。
- [x] 使用者審閱本規格後才寫實作計畫與開工。
