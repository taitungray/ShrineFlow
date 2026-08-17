import { $, escapeHtml, formatDate, showToast, bindDialogDismiss } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';
import { loadPost } from './drafts.js';
import { GRID_PAGE_SIZE, LIST_PAGE_SIZE, paginate, removeListPager, syncListPager } from './pagination.js';

const filters = { query: '' };
const STATUS_LABELS = { planned: '規劃中', active: '進行中', completed: '已完成', archived: '已封存' };
let campaignsPage = 1;
let campaignPostPage = 1;
const campaignSelectedIds = new Set();

function postTitle(post) {
  return post?.title || post?.internalTitle || post?.contentTopic || post?.godName || '未命名內容';
}

function campaignPosts(campaign) {
  const ids = new Set(campaign.postIds || []);
  return state.posts.filter((post) => ids.has(post.id));
}

function statusProgress(posts) {
  const total = posts.length;
  const published = posts.filter((post) => post.status === 'published').length;
  const failed = posts.filter((post) => post.status === 'failed').length;
  const scheduled = posts.filter((post) => post.status === 'scheduled').length;
  return { total, published, failed, scheduled, percent: total ? Math.round((published / total) * 100) : 0 };
}

function renderEmpty(grid, filtered) {
  removeListPager(grid);
  grid.className = 'list-empty module-empty';
  grid.innerHTML = filtered
    ? '<div class="empty-state"><span class="empty-icon">⌕</span><p>找不到符合條件的活動。</p><button class="btn-text" type="button" data-clear-campaign-filter>清除搜尋</button></div>'
    : '<div class="empty-state"><span class="empty-icon">◈</span><p>還沒有活動，建立一個活動來集中整理內容與發布節奏。</p><button class="btn-text" type="button" data-new-campaign>＋ 建立活動</button></div>';
  grid.querySelector('[data-clear-campaign-filter]')?.addEventListener('click', () => {
    filters.query = '';
    if ($('#campaignSearch')) $('#campaignSearch').value = '';
    campaignsPage = 1;
    renderCampaigns();
  });
  grid.querySelector('[data-new-campaign]')?.addEventListener('click', () => openCampaignDialog());
}

export function renderCampaigns() {
  const grid = $('#campaignsGrid');
  if (!grid) return;
  const visible = (state.campaigns || []).filter((campaign) => {
    if (!filters.query) return true;
    const text = [campaign.name, campaign.objective, campaign.description].join(' ').toLowerCase();
    return text.includes(filters.query.toLowerCase());
  });
  if (!visible.length) {
    renderEmpty(grid, Boolean(state.campaigns?.length));
    return;
  }
  const paged = paginate(visible, { page: campaignsPage, pageSize: GRID_PAGE_SIZE });
  campaignsPage = paged.page;
  grid.className = 'campaigns-grid';
  grid.innerHTML = paged.items.map((campaign) => {
    const posts = campaignPosts(campaign);
    const progress = statusProgress(posts);
    const postList = posts.slice(0, 3).map((post) => '<button class="campaign-post" type="button" data-campaign-post-id="' + escapeHtml(post.id) + '">' + escapeHtml(postTitle(post)) + '</button>').join('');
    const more = posts.length > 3 ? '<span class="campaign-more">＋' + (posts.length - 3) + ' 篇</span>' : '';
    const dateRange = campaign.startDate || campaign.endDate
      ? (campaign.startDate || '未定') + ' → ' + (campaign.endDate || '未定')
      : '尚未設定日期';
    return '<article class="campaign-card" data-status="' + escapeHtml(campaign.status || 'planned') + '">'
      + '<div class="campaign-card-heading"><span class="campaign-icon" aria-hidden="true">◈</span><div><h3>' + escapeHtml(campaign.name) + '</h3><span class="campaign-status" data-status="' + escapeHtml(campaign.status || 'planned') + '">' + escapeHtml(STATUS_LABELS[campaign.status] || campaign.status || '規劃中') + '</span></div></div>'
      + '<p class="campaign-objective">' + escapeHtml(campaign.objective || campaign.description || '尚未填寫活動目標。') + '</p>'
      + '<div class="campaign-date">' + escapeHtml(dateRange) + '</div>'
      + '<div class="campaign-progress-label"><span>發布進度</span><strong>' + progress.published + ' / ' + progress.total + ' 篇</strong></div><div class="campaign-progress"><span style="width:' + progress.percent + '%"></span></div>'
      + '<div class="campaign-stats"><span>已排程 ' + progress.scheduled + '</span><span>需處理 ' + progress.failed + '</span></div>'
      + '<div class="campaign-post-list">' + (postList || '<span class="helper">尚未加入內容</span>') + more + '</div>'
      + '<div class="campaign-actions"><button class="btn-secondary" type="button" data-campaign-action="edit" data-campaign-id="' + escapeHtml(campaign.id) + '">編輯活動</button><button class="btn-text campaign-delete" type="button" data-campaign-action="delete" data-campaign-id="' + escapeHtml(campaign.id) + '">刪除</button></div>'
      + '</article>';
  }).join('');
  syncListPager(grid, paged, {
    label: '活動分頁',
    onPage: (page) => {
      campaignsPage = page;
      renderCampaigns();
    },
  });
}

