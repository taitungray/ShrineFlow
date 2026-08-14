# ShrineFlow 響應式網頁 UI／UX 規劃

> 日期：2026-08-14
> 對應產品規格：`2026-08-14-general-social-publishing-roadmap.md`
> 規劃狀態：實作前 UI 基線
> 支援裝置：桌機、平板、手機
> 技術邊界：Express + 靜態 HTML/CSS/JavaScript

## 0. 規劃結論

網站不再沿用「所有功能都放在頂部頁籤」的結構。完整產品會有內容、日曆、素材、模板、活動、發布紀錄、平台與設定等模組，若全部平舖在手機 header，會佔據過多高度並造成操作混亂。

採用以下響應式架構：

| 裝置 | 主導覽 | Composer | Calendar | 主要操作 |
|---|---|---|---|---|
| 桌機 ≥ 1100px | 固定左側欄 | 左編輯、右預覽 | 月／週／列表 | 頂部 action bar |
| 平板 768–1099px | 頂欄＋導覽抽屜 | 單欄，編輯／預覽切換 | 週／列表優先 | sticky action bar |
| 手機 ≤ 767px | 底部 5 項主導覽＋更多 sheet | 全螢幕單欄，編輯／預覽切換 | 行程列表優先 | 底部安全區 sticky actions |

產品對外與規格一律使用「多平台」。只有在平台連線設定、API 憑證或發布 target 的技術語境中使用「帳號」。

## 1. 設計目標

使用者應能快速完成：

```text
找到內容
  → 建立或編輯
  → 看見目前平台結果
  → 確認發布時間與時區
  → 安全排程／發布
  → 清楚知道成功或失敗
```

品質優先順序：

1. 不發錯品牌、平台、內容或時間。
2. 手機可以完成核心工作，不只是被動查看。
3. 編輯內容與預覽不互相脫節。
4. Autosave、上傳、排程與發布狀態始終可見。
5. 畫面穩定，不因切換平台／格式而跳動。
6. 保留 ShrineFlow 暖色、陶金與現代感，但移除宗教限定語意。

## 2. 現有介面問題

### 2.1 導覽擴充性不足

目前五個頂部 tabs 尚可使用，但完整規劃至少有九個模組。繼續增加會導致：

- 手機 header 變成多列。
- 首屏內容空間被壓縮。
- 功能名稱被迫縮短，辨識度下降。
- 設定與日常操作混在同一層級。

### 2.2 建立與編輯被拆開

目前「產生文案」與「編輯預覽」是兩個 view。通用化後，AI 只是 Composer 內的一個動作，使用者不應先完成產文頁，再切到另一頁才能選平台與調整內容。

目標改為單一 Composer：

- 可自行撰寫，也可使用 AI。
- AI 結果直接寫入目前 local draft。
- 共用母稿、平台覆寫、素材與預覽在同一工作區。

### 2.3 手機預覽距離過遠

目前 mobile 將 preview 排在 editor 後面，長表單時需要捲動很遠。新設計使用「編輯／預覽」切換，兩者共享同一 draft state，不重建表單。

### 2.4 排程入口重複

目前 target 表單內有 datetime 欄位，另有 schedule dialog。新設計統一由「排程」動作開啟 summary sheet／dialog，避免兩處時間不同步。

### 2.5 設定頁過長

品牌設定、AI、Facebook、Instagram、Threads 與系統設定會形成很長的頁面。新設計拆成設定分區，但常用連線狀態仍直接展示，不把重要欄位藏進多層折疊。

## 3. 目標網站地圖

```text
總覽
內容
  ├─ 全部內容
  ├─ 新增內容
  └─ 內容編輯器
日曆
素材
模板
活動
發布紀錄
平台
設定

後續：
成效
訊息
```

### 3.1 主功能層級

日常高頻：

- 總覽。
- 內容。
- 新增。
- 日曆。
- 發布紀錄。

管理低頻：

- 素材。
- 模板。
- 活動。
- 平台。
- 設定。

手機底部主導覽只保留五項：

```text
總覽｜內容｜新增｜日曆｜更多
```

