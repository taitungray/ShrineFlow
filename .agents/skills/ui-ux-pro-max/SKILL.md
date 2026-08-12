---
name: ui-ux-pro-max
description: ShrineFlow 頂級 UI/UX 設計系統與前端互動規範 (Pro-Max Design System & Frontend Design)
---

# UI-UX-Pro-Max 設計系統與 Frontend Design 前端規範

本 Skill 定義 ShrineFlow 專案之最高品質 UI/UX 設計系統與 Frontend Design 前端規範。所有前端介面開發與調整均須嚴格遵循本系統。

---

## 🎨 1. Frontend Design 設計美學 (Design Aesthetics)

- **現代極簡與高階質感**：打造令使用者一眼驚艷 (WOW factor) 的現代 Web 介面。拒絕過時、粗糙或陽春的預設樣式。
- **色彩系統 (Color Palette)**：
  - 結合傳統宮廟神像工藝之雅致金箔與現代暗色調模式（Ceramic Gold & Warm Dark Mode）。
  - `var(--brand)`: `#c25e40` (赤硃/金赤主色)
  - `var(--accent)`: `#d99a4e` (金箔黃金點綴色)
  - `var(--bg-app)`: `#f7f1eb` / 深色 `#141211` (玄武岩沉穩底色)
  - `var(--bg-card)`: `#ffffff` / 深色 `#1c1816` (高質感卡片容器)
- **文字高對比層級**：
  - Primary Text: `#1e1917` / 深色 `#f5ece6` (標題、主要 Input 輸入值)
  - Secondary Text: `#5c504a` / 深色 `#c4b4ab` (欄位 Label、次要內容)
  - Tertiary Text: `#8c7b73` / 深色 `#8f7f77` (Placeholder、補充標籤)
- **動態微互動 (Micro-Animations & Dynamic Feedback)**：
  - Hover / Focus / Active 具備滑順過渡 (`transition: 0.18s cubic-bezier(0.4, 0, 0.2, 1)`).
  - 載入狀態採用質感旋轉指示器 (`.spinner`) 與 Toast 即態通知。

---

## 📐 2. 字型與語意化結構 (Typography & Semantic HTML)

- **字體層級搭配**：
  - 主副標題: `"Noto Serif TC", serif` (展現東方神像藝術之莊嚴優雅)
  - UI 內文與欄位: `"Noto Sans TC", sans-serif` (極致清晰易讀)
  - 英文 Tag、版號與數字: `"Outfit", sans-serif` (現代幾何質感)
- **語意化 HTML5 結構**：
  - 使用 `<header>`, `<main>`, `<nav>`, `<section>`, `<article>`, `<dialog>` 打造語意清晰、對 SEO 與輔助工具親和的 DOM 結構。
  - 所有互動元素（輸入框、按鈕、分頁）必須具備唯一的 ID 與語意化 `aria-label`。

---

## 🧱 3. 元件結構與防重疊規範 (Component Rules & Anti-Jitter)

### A. 標準表單欄位結構 (Standard Field Structure)
嚴禁以 `<label>` 直接包裹整組 `<div>` 與輸入框。必須採用獨立 Div 容器：
```html
<div class="field">
  <label for="fieldName" class="field-label-group">
    <span class="field-label">欄位名稱 <span class="field-required">*</span></span>
  </label>
  <input id="fieldName" name="fieldName" type="text" placeholder="提示…" required />
</div>
```

### B. 少項選項改用分段按鈕卡 (Segmented Radio Pills > Dropdowns)
當選項僅有 2~4 個時（例如貼文類型：作品介紹 / 聖誕祝壽），**嚴禁使用下拉選單 `<select>`**。必須一律採用按鈕切換卡：
```html
<div class="radio-pill-group">
  <label class="radio-pill">
    <input type="radio" name="postType" value="work" checked />
    <span>🎨 作品介紹</span>
  </label>
  <label class="radio-pill">
    <input type="radio" name="postType" value="birthday" />
    <span>🎂 聖誕祝壽</span>
  </label>
</div>
```

### C. 主題卡片分組 (Logical Grouping Cards)
相關欄位必須透過分組卡片 (`<fieldset class="form-group-card">`) 隔離，並搭配主題標題 (`<legend class="group-title">`)：
- **`🚀 1. 發布平台與格式`**
- **`📸 2. 素材與文案設定`**

### D. 高度鎖定與防跳動 (Height Stability)
- 面板區塊 (`.panel`) 設定 `min-height: 540px`。
- 動態格式說明區 (`.content-settings`) 設定 `min-height: 42px`。
- 絕不允許切換選項或分頁時發生畫面忽大忽小、底部按鈕彈跳的問題。

---

## 📱 4. 行動端與觸控親和 (Mobile Responsive & Touch Usability)

- 所有按鈕、頁籤與輸入框觸控區域最小 `≥ 44×44px`。
- 所有分頁與平台切換按鈕強制全展開平舖 (`flex-wrap: wrap`)，禁止出現水平滑動條 (`overflow-x: auto`)。
