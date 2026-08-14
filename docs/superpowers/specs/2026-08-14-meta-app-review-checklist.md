# Meta App Review／Business Verification Checklist

> 文件狀態：準備清單，尚未代表外部審查完成。只有 Meta 審查結果、Business Verification 與正式 HTTPS 網址都取得後，才能在 `PROJECT_STATUS.md` 將該項目改為完成。

## 1. 產品範圍與最小權限

- [ ] 建立產品功能矩陣：Facebook、Instagram、Threads 各自列出「已實作」「需要平台權限」「目前不可用」三欄。
- [ ] 依 Meta App Dashboard 當期文件確認最小必要權限；不把程式中出現的 endpoint 自動等同於已獲准權限。
- [ ] Facebook：準備文字／圖片／影片／Reel、原生排程、Insights、Inbox／回覆與 Webhook 的實測結果。
- [ ] Instagram：準備 feed／Reel／Story／carousel、Insights、Inbox／回覆的實測結果，並註明需要公開媒體網址。
- [ ] Threads：準備文字／圖片／影片、Insights、回覆的實測結果，註明平台能力與權限限制。
- [ ] 每個功能都準備「成功、權限不足、Token 過期、平台暫時失敗」畫面，不以模擬成功取代 provider 回應。

## 2. App Dashboard 與正式網址

- [ ] App 名稱、用途、聯絡信箱與產品描述完成。
- [ ] Privacy Policy、Terms of Service、Data Deletion／使用者資料刪除說明放在正式 HTTPS 網址。
- [ ] Meta App Secret、Webhook verify token、平台 Token 只放伺服器環境機密；不放截圖、不放錄影、不提交 Git。
- [ ] Webhook verify endpoint 可從公網以 HTTPS 存取，POST 事件具備 HMAC 驗證；事件正文不落地。
- [ ] 正式媒體網址使用 HTTPS，圖片／影片可被平台在發布期間讀取。

## 3. Review 證據包

- [ ] 以測試品牌／測試 Page／測試平台連線完成一段可重現錄影：登入 → 選品牌 → 選多平台 → 預覽 → 儲存 → 排程／立即發布 → 查看 per-platform 狀態。
- [ ] 錄影展示 partial failure、retry、取消排程、Token 健康狀態與平台格式驗證。
- [ ] 錄影展示 Inbox 不保存訊息全文、Webhook 只產生同步提示、錯誤／節流資料有保留上限。
- [ ] 所有畫面遮罩 Page ID 以外的敏感識別、Email、Token、App Secret 與真實使用者訊息。
- [ ] 準備測試帳號、測試品牌與測試資料清除步驟；不要用真實客戶資料作審查素材。

## 4. Business Verification

- [ ] 確認公司／組織名稱、網站網域、商業文件與 Meta Business Manager 資料一致。
- [ ] 完成網域驗證與必要的管理員／企業角色設定。
- [ ] 保存送審日期、申請人、案件編號、要求的權限與審查回覆；不把 Token 或私人訊息放進紀錄。
- [ ] 若審查被拒，記錄實際拒絕原因與修正項目後再送審，不直接將狀態標成完成。

## 5. 上線閘門

在以下條件全部成立前，只允許區域網／VPN 單一操作員使用：

- [ ] `GET /api/system/readiness` 不為 `blocked`，且所有 warning 有明確處理決定。
- [ ] 正式 HTTPS、登入閘門、反向代理與備份／還原演練完成。
- [ ] App Review／Business Verification 通過，且實際核准權限與產品功能矩陣一致。
- [ ] 平台 Token 以正式品牌／平台連線驗證，失敗狀態與撤銷流程已測試。
- [ ] 有可回復的部署版本、資料備份與回滾步驟。