「更多」開啟 bottom sheet，顯示素材、模板、活動、發布紀錄、平台與設定。主導覽不使用水平捲動。

## 4. URL 與頁面狀態

維持靜態前端，但使用可回復的 hash route：

```text
#/overview
#/content
#/content/new
#/content/:postId
#/calendar
#/media
#/templates
#/campaigns
#/publishing
#/platforms
#/settings
```

規則：

- F5 後仍回到同一頁。
- 手機返回鍵先關閉 dialog／sheet，再返回上一頁。
- Content 篩選條件同步到 URL query 或 session state。
- Composer 未儲存時返回，必須顯示離開警告。
- 切換品牌後保留目前模組，但清除不適用的 post／filter state。

## 5. 全站 Shell

### 5.1 桌機

```text
┌───────────────┬──────────────────────────────────────────────┐
│ SHRINEFLOW    │ 品牌切換       連線狀態        全域新增內容 │
│ v0.x.x        ├──────────────────────────────────────────────┤
│               │                                              │
│ 總覽          │              目前頁面內容                    │
│ 內容          │                                              │
│ 日曆          │                                              │
│ 素材          │                                              │
│ 模板          │                                              │
│ 活動          │                                              │
│ 發布紀錄      │                                              │
│               │                                              │
│ 平台          │                                              │
│ 設定          │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

規格：

- Sidebar 寬 232px，可縮成 72px icon rail，但第一版可先固定完整寬度。
- Topbar 高 64px，顯示品牌、頁面標題、連線摘要與主要 CTA。
- 主內容最大寬度 1440px；Content／Calendar 可用滿寬，文字表單限制閱讀寬度。
- Sidebar 與 Topbar sticky，主內容獨立捲動。

### 5.2 平板

```text
┌──────────────────────────────────────────────┐
│ ☰  SHRINEFLOW  品牌              ＋新增     │
├──────────────────────────────────────────────┤
│                                              │
│                 目前頁面                     │
│                                              │
└──────────────────────────────────────────────┘
```

- Sidebar 改為 modal navigation drawer。
- Drawer 使用 `<dialog>`，開啟後 focus trap，關閉後焦點回選單按鈕。
- 頂欄保留品牌摘要，不把完整 select 與狀態全部擠在同一列。

### 5.3 手機

```text
┌──────────────────────────────┐
│ SHRINEFLOW    品牌名稱   ⋯  │
├──────────────────────────────┤
│                              │
│          目前頁面            │
│                              │
├──────────────────────────────┤
│ 總覽  內容   ＋   日曆  更多 │
└──────────────────────────────┘
```

- Topbar 使用一列，最小高度 52px，加 `safe-area-inset-top`。
- 品牌切換由點擊品牌名稱開啟 sheet，不常駐大型 select。
- Bottom nav 固定於安全區上方，高度 56～64px。
- 中央「新增」為主要動作，但不遮擋內容。
- 內容底部 padding 必須大於 bottom nav＋safe area。

## 6. 總覽頁

總覽只放可行動資訊：

```text
今天
  待發布 3    發布失敗 1    帳號異常 0

下一篇
  10:30 Instagram｜新品預告
  [查看] [改時間]

需要處理
  Facebook 發布失敗：權限已過期
  [查看錯誤] [前往平台設定]

最近內容
  ...
```

- 桌機：摘要卡 3～4 欄＋兩欄內容區。
- 平板：摘要卡 2 欄。
- 手機：摘要卡 2 欄，列表單欄。

不得使用沒有後續動作的裝飾 KPI。

## 7. Content 列表

### 7.1 桌機

```text
內容                                      ＋新增內容
搜尋內容…      [狀態] [平台] [活動] [日期]
────────────────────────────────────────────────────
□ 縮圖  標題／摘要       平台狀態    排程       更新
□ 圖片  秋季新品上市     FB ✓ IG !   8/20 10:00 今天
□ 圖片  週末活動公告     Threads ○   —          昨天
```

- 使用 table-like list，不做過多獨立卡片。
- 第一欄顯示縮圖、internal title 與第一行摘要。
- 平台欄顯示每平台小狀態，不只顯示 overall status。
- Row 點擊進入 Composer；更多動作為複製、封存、刪除。
- 批次操作第一版只做封存與複製，不做高風險批次發布。

### 7.2 手機

```text
內容                         ＋
[搜尋內容…]
[全部] [草稿] [排程] [失敗]

