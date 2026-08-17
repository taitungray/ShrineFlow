# ShrineFlow 跨裝置合併切換清單

日期：2026-08-17  
相關：`docs/superpowers/specs/2026-08-14-cloud-deployment-runbook.md`、`lib/firestore-migration.js`、`lib/media-migration.js`

## 已完成的工具面

- [x] newest-wins／零刪除／fingerprint 保護的 merge core
- [x] 媒體 plan/apply 與憑證重加密
- [x] `test/firestore-migration.test.js`、`test/media-migration.test.js`（18/18）
- [x] 本機備份：`data/backups/pre-merge-local-*`
- [x] 本機對空雲端 merge plan：`data/backups/merge-plan-remote-empty-*`

## 本機 dry-run 結果（2026-08-17）

- 備份：`data/backups/pre-merge-local-20260817-193117`
- 媒體 plan：`data/backups/media-plan-local-20260817-193300.json`（0 files，0 conflicts）
- Merge plan（`--remote-empty`）：`data/backups/merge-plan-remote-empty-20260817-193300.json`
- Summary：create=2658、update=3、conflict=0、blockingConflicts=0
- 已清除失效媒體路徑：`post-fallback-failure` 原指向不存在的 `/uploads/fallback-failure.jpg`

> 注意：`--remote-empty` 只驗證本機→空雲端路徑。正式套用前必須對真實 Firestore 再跑一次不帶 `--remote-empty` 的 plan。

## 正式套用前（需 GCP／R2 憑證）

1. 凍結本機與 Cloud Run 編輯。
2. 觸發一次 Firestore→R2 backup。
3. 設定：

```powershell
$env:SHRINEFLOW_STORAGE_BACKEND='firestore'
$env:FIRESTORE_PROJECT_ID='YOUR_PROJECT_ID'
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\secure\shrineflow-migration.json'
$env:SHRINEFLOW_SOURCE_MASTER_KEY='(本機)'
$env:SHRINEFLOW_TARGET_MASTER_KEY='(Cloud Run SHRINEFLOW_MASTER_KEY)'
# R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_PUBLIC_BASE_URL
```

4. `npm run migrate:media:plan` → 檢查 conflicts = 0  
5. `npm run migrate:firestore:plan -- --media-mapping <media-plan.json>` → blockingConflicts = 0  
6. Apply：媒體 → 資料  
7. 再 plan 一次，應近似全 `keep`

## 切換與驗收

- PC、手機都只開同一個 Cloud Run URL（不要再混用 `localhost`）。
- 同一 Google 帳號驗：品牌、草稿、排程／發布日誌、媒體預覽、平台連線、成員。
- Cloud Run 重啟後資料仍在。
- 建一筆測試草稿＋未來排程，另一裝置立刻看得到；測完刪除／取消，不做正式發布。

## 回滾

- 保留 `data/backups/pre-merge-local-*`。
- Firestore 回復用遷移前 R2 backup manifest。
- R2 新增物件依 media plan `objectKey` 清理。
- Cloud Run revision 回滾不能回復資料。
