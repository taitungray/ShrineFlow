# ShrineFlow 本機／單一操作員部署前置手冊

## 目的

這份手冊對應目前的 Express + JSON + `uploads/` 模式，不引入資料庫，也不把目前的單一操作員模式誤標成多人正式後台。部署前可在設定頁執行「部署檢查」，或讀取 `GET /api/system/readiness`。

## 必要條件

1. 以 Node.js 18 以上執行 `npm install` 與 `npm test`。
2. 服務綁定 `0.0.0.0`，由外部反向代理負責 HTTPS；不要直接把 3000 port 暴露到公網。
3. 正式環境設定 `NODE_ENV=production`。
4. 設定高強度 `SHRINEFLOW_MASTER_KEY`，不得提交 Git，也不得回傳瀏覽器。
5. 設定 `SHRINEFLOW_OPERATOR_PASSWORD` 與 `SHRINEFLOW_SESSION_SECRET`，啟用單一操作員登入；session 不寫入資料庫。
6. 若要發布 Instagram／Threads 媒體，設定可由平台讀取的 `PUBLIC_MEDIA_BASE_URL=https://...`。
7. 確認 `data/`、`uploads/`、`data/backups/` 可寫入，並確認備份目錄位於可持久化磁碟。

## 上線前演練

1. 啟動服務後讀取 `/api/system/health`，確認 JSON 檔案都是 `ok`、排程器運作中。
2. 在設定頁建立一份不含素材的備份，確認備份出現在清單。
3. 用測試資料演練還原；還原前會自動建立 safety backup。
4. 檢查 `/api/system/readiness`：`blocked` 不可上線；`warning` 必須逐項確認。
5. 檢查 `data/error-log.json`、發布事件與 Insights 歷史是否依保留策略運作；不可直接把這些 JSON 暴露成靜態檔案。

## 安全邊界

目前尚未加入登入／權限控管，因此 readiness 不是授權機制。要放到公網前，仍必須完成登入、反向代理 HTTPS、CORS／網路邊界與平台 App Review／Business Verification；在此之前只建議區域網或 VPN 內單一操作員使用。

## 無限膨脹防護

- JSON 每檔有跨程序鎖、原子替換與單一 `.bak` 復原快照。
- 備份最多 30 份／180 天；發布事件與 Insights 歷史按月份、有月份筆數上限。
- `uploads/` 最多 1,000 檔／5GB，孤兒素材超過 7 天才會自動清理。
- provider 等待佇列最多 20 筆；錯誤記錄最多 500 筆、保留 30 天；失敗通知最多 200 筆。