┌────────────────────────────┐
│ [圖] 秋季新品上市           │
│ FB 已發布・IG 失敗          │
│ 8/20 10:00        ⋯         │
└────────────────────────────┘
```

- 每篇內容一張 compact card。
- 常用狀態 chips 平舖換行，不做水平滑動。
- 進階篩選放 bottom sheet，開啟按鈕顯示已套用數量。
- 每次載入 20 筆，向下載入更多或明確分頁。
- 卡片最右操作按鈕需 44×44px。

### 7.3 狀態與空畫面

- Loading：骨架列表，不用全頁 spinner。
- Empty：說明尚無內容＋「新增第一篇內容」。
- Filter empty：顯示清除篩選，不誤導為資料消失。
- Error：保留既有畫面並提供重試。

## 8. Composer

Composer 是全產品最高優先畫面。

### 8.1 桌機布局

```text
┌──────────────────────────────────────────────────────────────┐
│ ←內容  內部標題      已儲存 11:20    [儲存] [排程] [發布] │
├────────────────────────────────┬─────────────────────────────┤
│ 編輯區 58%                     │ 預覽區 42%                  │
│                                │ [Facebook][IG][Threads]     │
│ ① 主題與目標                   │ 平台／連線狀態              │
│ ② 母稿                         │                             │
│ ③ 素材                         │ 媒體預覽                    │
│ ④ 多平台發布                   │ 文案預覽                    │
│ ⑤ 平台覆寫                     │                             │
│                                │ 驗證／警告                  │
└────────────────────────────────┴─────────────────────────────┘
```

- Composer header sticky，顯示返回、internal title、save status 與主要動作。
- Editor 與 Preview 各自保持穩定最小高度。
- Preview sticky 於 viewport，但不能超出主內容高度。
- 右側預覽永遠讀 local draft，不等待 server response。
- 平台 tabs 顯示狀態點：沿用母稿、已覆寫、警告、失敗。

### 8.2 編輯分組

#### ① 主題與目標

- 品牌。
- 內容主題。
- 內容目的。
- 受眾。
- 語氣。
- CTA。
- 補充限制。

常用欄位直接展開。受眾、語氣等可使用品牌預設，但要能覆寫。

#### ② 母稿

- 長文案。
- 短文案。
- Hashtag。
- AI 產生／改寫動作。
- 字數與警告。

AI 動作是次要工具，不取代儲存或發布按鈕。

#### ③ 素材

- 拖曳上傳、檔案選擇、素材庫選擇。
- 上傳進度、ready、failed。
- 順序調整、刪除、替換、alt text。
- 手機不要求拖曳；提供上移／下移。

#### ④ 多平台發布

- 平台多選。
- 每個平台顯示連線、格式、排程與驗證摘要。
- 對外標籤統一寫「發布平台」。

#### ⑤ 平台覆寫

- 預設沿用母稿。
- 點「自訂此平台」才顯示 override 欄位。
- 顯示「已覆寫」標記。
- 提供「還原母稿」。
- 切平台不得複製整份長表單造成高度劇烈改變。

### 8.3 平台內容策略提示

Composer 應把平台差異轉成就地寫作提示，協助使用者判斷是否需要建立平台覆寫。提示屬於內容策略建議，不是阻止發布的硬性驗證。

| 平台 | 核心屬性 | 建議排版策略 |
|---|---|---|
| Facebook（FB） | 長文、資訊型、中年族群 | 適合詳細活動資訊、長篇觀點或產業新聞；段落與重點資訊要清楚。 |
| Instagram（IG） | 視覺導向、精美圖片／短影音 | 圖片必須精緻，文字精簡，優先使用輪播圖呈現多個重點。 |
| Threads | 文字導向、日常型內容、即時互動 | 以 500 字內的金句或問題探討為主，語氣自然、像真人交流。 |

介面使用 `PlatformStrategyCard` 呈現：

- 選取單一平台時，顯示該平台的「內容定位、文案建議、素材建議」。
- 同時選取多平台時，先顯示差異摘要，再引導使用者決定哪些平台需要覆寫。
- Facebook 顯示長文結構、活動資訊完整度與分段提示。
- Instagram 顯示圖片／短影音優先、文案精簡及輪播圖提示；素材不足時才升級為 validation warning。
- Threads 顯示即時互動、自然語氣與建議字數；「500 字內」是編輯策略目標，不視為平台 API 上限。
- 提示卡不得自動改寫或覆蓋母稿；使用者主動點「套用建議」後，才產生可預覽、可復原的平台版本。
- 策略內容由靜態設定或本機 JSON 提供，不寫死在畫面 DOM，方便未來新增平台。

裝置呈現：

- 桌機：放在平台選擇器下方、平台覆寫欄位上方，與右側預覽同步更新。
- 平板：維持單欄，就地顯示完整提示卡，不另開對話框。
- 手機：平台 pills 換行顯示；提示卡緊接平台選擇器，預設顯示三行摘要，展開按鈕觸控區至少 44px。
- 切換平台只更新提示與預覽，不重建 editor，也不改變已輸入內容。

### 8.4 手機 Composer

```text
┌──────────────────────────────┐
│ ← 內容標題       已儲存  ⋯  │
│ [編輯] [預覽]                │
├──────────────────────────────┤
│                              │
│ 編輯模式：                   │
│ 主題與目標                   │
│ 母稿                         │
│ 素材                         │
│ 多平台發布                   │
│                              │
├──────────────────────────────┤
│ [儲存] [排程] [發布]         │
└──────────────────────────────┘
```

預覽模式：

```text
┌──────────────────────────────┐
│ ← 內容標題       已儲存  ⋯  │
│ [編輯] [預覽]                │
├──────────────────────────────┤
│ [FB] [IG] [Threads]          │
│ 平台狀態／警告               │
│ 媒體預覽                     │
│ 文案預覽                     │
│ Hashtag                      │
├──────────────────────────────┤
│ [儲存] [排程] [發布]         │
└──────────────────────────────┘
```

手機規則：

- 編輯／預覽使用 2 項 segmented control。
- 切換只改顯示，不銷毀 DOM 或 local draft。
- Sticky action bar 使用 `safe-area-inset-bottom`。
- 鍵盤開啟時 action bar 不遮住目前欄位；必要時暫時收合次要動作。
- Input／textarea 字級至少 16px，避免 iOS 自動縮放。
- 長 textarea 可自動增高至上限，再使用欄位內捲動。
- 發布按鈕與排程按鈕不可只靠圖示。

### 8.5 Autosave 顯示

狀態固定出現在 Composer header：

```text
尚未儲存
儲存中…
已儲存 11:20
儲存失敗・重試
離線・保留在此裝置
```

不能只用 Toast，因 Toast 消失後使用者仍需要知道目前狀態。

## 9. Schedule／Publish 互動

### 9.1 桌機 Schedule dialog

```text
排程發布
────────────────────────
日期        時間
Timezone：Asia/Taipei

