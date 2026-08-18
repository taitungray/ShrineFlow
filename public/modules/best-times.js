import { $, escapeHtml } from './dom.js';
import { api } from './api.js';
import { clientQuery, state } from './state.js';

function messageFor(result) {
  if (!result || result.status === 'insufficient_data' || !result.sampleCount) {
    return '還沒有已發布紀錄。發一筆就能看時段分布。';
  }
  if (result.dataQuality === 'thin' || result.dataQuality === 'exploratory') {
    return '依本機已發布時間統計，樣本偏少僅供參考，不會改 Queue。';
  }
  return '這是依本機已發布紀錄計算的探索性建議，不會自動改動 Queue。';
}

export function renderBestTimes() {
  const container = $('#bestTimesCard');
  const result = state.bestTimes;
  if (!container || !result) return;
  const slots = Array.isArray(result.slots) ? result.slots : [];
  const scopeText = result.filters?.platformId ? '' : '全部平台';
  container.dataset.status = result.status || 'unavailable';
  const slotMarkup = slots.length
    ? '<div class="best-times-slots">' + slots.map((slot) => '<div class="best-time-slot"><strong>週' + escapeHtml(slot.weekdayLabel) + ' ' + escapeHtml(slot.localHour) + '</strong><span>' + escapeHtml(String(slot.sampleCount)) + ' 筆樣本 · 分數 ' + escapeHtml(String(slot.score)) + '</span></div>').join('') + '</div>'
    : '<p class="helper">' + messageFor(result) + '</p>';
  container.innerHTML = '<div class="best-times-heading"><div><span class="section-tag">TIMING SUGGESTION</span><h3>最佳發布時段</h3></div><button class="btn-test" id="refreshBestTimesButton" type="button">分析</button></div>'
    + '<p class="helper">' + messageFor(result) + '</p>'
    + '<p class="best-times-meta">' + (scopeText ? escapeHtml(scopeText) + ' · ' : '') + escapeHtml(result.timeZone || 'Asia/Taipei') + ' · ' + escapeHtml(String(result.sampleCount || 0)) + ' 筆樣本 · ' + escapeHtml(result.algorithmVersion || '—') + '</p>'
    + slotMarkup;
  $('#refreshBestTimesButton')?.addEventListener('click', loadBestTimes);
}

export async function loadBestTimes() {
  const button = $('#refreshBestTimesButton');
  if (button) button.disabled = true;
  try {
    const query = state.insightsPlatform ? '?platform=' + encodeURIComponent(state.insightsPlatform) : '';
    state.bestTimes = await api(clientQuery('/api/insights/best-times' + query));
    renderBestTimes();
  } catch (error) {
    state.bestTimes = { status: 'unavailable', sampleCount: 0, slots: [], error: error.message };
    renderBestTimes();
  } finally {
    const refreshed = $('#refreshBestTimesButton');
    if (refreshed) refreshed.disabled = false;
  }
}
