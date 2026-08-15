import { $, escapeHtml, showToast } from './dom.js';
import { api } from './api.js';
import { clientQuery, hasPermission, state } from './state.js';
import { renderPosts } from './drafts.js';
import { renderSchedule } from './schedule.js';

function rowIssueText(row) {
  const errors = Array.isArray(row.errors) ? row.errors : [];
  if (!errors.length) return '可匯入預覽';
  return errors.slice(0, 3).map((error) => `${error.code || 'ERROR'}：${error.message || '資料不正確'}`).join(' · ');
}

export function renderBulkImportPreview() {
  const summary = $('#bulkImportSummary');
  const list = $('#bulkImportRows');
  if (!summary || !list) return;
  const preview = state.bulkImportPreview;
  const commitButton = $('#bulkImportCommitButton');
  if (commitButton) commitButton.disabled = !preview?.valid;
  const scheduleButton = $('#bulkImportScheduleButton');
  if (scheduleButton) {
    scheduleButton.disabled = !state.bulkImportDrafts?.length || !hasPermission('schedule.manage');
    scheduleButton.classList.toggle('permission-hidden', !hasPermission('schedule.manage'));
  }
  if (!preview) {
    summary.textContent = '尚未執行 dry-run。';
    list.innerHTML = '';
    return;
  }
  const parseErrors = Array.isArray(preview.parseErrors) ? preview.parseErrors : [];
  summary.textContent = `${parseErrors.length ? `CSV 結構錯誤 ${parseErrors.length} 個 · ` : ''}共 ${preview.rowCount || 0} 列 · 可匯入 ${preview.validRowCount || 0} 列 · 需修正 ${preview.invalidRowCount || 0} 列；此結果不會建立貼文。`;
  const parseIssueMarkup = parseErrors.map((error) => '<article class="bulk-import-row" data-valid="false"><p>' + escapeHtml(`${error.code || 'CSV_ERROR'}：${error.message || 'CSV 結構不正確'}`) + '</p></article>').join('');
  list.innerHTML = parseIssueMarkup + (preview.rows || []).map((row) => '<article class="bulk-import-row" data-valid="' + String(Boolean(row.valid)) + '">'
    + '<div><strong>第 ' + escapeHtml(String(row.rowNumber)) + ' 列 · ' + escapeHtml(row.fields?.contentTopic || '未填主題') + '</strong><small>' + escapeHtml(row.fields?.platformId || '—') + '／' + escapeHtml(row.fields?.contentType || '—') + (row.fields?.mediaPaths?.length ? ' · 素材 ' + escapeHtml(String(row.fields.mediaPaths.length)) + ' 個' : '') + '</small></div>'
    + '<p>' + escapeHtml(rowIssueText(row)) + '</p>'
    + '</article>').join('');
}

export function initBulkImportListeners() {
  const form = $('#bulkImportForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#bulkImportPreviewButton');
    const csv = $('#bulkImportCsv')?.value || '';
    if (!csv.trim()) {
      showToast('請先貼上 CSV 內容。', 'error');
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = '驗證中…';
    }
    try {
      state.bulkImportPreview = await api(clientQuery('/api/bulk-import/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: state.currentClientId, csv }),
      });
      renderBulkImportPreview();
      showToast(state.bulkImportPreview.valid ? 'CSV dry-run 通過。' : 'CSV 已完成預覽，請修正標示列。', state.bulkImportPreview.valid ? 'success' : 'info');
    } catch (error) {
      state.bulkImportPreview = null;
      renderBulkImportPreview();
      showToast(error.message || 'CSV 預覽失敗。', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '驗證 CSV';
      }
    }
  });
  $('#bulkImportClearButton')?.addEventListener('click', () => {
    const input = $('#bulkImportCsv');
    if (input) input.value = '';
    state.bulkImportPreview = null;
    state.bulkImportDrafts = [];
    renderBulkImportPreview();
  });
  $('#bulkImportCommitButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const csv = $('#bulkImportCsv')?.value || '';
    if (!state.bulkImportPreview?.valid || !csv.trim()) return;
    if (!window.confirm(`CSV 已通過驗證，確定建立 ${state.bulkImportPreview.validRowCount} 篇草稿嗎？這一步不會排程或發布。`)) return;
    button.disabled = true;
    button.textContent = '寫入中…';
    try {
      const result = await api(clientQuery('/api/bulk-import/commit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: state.currentClientId, csv }),
      });
      state.posts = [...(result.drafts || []), ...(state.posts || [])];
      state.bulkImportDrafts = result.drafts || [];
      renderPosts();
      const input = $('#bulkImportCsv');
      if (input) input.value = '';
      state.bulkImportPreview = null;
      renderBulkImportPreview();
      showToast(`已建立 ${result.createdCount || 0} 篇草稿。`, 'success');
    } catch (error) {
      showToast(error.message || 'CSV 寫入失敗，未完成匯入。', 'error');
      button.disabled = false;
    } finally {
      button.textContent = '建立草稿（不排程）';
      if (!state.bulkImportPreview?.valid) button.disabled = true;
    }
  });
  $('#bulkImportScheduleButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const drafts = state.bulkImportDrafts || [];
    if (!drafts.length || !hasPermission('schedule.manage')) return;
    if (!window.confirm(`確定將 ${drafts.length} 篇匯入草稿套用為本機排程嗎？不會建立 Meta Planner 或其他平台遠端排程。`)) return;
    button.disabled = true;
    button.textContent = '套用中…';
    try {
      const result = await api(clientQuery('/api/bulk-import/schedule'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: state.currentClientId,
          postIds: drafts.map((draft) => draft.id),
        }),
      });
      const updatedById = new Map((result.posts || []).map((post) => [post.id, post]));
      state.posts = (state.posts || []).map((post) => updatedById.get(post.id) || post);
      state.schedule = [...(result.items || []), ...(state.schedule || [])];
      state.bulkImportDrafts = [];
      renderPosts();
      renderSchedule();
      renderBulkImportPreview();
      showToast(`已套用 ${result.scheduledCount || 0} 篇本機排程。`, 'success');
    } catch (error) {
      showToast(error.message || '批次排程失敗，未套用任何排程。', 'error');
      button.disabled = false;
    } finally {
      button.textContent = '套用匯入排程（本機）';
      if (!state.bulkImportDrafts?.length) button.disabled = true;
    }
  });
  renderBulkImportPreview();
}