發布平台
Facebook  8/20 10:00
Instagram 8/20 10:00
Threads   8/20 10:00

警告／限制

[取消]                 [確認排程]
```

### 9.2 手機 Schedule sheet

- 由底部升起，可擴展為接近全螢幕。
- 日期、時間、時區皆為 48px 以上觸控高度。
- 平台 summary 直接展開，不使用巢狀 dropdown。
- 鍵盤與原生日期選擇器關閉後仍保留 sheet 狀態。
- 最底部固定「確認排程」。

### 9.3 Publish Now confirm

必須顯示：

- 品牌。
- 內容標題。
- 發布平台。
- 各平台格式。
- 素材數量。
- 目前保存版本。
- 「立即發布」明確警告。

確認後按鈕進入 loading 並禁止重複提交。成功／部分成功／失敗顯示 target 級結果。

## 10. Calendar

### 10.1 桌機

- 預設月檢視。
- 可切週與列表。
- 左側或頂部提供品牌、平台、狀態、活動篩選。
- 月格 item 顯示時間、縮圖／標題、平台與狀態。
- 點 item 開啟 quick view，再進入 Composer。
- Drag reschedule 後顯示明確確認；API 失敗 rollback。

### 10.2 平板

- 預設週檢視或列表。
- 月檢視降低每格資訊密度。
- 篩選使用 drawer／sheet。

### 10.3 手機

手機預設不是完整月格，而是 agenda list：

```text
八月 2026        [今天] [篩選]
[17][18][19][20][21][22][23]

