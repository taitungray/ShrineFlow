# ShrineFlow 競品第二輪功能缺口分析與落地校正版

> 日期：2026-08-15
> 規劃基線：v0.5.42
> 文件狀態：已完成結構審查，尚未選定實作包、尚未寫實作計畫
> 適用架構：Express + 靜態 HTML/CSS/JavaScript；本機模式使用 JSON，雲端部署沿用既有 repository abstraction
> 前次競品結論：`2026-08-14-general-social-publishing-roadmap.md` §1（當時基線 v0.3.19）

本文件是核心閉環（寫 → 覆寫 → 排 → 發 → 重試 → 成效／收件匣）完成後的第二輪對照。目的不是再抄一套 SaaS 全家桶，而是標出 **單人＋多品牌＋Facebook／Instagram／Threads** 仍值得加的功能，以及明確不抄的範圍。

本版新增一項重要原則：**競品 UI 有某個功能，不等於 Meta Graph API 已提供同等能力。** 凡涉及外部平台讀取、排程、留言、封面或通知的能力，必須先完成 API spike、權限確認與失敗狀態設計，才可進入實作包。

## 0. 產品約束（沿用）

1. 不做成縮小版 Hootsuite。定位維持：單人操作、多品牌、多平台、AI 輔助、檔案式儲存的內容營運工具。
2. 前端維持 Express + 靜態頁；UI 跟 `ui-ux-pro-max` 與 `AGENTS.md`。
3. 不引入產品層資料庫。新資料實體在本機模式使用 JSON，必須有筆數／檔案上限、原子寫入、備份與健康檢查；若部署使用既有 Firestore repository，需沿用相同資料語意與保留策略。
4. 成效數字只顯示平台 API 回傳或有時間戳的 cached 資料，不虛構。
5. 審核佇列／團隊權限若已有雛形，不再堆企業多層審核。
6. 廣告投放、社群聆聽、競品監控、變現、link-in-bio、原生手機 App 不納入本輪。
7. 「全部排程」若未特別註明，只代表 ShrineFlow 建立並可辨識的排程，不宣稱能暫停或同步使用者在其他工具建立的所有遠端排程。

### 0.1 研究與 API 證據規則

- 競品功能需記錄查詢日期、產品方案／帳號類型、地區與來源 URL；行銷頁的功能描述不可直接當成 API 契約。
- Meta 能力需另外記錄 Graph API 版本、endpoint、權限、App Review 狀態、帳號類型與測試結果。
- 目前 Facebook App Review／Business Verification 尚未完成；新能力要能顯示 `not_available`／`permission_required`，不可把未驗證的 capability 當成已支援。

## 1. 研究來源

- Hootsuite 中文解方頁：<https://fc.bnext.com.tw/solutions/view/HootSuite>
- Hootsuite Publishing：<https://www.hootsuite.com/platform/publish>
- Hootsuite Bulk Composer：<https://help.hootsuite.com/s/article/bulk-schedule>
- Buffer 首頁：<https://buffer.com/>
- Buffer Publish：<https://buffer.com/publish>
- Buffer Instagram 首則留言與排程：<https://support.buffer.com/article/657-scheduling-instagram-posts-and-reels>
- Buffer Community／Saved replies：<https://support.buffer.com/article/921-engaging-with-community-comments-in-buffer>
- Meta Business Suite（Creators）：<https://creators.facebook.com/tools/meta-business-suite/>
- Meta Page 排程說明：<https://www.facebook.com/help/389849807718635>
- Instagram 排程貼文／Reel 說明：<https://www.facebook.com/help/instagram/439971288310029?locale=es_LA>

研究註記：競品頁面與平台說明可能因方案、地區、帳號類型與產品 rollout 改變；本文件只把它們當作需求線索，不把 UI 能力直接推論成可用 API。

## 2. 三站實際賣什麼

