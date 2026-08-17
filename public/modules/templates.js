import { $, escapeHtml, formatDate, showToast, bindDialogDismiss } from './dom.js';
import { api } from './api.js';
import { state, PLATFORM_NAMES, currentClient } from './state.js';
import { setActiveView } from './tabs.js';
import { renderTargetAccountControls } from './targets-ui.js';
import { GRID_PAGE_SIZE, paginate, removeListPager, syncListPager } from './pagination.js';

const filters = { query: '' };
let templatesPage = 1;

function platformLabel(platformId) {
  return PLATFORM_NAMES[platformId] || platformId || '未指定平台';
}

function templatePlatforms(template) {
  return Array.isArray(template.platforms) && template.platforms.length ? template.platforms : ['facebook'];
}

function postTypeLabel(postType) {
  return postType === 'announcement' ? '活動／公告' : '品牌／作品介紹';
}

function renderEmpty(grid, filtered) {
  removeListPager(grid);
  grid.className = 'list-empty module-empty';
  grid.innerHTML = filtered
    ? '<div class="empty-state"><span class="empty-icon">⌕</span><p>找不到符合條件的模板。</p><button class="btn-text" type="button" data-clear-template-filter>清除搜尋</button></div>'
    : '<div class="empty-state"><span class="empty-icon">◇</span><p>還沒有模板，先保存一個常用的內容結構。</p><button class="btn-text" type="button" data-new-template>＋ 建立模板</button></div>';
  grid.querySelector('[data-clear-template-filter]')?.addEventListener('click', () => {
    filters.query = '';
    if ($('#templateSearch')) $('#templateSearch').value = '';
    templatesPage = 1;
    renderTemplates();
  });
  grid.querySelector('[data-new-template]')?.addEventListener('click', () => openTemplateDialog());
}

export function renderTemplates() {
  const grid = $('#templatesGrid');
  if (!grid) return;
  const visible = (state.templates || []).filter((template) => {
    if (!filters.query) return true;
    const text = [template.name, template.purpose, template.topicHint, template.notes].join(' ').toLowerCase();
    return text.includes(filters.query.toLowerCase());
  });
  if (!visible.length) {
    renderEmpty(grid, Boolean(state.templates?.length));
    return;
  }
  const paged = paginate(visible, { page: templatesPage, pageSize: GRID_PAGE_SIZE });
  templatesPage = paged.page;
  grid.className = 'templates-grid';
  grid.innerHTML = paged.items.map((template) => {
    const platforms = templatePlatforms(template).map((platformId) => '<span class="platform-chip" data-platform="' + escapeHtml(platformId) + '">' + escapeHtml(platformLabel(platformId)) + '</span>').join('');
    const hashtags = (template.hashtags || []).slice(0, 4).map((tag) => escapeHtml(tag)).join(' ');
    return '<article class="template-card">'
      + '<div class="template-card-heading"><span class="template-icon" aria-hidden="true">◇</span><div><h3>' + escapeHtml(template.name) + '</h3><span class="template-type">' + escapeHtml(postTypeLabel(template.postType)) + '</span></div></div>'
      + '<p class="template-purpose">' + escapeHtml(template.purpose || template.topicHint || '尚未填寫用途說明。') + '</p>'
      + '<div class="content-platforms">' + platforms + '</div>'
      + (hashtags ? '<p class="template-hashtags">' + hashtags + '</p>' : '')
      + '<div class="template-meta"><span>更新於 ' + escapeHtml(formatDate(template.updatedAt || template.createdAt)) + '</span><span>' + templatePlatforms(template).length + ' 個平台預設</span></div>'
      + '<div class="template-actions"><button class="btn-secondary" type="button" data-template-action="apply" data-template-id="' + escapeHtml(template.id) + '">套用模板</button><button class="btn-text" type="button" data-template-action="edit" data-template-id="' + escapeHtml(template.id) + '">編輯</button><button class="btn-text template-delete" type="button" data-template-action="delete" data-template-id="' + escapeHtml(template.id) + '">刪除</button></div>'
      + '</article>';
  }).join('');
  syncListPager(grid, paged, {
    label: '模板分頁',
    onPage: (page) => {
      templatesPage = page;
      renderTemplates();
    },
  });
}