8/20 週四
10:00 Instagram  新品預告  已排程
14:30 Facebook   活動公告  已排程

8/21 週五
09:00 Threads    幕後故事  草稿
```

- 上方日期帶完全平舖於可用寬度；不做無提示的橫向滑動。
- 點選日期更新 agenda。
- 改期使用 sheet，不在手機依賴拖曳。
- 列表 item 觸控高度至少 56px。
- 顯示 timezone。

## 11. Media Library

- 桌機：4～6 欄素材 grid＋左側篩選。
- 平板：3 欄。
- 手機：2 欄，篩選放 sheet。

每個素材至少顯示：

- 圖片／影片縮圖。
- 類型與尺寸／長度。
- 上傳狀態。
- 使用數量。
- 更多操作。

手機上傳入口固定在頁首，不使用只能拖曳的操作。影片播放預設 muted，避免列表自動播放。

## 12. Templates、Campaigns 與 Publishing Logs

### Templates

- 桌機卡片 grid，手機單欄卡片。
- 顯示模板用途、適用平台與最後更新。
- 套用模板前顯示將填入哪些欄位，不直接覆蓋目前內容。

### Campaigns

- 顯示活動名稱、日期範圍、內容數量與發布進度。
- 手機點入後以列表顯示內容，不塞入複雜甘特圖。

### Publishing Logs

- 預設先顯示失敗與進行中。
- 每筆顯示平台、內容、時間、attempt、結果與下一步。
- 錯誤訊息需翻譯成人可理解的原因，技術 code 放在「詳細資料」。
- 手機每個 target 使用 compact result card。
- 失敗 target 的「重試」必須明顯，但防止連續點擊。

## 13. Platforms 與 Settings

### Platforms

產品頁名稱使用「平台」。每張平台卡顯示：

- Facebook／Instagram／Threads。
- 已連線／未連線／權限異常。
- 連線識別名稱。
- 最後驗證時間。
- 支援格式。
- 測試連線、重新設定、停用。

### Settings

分區：

```text
品牌設定
AI 設定
平台共用設定
儲存與備份
介面偏好
系統資訊
```

桌機使用左側 section nav；手機使用可換行 section pills 或頁內目錄。重要欄位直接展開，危險操作放獨立區並二次確認。

## 14. 響應式斷點

```css
/* Wide desktop */
@media (min-width: 1440px) { }

/* Desktop shell */
@media (min-width: 1100px) { }

/* Tablet / compact desktop */
@media (min-width: 768px) and (max-width: 1099px) { }

/* Mobile */
@media (max-width: 767px) { }

/* Small mobile */
@media (max-width: 479px) { }