function syncCampaignSelectionFromDom() {
  const container = $('#campaignPostSelection');
  container?.querySelectorAll('input[name="campaignPost"]').forEach((input) => {
    if (input.checked) campaignSelectedIds.add(input.value);
    else campaignSelectedIds.delete(input.value);
  });
}

function renderPostSelection(selectedIds = null) {
  const container = $('#campaignPostSelection');
  if (!container) return;
  if (selectedIds) {
    campaignSelectedIds.clear();
    selectedIds.forEach((id) => campaignSelectedIds.add(id));
    campaignPostPage = 1;
  }
  if (!state.posts.length) {
    removeListPager(container);
    container.innerHTML = '<p class="helper">目前沒有內容可加入活動，請先建立內容。</p>';
    return;
  }
  const paged = paginate(state.posts, { page: campaignPostPage, pageSize: LIST_PAGE_SIZE });
  campaignPostPage = paged.page;
  container.innerHTML = paged.items.map((post) => '<label class="selection-check"><input type="checkbox" name="campaignPost" value="' + escapeHtml(post.id) + '"' + (campaignSelectedIds.has(post.id) ? ' checked' : '') + ' /><span><strong>' + escapeHtml(postTitle(post)) + '</strong><small>' + escapeHtml(post.status || 'draft') + (post.createdAt ? ' · ' + escapeHtml(formatDate(post.createdAt)) : '') + '</small></span></label>').join('');
  syncListPager(container, paged, {
    label: '活動內容分頁',
    onPage: (page) => {
      syncCampaignSelectionFromDom();
      campaignPostPage = page;
      renderPostSelection();
    },
  });
}

function openCampaignDialog(campaign = null) {
  const dialog = $('#campaignDialog');
  const form = $('#campaignForm');
  if (!dialog || !form) return;
  form.dataset.campaignId = campaign?.id || '';
  $('#campaignName').value = campaign?.name || '';
  $('#campaignObjective').value = campaign?.objective || '';
  $('#campaignStartDate').value = campaign?.startDate || '';
  $('#campaignEndDate').value = campaign?.endDate || '';
  $('#campaignDescription').value = campaign?.description || '';
  document.querySelector('input[name="campaignStatus"][value="' + (campaign?.status || 'planned') + '"]')?.click();
  renderPostSelection(campaign?.postIds || []);
  dialog.showModal();
}

function readCampaignForm() {
  syncCampaignSelectionFromDom();
  return {
    name: $('#campaignName')?.value?.trim() || '',
    objective: $('#campaignObjective')?.value?.trim() || '',
    startDate: $('#campaignStartDate')?.value || '',
    endDate: $('#campaignEndDate')?.value || '',
    description: $('#campaignDescription')?.value?.trim() || '',
    status: document.querySelector('input[name="campaignStatus"]:checked')?.value || 'planned',
    postIds: [...campaignSelectedIds],
  };
}

export function initCampaignManager(onChanged) {
  $('#newCampaignButton')?.addEventListener('click', () => openCampaignDialog());
  $('#campaignSearch')?.addEventListener('input', (event) => {
    filters.query = event.target.value.trim();
    campaignsPage = 1;
    renderCampaigns();
  });
  $('#campaignsGrid')?.addEventListener('click', async (event) => {
    const postButton = event.target.closest('[data-campaign-post-id]');
    if (postButton) return loadPost(postButton.dataset.campaignPostId);
    const button = event.target.closest('[data-campaign-action]');
    if (!button) return;
    const campaign = state.campaigns.find((item) => item.id === button.dataset.campaignId);
    if (!campaign) return;
    if (button.dataset.campaignAction === 'edit') return openCampaignDialog(campaign);
    if (!window.confirm('確定刪除這個活動？活動內的內容不會被刪除。')) return;
    try {
      await api('/api/campaigns/' + encodeURIComponent(campaign.id), { method: 'DELETE' });
      if (typeof onChanged === 'function') await onChanged();
      showToast('活動已刪除，內容仍保留。', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  const dialog = $('#campaignDialog');
  const form = $('#campaignForm');
  bindDialogDismiss(dialog);
  form?.addEventListener('submit', async (event) => {
    if (event.submitter?.value === 'cancel' || event.submitter?.classList.contains('close-button')) return;
    event.preventDefault();
    const campaignId = form.dataset.campaignId;
    const payload = readCampaignForm();
    if (!payload.name) return showToast('請填寫活動名稱。', 'error');
    if (payload.startDate && payload.endDate && payload.startDate > payload.endDate) return showToast('結束日期不可早於開始日期。', 'error');
    try {
      await api(campaignId ? '/api/campaigns/' + encodeURIComponent(campaignId) : '/api/campaigns', {
        method: campaignId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      dialog?.close();
      if (typeof onChanged === 'function') await onChanged();
      showToast(campaignId ? '活動已更新。' : '活動已建立。', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
  dialog?.addEventListener('close', () => {
    if (form) form.dataset.campaignId = '';
  });
}