function setCheckedValues(name, values) {
  const selected = new Set(values || []);
  document.querySelectorAll('input[name="' + name + '"]').forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function openTemplateDialog(template = null) {
  const dialog = $('#templateDialog');
  const form = $('#templateForm');
  if (!dialog || !form) return;
  form.dataset.templateId = template?.id || '';
  $('#templateName').value = template?.name || '';
  $('#templatePurpose').value = template?.purpose || '';
  $('#templateTopicHint').value = template?.topicHint || '';
  $('#templateNotes').value = template?.notes || '';
  $('#templateCallToAction').value = template?.defaultCallToAction || '';
  $('#templateHashtags').value = (template?.hashtags || []).join(' ');
  document.querySelector('input[name="templatePostType"][value="' + (template?.postType || 'intro') + '"]')?.click();
  setCheckedValues('templatePlatform', templatePlatforms(template));
  dialog.showModal();
}

function readTemplateForm() {
  return {
    name: $('#templateName')?.value?.trim() || '',
    purpose: $('#templatePurpose')?.value?.trim() || '',
    topicHint: $('#templateTopicHint')?.value?.trim() || '',
    notes: $('#templateNotes')?.value?.trim() || '',
    defaultCallToAction: $('#templateCallToAction')?.value?.trim() || '',
    hashtags: ($('#templateHashtags')?.value || '').split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean),
    postType: document.querySelector('input[name="templatePostType"]:checked')?.value || 'intro',
    platforms: [...document.querySelectorAll('input[name="templatePlatform"]:checked')].map((input) => input.value),
  };
}

function applyTemplate(template) {
  const topic = $('#contentTopic');
  const notes = $('#extraNotes');
  const hashtags = $('#hashtagsText');
  if (topic) topic.value = template.topicHint || '';
  if (notes) notes.value = [template.notes, template.defaultCallToAction ? 'CTA：' + template.defaultCallToAction : ''].filter(Boolean).join('\n');
  if (hashtags) hashtags.value = (template.hashtags || []).join(' ');
  document.querySelector('input[name="contentDirection"][value="' + (template.postType || 'intro') + '"]')?.click();

  const client = currentClient();
  const platformIds = new Set(templatePlatforms(template));
  const selectedAccounts = (client?.accounts || []).filter((account) => platformIds.has(account.platformId));
  if (selectedAccounts.length) {
    state.selectedTargetAccountIds = selectedAccounts.map((account) => account.id);
    state.activeTargetId = selectedAccounts[0].id;
    renderTargetAccountControls();
  }
  setActiveView('create');
  showToast('模板已套用，請確認主題與平台後產生內容。', 'success');
}

export function initTemplateManager(onChanged) {
  $('#newTemplateButton')?.addEventListener('click', () => openTemplateDialog());
  $('#templateSearch')?.addEventListener('input', (event) => {
    filters.query = event.target.value.trim();
    templatesPage = 1;
    renderTemplates();
  });
  $('#templatesGrid')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-template-action]');
    if (!button) return;
    const template = state.templates.find((item) => item.id === button.dataset.templateId);
    if (!template) return;
    if (button.dataset.templateAction === 'apply') return applyTemplate(template);
    if (button.dataset.templateAction === 'edit') return openTemplateDialog(template);
    if (!window.confirm('確定刪除這個模板？')) return;
    try {
      await api('/api/templates/' + encodeURIComponent(template.id), { method: 'DELETE' });
      if (typeof onChanged === 'function') await onChanged();
      showToast('模板已刪除。', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  const dialog = $('#templateDialog');
  const form = $('#templateForm');
  bindDialogDismiss(dialog);
  form?.addEventListener('submit', async (event) => {
    if (event.submitter?.value === 'cancel' || event.submitter?.classList.contains('close-button')) return;
    event.preventDefault();
    const templateId = form.dataset.templateId;
    const payload = readTemplateForm();
    if (!payload.name) return showToast('請填寫模板名稱。', 'error');
    try {
      await api(templateId ? '/api/templates/' + encodeURIComponent(templateId) : '/api/templates', {
        method: templateId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      dialog?.close();
      if (typeof onChanged === 'function') await onChanged();
      showToast(templateId ? '模板已更新。' : '模板已建立。', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
  dialog?.addEventListener('close', () => {
    if (form) form.dataset.templateId = '';
  });
}