/* Very narrow fallback */
@media (max-width: 359px) { }
```

不依賴特定裝置名稱；斷點以內容是否能安全呈現為準。

### 14.1 版面 token

```css
--app-max-width: 1440px;
--sidebar-width: 232px;
--topbar-height: 64px;
--mobile-topbar-height: 52px;
--mobile-nav-height: 60px;
--content-gutter-desktop: 24px;
--content-gutter-mobile: 12px;
--touch-target: 44px;
```

## 15. 共用元件

第一批元件：

- AppShell。
- SideNav／NavDrawer／BottomNav。
- BrandSwitcher。
- PageHeader。
- StatusBadge。
- PlatformBadge。
- FilterBar／FilterSheet。
- EmptyState。
- ErrorState。
- ContentList／ContentCard。
- ComposerHeader。
- SaveStatus。
- PlatformSelector。
- PlatformStrategyCard。
- OverrideIndicator。
- MediaPicker／MediaItem。
- PreviewPanel。
- ValidationSummary。
- ScheduleDialog／ScheduleSheet。
- PublishConfirm。
- Toast。

所有欄位遵守 `.field + label + input` 結構；2～4 個選項使用 radio pills。

## 16. 狀態視覺

狀態不能只靠顏色：

| 狀態 | 色彩 | 圖示／文字 |
|---|---|---|
| Draft | 中性灰 | 草稿 |
| Ready | 藍灰 | 可發布 |
| Scheduled | 金色 | 已排程 |
| Publishing | 藍色＋spinner | 發布中 |
| Published | 綠色 | 已發布 |
| Partial success | 橘色 | 部分成功 |
| Failed | 紅色 | 發布失敗 |
| Cancelled | 灰紅 | 已取消 |
| Archived | 深灰 | 已封存 |

Failed 與 Partial success 在總覽、列表、Calendar、Composer 與 Logs 使用一致語意。

## 17. Loading、錯誤與離線

- 首次頁面 loading 使用 skeleton。
- 按鈕操作使用局部 spinner，不鎖住整頁。
- 載入列表失敗保留舊資料並顯示重試。
- Autosave 失敗不清空 local draft。
- 上傳失敗保留 media item 與重試按鈕。
- 發布 timeout 顯示「結果待確認」，不得直接當作安全重試。
- 手機網路切換時顯示 compact offline banner。
- Toast 用於短暫完成提示；持續性問題用 inline banner／status。

## 18. 無障礙與鍵盤

- 所有主要元素使用語意化 header、nav、main、section、article、dialog。
- 目前頁面使用 `aria-current=page`。
- Dialog／sheet 有 focus trap、Escape、關閉按鈕與焦點回復。
- Platform／status 不只用顏色。
- Focus ring 清楚可見。
- 表單錯誤使用 `aria-describedby` 與 `aria-live`。
- 按鈕與 tabs 最小 44×44px。
- Touch action 之間保留至少 8px 間距。
- 支援 `prefers-reduced-motion`。
- Text contrast 達 WCAG AA。
- 手機 input 字級至少 16px。

## 19. 手機專項規則

### 必須做到

- 可完整建立、編輯、排程、立即發布與重試。
- Bottom nav 不遮內容。
- Sticky actions 適配 safe area。
- 鍵盤不遮目前輸入欄位。
- 日期／時間選擇後清楚顯示 timezone。
- 不依賴 hover、drag 或右鍵。
- 所有平台 tabs／filter chips 可換行，不出現水平捲軸。
- 圖片與影片不超出 viewport。
- Dialog 在窄螢幕轉為 sheet／full-screen dialog。
- 長錯誤訊息可換行，不撐破卡片。

### 不採用

- 桌機雙欄硬縮到手機。
- 9 個以上頂部 tabs。
- 只能拖曳排序。
- 小於 44px 的 icon-only 高風險按鈕。
- 隱藏時區。
- 把發布確認縮成「確定嗎？」。
- 使用 `overflow-x:auto` 解決主導覽或平台 tabs。

## 20. 效能規劃

- 路由模組按需要初始化，避免每頁同時 render。
- 圖片 lazy loading。
- 影片列表只載 metadata，不自動播放。
- Content 與 Logs 分頁／範圍查詢。
- Calendar 只取目前可見 range。
- Preview 對文字輸入使用 requestAnimationFrame 或輕量 debounce。
- 避免每次 input 重建整個 media／platform DOM。
- 保留 local filter state，返回列表不重新載入全部資料。

## 21. 實作順序

### UI-0：Shell 與路由

- AppShell。
- Desktop sidebar。
- Tablet drawer。
- Mobile bottom nav。
- Hash routes 與返回行為。
- Brand switcher。
- Responsive tokens 與 safe area。

### UI-1：Content

- Content list。
- Desktop row／mobile card。
- Search、status chips、filter sheet。
- Empty／loading／error。

### UI-2：Composer

- 單頁 Composer。
- Editor／Preview。
- Mobile toggle。
- Sticky action bar。
- Autosave status。
- Platform override indicator。
- Platform strategy guidance。
- Validation summary。

### UI-3：Schedule 與 Calendar

- Desktop dialog／mobile sheet。
- Month／week／agenda。
- Mobile agenda。
- Timezone 與改期 feedback。

### UI-4：Media、Logs、Platforms、Settings

- Media grid。
- Publish result cards。
- Platform connection cards。
- Settings sections。

### UI-5：Templates、Campaigns、Insights、Inbox

依產品 roadmap 後續實作。

## 22. 驗收矩陣

### Desktop 1440×900

- Sidebar 與 Topbar 不遮內容。
- Composer 左右雙欄穩定。
- 切換平台時，策略提示與預覽同步更新且不覆蓋母稿。
- Preview sticky 不超出畫面。
- Content／Calendar 可使用寬版空間。
- 主要動作不需要捲到頁底。

### Tablet 768×1024

- 導覽由 drawer 使用。
- Composer 單欄且可切預覽。
- 表單不產生水平 overflow。
- Calendar 週／列表可操作。
- Dialog 不超出 viewport。

### Mobile 390×844

- Bottom nav 五項完整可點。
- 可建立、編輯、上傳、排程與發布。
- Sticky action bar 適配安全區。
- Input 不觸發頁面縮放。
- 平台與狀態 chips 可換行。
- 平台策略提示位於選擇器後方，展開後不被底部 action bar 遮住。
- Preview 不需要捲過整份 editor 才能看。

### Small Mobile 360×640

- Header、bottom nav 與 actions 不互相覆蓋。
- 長品牌名稱與錯誤文字會截斷／換行。
- 兩欄 media grid 不溢出。
- Schedule sheet 可捲動且確認按鈕可見。

### 橫向手機

- 使用可用高度縮短 header。
- Sheet／dialog 可捲動。
- 不強制回到桌機雙欄。

## 23. P0／P1／P2 優先級

### P0

- 發錯品牌／平台／時間的風險。
- Publish double-submit。
- Autosave 覆蓋新內容。
- 手機 action bar 遮住欄位。
- 時區不明。
- 上傳未完成仍可發布。
- Native／Local 狀態混淆。

### P1

- Content 搜尋與篩選。
- Composer 編輯／預覽切換。
- 平台內容策略提示與覆寫引導。
- 手機 Calendar agenda。
- target 級發布結果與重試。
- 導覽在各裝置一致。

### P2

- 模板、Campaign 視覺。
- 進階 media metadata。
- 動畫與視覺 polish。
- Insights 圖表。

## 24. 實作前最終 Gate

進入前端實作前必須確認：

- [ ] v0.4.0 通用資料欄位名稱已定案。
- [ ] 對外用語統一為多平台。
- [ ] Post 與 target 狀態定案。
- [ ] Autosave API version contract 定案。
- [ ] Platform capability API 格式定案。
- [ ] Schedule payload 與 timezone contract 定案。
- [ ] 桌機 sidebar、平板 drawer、手機 bottom nav 確認。
- [ ] Composer editor／preview 資訊分組確認。
- [ ] Mobile schedule sheet 與 publish confirm 確認。
- [ ] 1440、768、390、360 四組 viewport 驗收案例建立。

完成上述 Gate 後，才開始 UI-0 與 v0.4.0 的實作。

## 25. 決策紀錄

| 決策 | 結果 |
|---|---|
| 主導覽 | 桌機 sidebar、平板 drawer、手機 bottom nav |
| 手機主導覽 | 總覽、內容、新增、日曆、更多 |
| Composer | 建立、AI、編輯、多平台、排程整合為一頁 |
| 手機 Composer | 編輯／預覽切換，不保留左右雙欄 |
| Calendar mobile | Agenda 優先，不硬塞桌機月格 |
| 排程入口 | 統一由 Schedule dialog／sheet 處理 |
| 平台用語 | 對外使用多平台；連線細節才使用帳號 |
| 觸控 | 所有主要操作至少 44×44px |
| 橫向捲動 | 主導覽、平台 tabs、主要 filters 禁止水平捲動 |
| UI 架構 | 維持原生 HTML/CSS/JavaScript，不導入前端框架 |