| 站 | 核心賣點 | 對 ShrineFlow 的意義 |
|---|---|---|
| **Hootsuite** | 日曆＋大量排程、統一收件匣、審核、分析、競品／聆聽 | 營運中台。排程節奏、Inbox 捷徑、危機暫停可借；聆聽、競品、企業審核不抄 |
| **Buffer** | Create／Publish／Community／Insights。Queue、Ideas、AI、首則留言、手機 App、Start Page | 單人節奏最貼。Queue、靈感板、IG 首則留言優先；首則留言需限定 Instagram Professional capability |
| **Meta Business Suite** | FB／IG 原生 Planner、大量上傳影片、Crosspost、Insights、Inbox、廣告、變現 | 原生狀態是權威。Story／Reel／最佳時段／遠端對帳可對齊；廣告／變現／Inspiration Hub 不做 |

Hootsuite 解方頁把產品收成三件事：排程發文、監控互動、分析成效。Buffer 把同一件事拆成「寫、排、回、看」。MBS 是 Meta 自家帳號的 Planner＋Inbox＋Ads。

競品結論仍是：ShrineFlow 不應成為縮小版 Hootsuite，而應成為單人操作、多品牌、多平台、AI 輔助、檔案式儲存的內容營運工具。完成競品功能不等於產品成功；成功標準應是減少排程操作、提高發布可追蹤性、遇到危機能安全停止，以及不把平台限制偽裝成成功。

## 3. 現況已有（不要再當新功能提）

| 能力 | 現況 | 本輪真正缺口 |
|---|---|---|
| Composer 母稿＋平台覆寫＋AI 產文／改寫 | 有 | 無 |
| 月／週／列表日曆、改期、取消、重試 | 有；**無拖曳改期** | 拖曳互動與遠端排程同步邊界 |
| 素材庫、模板、Campaign | 有 | 無 |
| 每 target 狀態、`partial_success`、attempt 歷史 | 有 | 首則留言等子交付結果需另建狀態 |
| Autosave、版本、封存、複製草稿 | 有 | 無 |
| Insights（真實 API、cached、不虛構） | 有；**無「最佳時段」解讀** | 樣本數、指標與時區模型 |
| Inbox 讀＋回＋標籤／備註 | 有；provider-backed，不保存完整訊息全文 | 未讀／手動待回篩選、Saved replies |
| FB 原生排程；IG／Threads 本機到期發 | 有 | Queue、暫停／恢復、可觀測性 |
| FB／IG Story、Reel 格式 | 有；FB Story 只能立即發；IG Story 已可本機排程 | IG Story 預覽／提醒；FB Story 需先驗證 API |
| 審核佇列／團隊（權限隱藏） | 雛形；不擴成企業審核 | 無 |

重要更正：B 包的「Story 可排程」不是從零開始。現有 Instagram Story 已走本機 scheduler；真正尚未決定的是通知式補完、到期提醒、預覽，以及 Facebook Story 是否能安全支援遠端排程。

## 4. 缺口分級

### 4.1 P0 — 單人日常與安全閥

#### Queue 固定時段（Buffer 招牌）

- 現況：每則手動選日期時間。
- 目標：每個品牌／平台帳號設定固定時段，內容加入 Queue 後自動佔用下一個可用 slot，仍可手動改期或插隊。
- 適配：宮廟／品牌固定節奏（早安、活動預告、晚間回顧）比每次開日曆快。
- 必須先定義：Queue 是每個 `clientId + accountId` 獨立；時區、星期、slot 衝突、手動排程優先權、最大預排距離、Queue 暫停與恢復。
- Facebook 要遵守平台排程窗口；超出窗口時要拒絕、轉成本機提醒，或延後建立遠端排程，不能靜默改時間。
- 不做：跨品牌共用一套時段、自動依演算法改寫時段。

#### Inbox 未讀／手動待回＋Saved replies

