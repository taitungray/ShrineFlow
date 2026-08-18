import { $, escapeHtml } from './dom.js';
import { api } from './api.js';
import { clientQuery, state } from './state.js';
import { humanizePlatformError } from './platform-errors.js';

function sourceStatusLabel(source) {
  if (source.status === 'synced') return '已同步';
  return humanizePlatformError(source.error?.message || 'remote_schedule_unavailable');
}

export function renderRemoteSchedule() {
  const card = $('#remoteScheduleCard');
  const result = state.remoteSchedule;
  if (!card || !result) return;
  const unavailable = result.status !== 'synced';
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const sourceError = sources.find((source) => source.error?.message)?.error?.message;
  const statusText = unavailable
    ? humanizePlatformError(result.error || sourceError || 'remote_schedule_unavailable')
    : '已取得遠端資料';
  const sourceText = sources.length
    ? sources.map((source) => `${source.accountId}：${sourceStatusLabel(source)}`).join(' · ')
    : '目前品牌沒有可檢查的 Facebook 帳號。';
  card.dataset.status = unavailable ? 'unavailable' : 'synced';
  card.innerHTML = '<div class="remote-schedule-heading"><div><span class="section-tag">META PLANNER</span><h3>遠端排程唯讀對帳</h3></div><div class="remote-schedule-actions"><button class="btn-text" type="button" data-open-business-suite data-business-suite-dest="scheduled" aria-label="開啟 Meta Business Suite 排程">開啟 Business Suite</button><button class="btn-test" id="refreshRemoteScheduleButton" type="button">檢查</button></div></div>'
    + '<p class="helper">此功能只顯示已驗證 connector 回傳的資料，不會把本機空日曆解讀成遠端沒有排程，也不會修改或刪除 Meta 排程。</p>'
    + '<p class="remote-schedule-status" data-status="' + (unavailable ? 'unavailable' : 'synced') + '">' + escapeHtml(statusText) + '</p>'
    + (unavailable ? '<p class="remote-schedule-sources"><a class="btn-text" href="#/settings/facebook">更新粉專 Token</a> · <a class="btn-text" href="#/help/facebook-token-expired">查看說明</a></p>' : '')
    + '<p class="remote-schedule-sources">' + escapeHtml(sourceText) + '</p>';
  $('#refreshRemoteScheduleButton')?.addEventListener('click', loadRemoteSchedule);
}

export async function loadRemoteSchedule() {
  const button = $('#refreshRemoteScheduleButton');
  if (button) button.disabled = true;
  try {
    state.remoteSchedule = await api(clientQuery('/api/remote-schedule'));
  } catch (error) {
    state.remoteSchedule = { status: 'remote_schedule_unavailable', sources: [], error: error.message };
  }
  renderRemoteSchedule();
}
