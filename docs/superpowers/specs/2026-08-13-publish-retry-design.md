# 發布失敗重發 — 設計規格（精簡）

日期：2026-08-13  
狀態：核准實作（方案 A）  
決策：自動僅暫時性錯；手動「重發」呼叫立刻發布

## 行為

1. **自動**：scheduler 對 `retriable`（逾時／429／5xx／is_transient）→ `retrying`，最多既有次數；否則 → `failed`
2. **手動**：排程列表 `failed`／`retrying` 顯示「重發」→ `POST /api/publish/target`
3. 成功 → `published`；失敗 → 維持／寫回 `failed`＋`lastError`（toast 顯示原因）
4. FB 已交原生佇列（`scheduled`＋`externalId`）不顯示「重發立刻發」