- 第一版只做「只看未讀」與「手動標記待回」，不從不完整的 provider conversation 資料推導待回。
- Saved replies 是可管理的本機短句集合，需有品牌範圍、筆數／字數上限、排序、刪除與套用前可編輯。
- 回覆成功只代表平台接受 request；Inbox 仍維持 provider-backed，不保存完整回覆正文。
- 不做：自動回、客服 SLA、Salesforce、WhatsApp 中台。

#### 危機暫停 ShrineFlow 管理的排程

- 一鍵暫停本機到期項目，並逐筆嘗試取消已交給 Facebook 原生佇列的 target。
- 範圍限於 ShrineFlow 能辨識的 target，不宣稱能暫停外部工具建立的所有 MBS 排程。
- 必須：可恢復、留下 audit／lifecycle 事件、顯示遠端取消成功／失敗、處理已進入 `publishing` 的競態。
- 「暫停」與「取消」要分開：遠端已取消的項目，恢復時必須重新建立排程並取得新的 external ID；遠端取消失敗的項目不可顯示為已安全暫停。

### 4.2 P1 — 產能與發布完整度

#### 最佳發布時段

- 用既有 Insights 與本機發布紀錄產生建議，不把業界平均當成個人化結論。
- 沒有足夠資料時顯示「資料不足」，不顯示假精準時間。
- 建議結果至少帶：平台／帳號、時區、資料範圍、指標、樣本數、最後同步時間、演算法版本與信心／資料品質。
- 第一版只提供可點選建議，不自動改寫 Queue。

#### 桌面日曆拖曳改期

- 桌機提供拖曳；手機維持現有改期表單與 ≥44px 觸控區域。
- 改期仍走既有 IANA 時區、夏令時間拒絕與 Facebook 原生 reschedule／補償規則。
- 拖曳不是單純改 DOM 日期，必須等待 API 成功後才更新畫面，失敗時保留原位置並顯示原因。

#### IG 首則留言

- 只規劃 Instagram Professional capability；Facebook／Threads 不宣稱支援。
- 首則留言是發布後的第二個交付，不與主貼文發布合併成單一成功狀態。
- 主貼文成功、留言失敗時，target 應為「已發布／首則留言失敗」，並可單獨重試留言，不能重發主貼文。
- 進入實作前必須驗證 endpoint、權限、App Review、影片／輪播差異與留言重試 idempotency。

#### Story 與 Reel 增強

| 功能 | 目前定位 | 進入實作前提 |
|---|---|---|
| IG Story | 強化預覽、到期提醒、失敗通知 | 沿用本機 scheduler；不重做基本排程 |
| FB Story | 不承諾 Graph 排程 | 先完成 API／權限 spike；否則保留立即發布 |
| Reel 封面圖 | P1 capability | 驗證封面 URL／媒體處理、平台限制與失敗結果 |
| 通知式補完 | 對 API 做不到的格式提供到期通知 | 狀態必須是 `notification_required`，不可標記為已發布 |

#### 遠端 Meta Planner 唯讀對帳

- 目的：看見粉專在 MBS 或其他 Meta 原生入口建立的排程，降低撞檔風險。
- 僅做唯讀合併與來源標示，不先做遠端編輯／刪除。
- 必須驗證 scheduled posts endpoint、可讀格式、權限、分頁、時間範圍、遠端取消狀態與與本機 target 的去重規則。
- 無法可靠讀取時顯示 `remote_schedule_unavailable`，不可把「本機沒有資料」解釋成「遠端沒有排程」。

### 4.3 P2／檔期功能／明確不抄

