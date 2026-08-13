import { $, escapeHtml, fieldValue } from './dom.js';
import { state } from './state.js';

export function selectedPlatformDefinition(platformId = fieldValue($('#scheduleChannel')) || 'facebook') {
  return state.platforms.find((platform) => platform.id === platformId) || null;
}

function renderRadioPills(container, items, { name, selected } = {}) {
  if (!container) return;
  const enabled = items.filter((item) => !item.disabled);
  const selectedValue = items.some((item) => item.value === selected && !item.disabled)
    ? selected
    : (enabled[0]?.value || items[0]?.value || '');
  container.innerHTML = items.map((item) => {
    const id = name + '-' + item.value;
    return '<label class="radio-pill">'
      + '<input type="radio" id="' + escapeHtml(id) + '" name="' + escapeHtml(name) + '" value="' + escapeHtml(item.value) + '"'
      + (item.value === selectedValue ? ' checked' : '')
      + (item.disabled ? ' disabled' : '')
      + ' />'
      + '<span>' + escapeHtml(item.label) + '</span>'
      + '</label>';
  }).join('');
}

function renderSettingField(setting, dataAttr, namePrefix) {
  const fieldId = namePrefix + '-' + setting.id;
  const options = setting.options || [];
  if (setting.type === 'select' && options.length > 0 && options.length <= 4) {
    const pills = options.map((option, index) => {
      const inputId = fieldId + '-' + option.value;
      return '<label class="radio-pill">'
        + '<input type="radio" id="' + escapeHtml(inputId) + '" name="' + escapeHtml(fieldId) + '" value="' + escapeHtml(option.value) + '" '
        + dataAttr + '="' + escapeHtml(setting.id) + '"'
        + (index === 0 ? ' checked' : '')
        + ' />'
        + '<span>' + escapeHtml(option.label) + '</span>'
        + '</label>';
    }).join('');
    return '<div class="field">'
      + '<span class="field-label" id="' + escapeHtml(fieldId) + '-label">' + escapeHtml(setting.name) + '</span>'
      + '<div class="radio-pill-group" role="radiogroup" aria-labelledby="' + escapeHtml(fieldId) + '-label">' + pills + '</div>'
      + '</div>';
  }
  if (setting.type === 'select') {
    return '<div class="field">'
      + '<label for="' + escapeHtml(fieldId) + '" class="field-label">' + escapeHtml(setting.name) + '</label>'
      + '<select id="' + escapeHtml(fieldId) + '" ' + dataAttr + '="' + escapeHtml(setting.id) + '">'
      + options.map((option) => '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>').join('')
      + '</select></div>';
  }
  return '<div class="field">'
    + '<label for="' + escapeHtml(fieldId) + '" class="field-label">' + escapeHtml(setting.name) + '</label>'
    + '<input id="' + escapeHtml(fieldId) + '" type="text" ' + dataAttr + '="' + escapeHtml(setting.id) + '" placeholder="' + escapeHtml(setting.placeholder || '') + '" />'
    + '</div>';
}

function readDataSettings(dataKey) {
  return Object.fromEntries([...document.querySelectorAll('[data-' + dataKey + ']')].flatMap((field) => {
    if (field.type === 'radio' && !field.checked) return [];
    return [[field.getAttribute('data-' + dataKey), field.value]];
  }));
}

export function renderPlatformOptions(platforms = []) {
  const group = $('#scheduleChannel');
  if (!group || !platforms.length) return;
  renderRadioPills(group, platforms.map((platform) => ({
    value: platform.id,
    label: platform.enabled
      ? (platform.shortName || platform.name)
      : `${platform.shortName || platform.name}（可排程／尚未真發）`,
    disabled: false,
  })), { name: 'scheduleChannel', selected: fieldValue(group) || 'facebook' });
}

export function renderAccountOptions(platformId = 'facebook') {
  const accounts = state.accounts.filter((account) => account.platformId === platformId);
  const select = $('#scheduleAccount');
  if (!select) return;
  select.innerHTML = accounts.length
    ? accounts.map((account) => '<option value="' + escapeHtml(account.id) + '"' + (account.enabled === false ? ' disabled' : '') + '>' + escapeHtml(account.name) + (account.configured ? '' : '（尚未連接）') + '</option>').join('')
    : '<option value="" disabled selected>尚未連接帳號</option>';
  const preferred = accounts.find((account) => account.enabled !== false && account.configured)
    || accounts.find((account) => account.enabled !== false)
    || accounts[0];
  if (preferred) select.value = preferred.id;
}

export function renderContentSettings(platformId = fieldValue($('#scheduleChannel')) || 'facebook', contentTypeId = fieldValue($('#scheduleContentType')) || 'post') {
  const container = $('#scheduleContentSettings');
  if (!container) return;
  const platform = selectedPlatformDefinition(platformId);
  const contentType = platform?.contentTypes?.find((item) => item.id === contentTypeId);
  if (!contentType) {
    container.innerHTML = '';
    return;
  }
  const settings = contentType.settings || [];
  container.innerHTML = '<p class="content-type-description">' + escapeHtml(contentType.description || '') + '</p>'
    + settings.map((setting) => renderSettingField(setting, 'data-content-setting', 'schedule-setting')).join('');
  const submit = $('#scheduleSubmitButton');
  if (submit) {
    submit.disabled = !contentType.canPublish;
    submit.title = contentType.canPublish ? '' : '此格式尚未串接發布功能';
  }
}

export function renderContentTypeOptions(platformId = 'facebook') {
  const group = $('#scheduleContentType');
  if (!group) return;
  const platform = selectedPlatformDefinition(platformId);
  const contentTypes = platform?.contentTypes || (platformId === 'facebook' ? [{ id: 'post', name: '貼文', canPublish: true }] : []);
  renderRadioPills(group, contentTypes.map((contentType) => ({
    value: contentType.id,
    label: contentType.name + (contentType.canPublish ? '' : '（規劃中）'),
  })), { name: 'scheduleContentType', selected: fieldValue(group) });
  renderContentSettings(platformId, fieldValue(group));
}

export function readContentSettings() {
  return readDataSettings('content-setting');
}

export function renderCreateContentSettings(platformId, contentTypeId) {
  const container = $('#createContentSettings');
  const platform = state.platforms.find((item) => item.id === platformId);
  const contentType = platform?.contentTypes?.find((item) => item.id === contentTypeId);
  if (!container || !contentType) return;
  container.innerHTML = '<p class="content-type-description">' + escapeHtml(contentType.description || '') + '</p>'
    + (contentType.settings || []).map((setting) => renderSettingField(setting, 'data-create-content-setting', 'create-setting')).join('');
}

export function renderCreatePublishSpec() {
  const typeGroup = $('#createContentType');
  if (!typeGroup) return;

  // Mother draft uses Facebook format options (Phase 1 real publish).
  // Where to post is chosen later in 編輯預覽 via account checkboxes.
  const platformId = 'facebook';
  const platform = state.platforms.find((item) => item.id === platformId) || state.platforms[0];
  const contentTypes = platform?.contentTypes || [{ id: 'post', name: '貼文', canPublish: true }];
  const currentType = fieldValue(typeGroup);

  renderRadioPills(typeGroup, contentTypes.map((contentType) => ({
    value: contentType.id,
    label: contentType.name + (contentType.canPublish ? '' : '（規劃中）'),
  })), { name: 'contentType', selected: currentType });

  renderCreateContentSettings(platform?.id || platformId, fieldValue(typeGroup));
}

export function readCreateContentSettings() {
  return readDataSettings('create-content-setting');
}