| 功能 | 誰有 | ShrineFlow 定位 |
|---|---|---|
| 靈感板 Ideas | Buffer | P2；需另建 `contentStage`，不可直接濫用既有 post lifecycle status |
| 已發布再製（帶成效） | Buffer | P2；只依真實 Insights 排名，不猜成效 |
| 大量排程 CSV 或整批影片 | Hootsuite／MBS | 檔期才做；先 dry-run、逐列驗證、逐列修正 |
| 週期／常綠輪播 | Buffer | P2；需遞迴 scheduler、上限、暫停、去重與失敗補償 |
| 廣告投放、Boost、Ads Center | MBS／Hootsuite | 不做 |
| 變現、Subscriptions、Rights Manager | MBS | 不做 |
| 社群聆聽、競品監控 | Hootsuite | 不做 |
| Start Page／link-in-bio | Buffer | 不做 |
| 原生手機 App、瀏覽器擴充 | Buffer | 不做 |
| Canva／Adobe 內嵌 | Hootsuite | 不做；外開編輯後再上傳 |
| WhatsApp／Messenger 客服中台 | MBS | 不做；先把三平台 Inbox 做穩 |
| 10+ 平台 | Buffer／Hootsuite | 不做；三平台可靠性優先 |
| 企業多層審核、SSO | Hootsuite Enterprise | 不做；保留既有審核雛形 |

## 5. 共享依賴與正確工作包

原本的 A／B／C／D 不是彼此獨立的完整工作流，而是共享基礎層上的功能群：

```text
API／權限 Spike
    ↓
狀態與資料模型補強
    ├─ Queue v1
    ├─ Inbox v1（未讀／手動待回／Saved replies）
    └─ 危機暫停 v1（只處理 ShrineFlow 管理的排程）
          ↓
    最佳時段／拖曳改期／IG 首則留言
          ↓
    Story capability／Reel 封面／遠端 Planner 唯讀對帳
          ↓
    Ideas／再製／CSV／Evergreen
```

### 5.1 API／產品 Spike（不可跳過）

1. IG 首則留言：endpoint、權限、帳號類型、媒體類型、重試與 App Review。
2. Meta 遠端排程：能否讀取 MBS／Graph 排程、支援的格式、時間範圍、分頁與遠端 ID。
3. Story：Facebook／Instagram 各自的排程或通知能力，不把兩者合併成一個 capability。
4. Reel 封面：欄位、公開媒體 URL、裁切／比例與 API 錯誤。
5. 帳號 capability matrix：每個帳號明確回報 `supported`、`not_configured`、`permission_required`、`not_available`。

### 5.2 建議實作包

#### Package 0：基礎模型與能力閘門

- 補齊 target 的排程模式、來源、暫停、通知與子交付狀態。
- 建立 capability matrix 與 API spike 測試結果。
- 不新增使用者可見的大型功能頁。

#### Package 1：Queue v1

- 固定時段、排序、插隊、手動覆寫、時區與 provider 排程窗口。
- 先不包含最佳時段與拖曳改期。

#### Package 2：Inbox v1

- 未讀篩選、手動待回、Saved replies。
- 不保存完整訊息正文，不做自動判斷「待回」。

#### Package 3：危機暫停 v1

- 只處理 ShrineFlow 管理的本機／Facebook 原生排程。
- 逐筆回報取消結果、遠端取消失敗與恢復方式。

#### Package 4：發布與日曆增強

- [x] 桌面拖曳改期；改期仍走既有時區、DST 與 Facebook 原生補償流程。
- [x] IG 首則留言與單獨重試；主貼文與留言子交付分開保存，失敗不重發主貼文。
- [x] 最佳時段建議；只使用本機已發布樣本，低於 10 筆回傳 `insufficient_data`，不自動改動 Queue。
- [ ] IG capability 預設仍保持 `not_available`；只有完成 Instagram Professional 帳號／權限驗證後，才以帳號 capability override 顯示操作入口。

#### Package 5：平台能力增強

- [x] IG Story 預覽與本機排程說明；明確標示發布後約 24 小時到期，Facebook Story 仍不可原生排程。
- [x] 平台連線頁顯示 Story 排程、首則留言、Reel 封面與 Meta Planner 唯讀 capability 狀態。
- [x] 遠端 Planner 唯讀 API 邊界；未完成 connector 驗證時固定回 `remote_schedule_unavailable`，不回傳假空資料。
- [ ] Reel 封面與 Meta 遠端排程 connector；仍需完成 endpoint／權限／帳號類型 spike 後才能宣稱支援。

#### Package 6：檔期產能

- [x] Ideas v1：以 `contentStage=idea` 保存，不進排程、不允許直接發布，轉成 `draft` 後才進入既有內容流程。
- [x] 已發布再製 v1：只依已保存的貼文 Insights 排名；沒有真實成效資料就不產生候選，建立的是獨立 `draft` 副本。
- [x] CSV dry-run v1：逐列驗證主題、文案、平台、格式、素材路徑與排程時間，不在預覽階段寫入資料。
- [x] CSV 逐列寫入 draft v1：全數通過後才一次建立，多列失敗不寫入；匯入排程欄位只保存為待處理資訊，不自動排程。
- [x] CSV 匯入排程本機套用 v1：確認後整批套用為 local schedule，任一列失敗或版本衝突就不部分更新；不宣稱已建立 Meta Planner 遠端排程。
- [x] CSV 整批影片媒體綁定 v1：`mediaIds` 只接受目前品牌的 ready asset，`/uploads/...` 必須存在；素材不存在時該列不能匯入。
- [ ] CSV 遠端／Meta 排程 connector、影片 metadata 強驗證與遠端失敗補償。
- [x] Evergreen v1：已發布來源可建立固定間隔的本機再排程，具次數上限、暫停、去重與 lifecycle／版本紀錄；不繞過品牌審核。
- [ ] Evergreen 既有排程取消、遠端 connector 與跨平台 metadata 強驗證。
- 每一項另寫獨立 plan，不再以一個「D 產能包」一次承包。

## 6. 資料／狀態落地約束

### 6.1 排程與 Queue

Queue 設定應以 `clientId + accountId + platformId` 為範圍，至少包含：

```json
{
  "id": "queue-…",
  "clientId": "client-…",
  "accountId": "instagram:…",
  "platformId": "instagram",
  "timeZone": "Asia/Taipei",
  "slots": [{ "weekday": 1, "localTime": "09:00", "enabled": true }],
  "paused": false,
  "updatedAt": "2026-08-15T00:00:00.000Z"
}
```

target 需能區分手動排程與 Queue 排程，並保存 slot／sequence／assignedAt 等必要 metadata。`scheduledAt` 仍是 UTC；所有畫面顯示 IANA 時區與本地時間。

### 6.2 發布與子交付

不要把「主貼文」與「首則留言」混成一個 target 狀態。建議概念上分成：

```text
target.publish:       draft → publishing → published / failed
target.firstComment:  disabled / pending → published / failed
```

主貼文發布成功但首則留言失敗時，內容仍是已發布，並在 target 顯示留言子交付失敗與單獨重試入口。

### 6.3 危機暫停

至少要能表達：

- `active`／`paused`／`cancelled`／`remote_cancel_failed`
- 暫停範圍（品牌／帳號／平台）
- 操作者、原因、開始與恢復時間
- 遠端取消結果與新的 external ID

本機 scheduler 在 claim 前必須檢查 pause state；已進入 `publishing` 的 target 只能進入「停止後續重試／等待結果」語意，不能假設可以回滾平台請求。

### 6.4 Inbox 與資料保存

- Inbox 訊息正文仍不落地；只保存未讀覆寫、手動待回、標籤、備註、cursor 與同步提示。
- Saved replies 使用獨立受限集合，保存品牌範圍、短句、排序與更新時間。
- 所有新集合／repository 都要有原子寫入、備份納入、筆數／bytes 上限與健康檢查可見性。

### 6.5 Insights 最佳時段

最佳時段建議可以是計算結果或受限 cache，不是平台權威狀態。保存：資料範圍、時區、指標、樣本數、資料來源、fetchedAt、演算法版本與資料品質。沒有足夠資料時回傳明確的 `insufficient_data`。

### 6.6 遠端 Planner

外部排程列與本機 post target 分開表示：

- `source = shrineflow_native`：本機已建立、保存 external ID。
- `source = remote_provider`：只讀同步，可能沒有本機 postId。
- 對帳結果：`matched`／`remote_only`／`local_only`／`remote_changed`／`unavailable`。

無法取得遠端資料時，不得清空本機日曆或顯示「無撞檔」。

## 7. 驗收條件

### Queue v1

- 使用者可在品牌／帳號層設定時區與固定 slot。
- 加入 Queue 後能產生下一個合法時間；衝突、DST、Facebook provider window 都有明確錯誤。
- 手動排程可覆寫 Queue；插隊與取消不會重複發布。

### Inbox v1

- 未讀篩選只作用於目前已從 provider 讀到的資料，畫面明示資料範圍。
- 待回由使用者明確標記；送出回覆不會誤刪本機備註與標籤。
- Saved reply 套用後仍可編輯，且不會自動送出。

### 危機暫停 v1

- 暫停後本機 scheduler 不會 claim 新 target。
- Facebook 遠端 target 逐筆顯示取消結果；取消失敗不能顯示為安全暫停。
- 恢復遠端排程會建立新 external ID，並留下 lifecycle／audit event。

### 首則留言與平台增強

- 主貼文與子交付結果分離。
- API／權限不足時顯示 capability 狀態，不顯示成功。
- 所有平台新增功能都有 provider error、retry／manual fallback 與不重複發布測試。

## 8. 風險

1. **API／App Review 風險**：首則留言、Story、遠端 Planner、Reel 封面可能受權限、帳號類型或版本限制。
2. **雙軌排程風險**：Facebook 原生排程與本機 scheduler 可能產生重複、取消失敗或遠端狀態過期。
3. **狀態爆炸**：暫停、通知式補完、首則留言失敗與遠端對帳不能全部塞進單一 `status`。
4. **資料品質風險**：最佳時段若樣本太少，容易製造虛假的精準感。
5. **Inbox 語意風險**：provider-backed 資料不完整時，不能自行推導「待回」。
6. **JSON／repository 一致性風險**：新集合必須同時符合本機檔案限制、備份、復原與既有雲端 repository contract。
7. **檔期功能複雜度**：Evergreen 不是單純重複複製，而是遞迴排程、去重、上限與失敗補償系統。

## 9. 下一個建議建置目標

Package 0～4 已完成可驗證的核心閉環；下一步先做 **Package 5：平台能力增強** 的 API spike，再決定哪些能力能進入正式 UI。

遠端 Planner、Facebook Story 排程、Reel 封面與 Story 強化仍不可直接宣稱支援；必須先有 endpoint、權限、帳號類型與失敗補償的驗證結果。

本輪的完成標準不是「A＋B＋C 做完就對齊三站」，而是：

- 單人排程步驟變少；
- Queue、手動排程與平台原生排程不互相重複；
- 危機時能明確停止並知道哪些項目仍可能在遠端發生；
- 發布成功與附加交付失敗能分開追蹤；
- 沒有 API 資料時，產品誠實顯示未知或不可用。

## 10. 未決問題

1. Queue 的最小排程 horizon 是否跟著平台限制，還是允許先產生本機待建立項目？
2. 危機暫停的預設範圍是目前品牌、目前帳號，還是所有品牌？
3. 「待回」第一版是否只採手動標記，並把 provider 自動推導延後？
4. 哪些 Instagram Professional 帳號已完成首則留言的正式權限與 App Review 驗證？目前資料流已具備，但 capability 預設仍不開啟。
5. Meta Graph API 是否能可靠提供本產品需要的遠端 scheduled posts 列表與狀態？
6. 最佳時段的最低樣本數、指標與資料保留期為何？
7. [已決] Ideas 使用獨立的 `contentStage`，不加入既有 post lifecycle status；後續延伸功能仍各自拆包。
