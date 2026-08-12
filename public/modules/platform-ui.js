import { $, escapeHtml } from './dom.js';
import { state } from './state.js';

export function selectedPlatformDefinition(platformId = $('#scheduleChannel')?.value || 'facebook') {
  return state.platforms.find((platform) => platform.id === platformId) || null;
}

export function renderPlatformOptions(platforms = []) {
  const select = $('#scheduleChannel');
  if (!select || !platforms.length) return;
  select.innerHTML = platforms.map((platform) => {
    const label = platform.enabled ? platform.name : `${platform.name}（即將支援）`;
    return '<option value="' + escapeHtml(platform.id) + '"' + (platform.enabled ? '' : ' disabled') + '>' + escapeHtml(label) + '</option>';
  }).join('');
}

export function renderAccountOptions(platformId = 'facebook') {
  const select = $('#scheduleAccount');
  if (!select) return;
  const accounts = state.accounts.filter((account) => account.platformId === platformId);
  select.innerHTML = accounts.length
    ? accounts.map((account) => '<option value="' + escapeHtml(account.id) + '"' + (account.enabled ? '' : ' disabled') + '>' + escapeHtml(account.name) + (account.enabled ? '' : '（尚未連接）') + '</option>').join('')
    : '<option value="" disabled selected>尚未連接帳號</option>';
  const firstEnabled = accounts.find((account) => account.enabled);
  if (firstEnabled) select.value = firstEnabled.id;
}

export function renderContentSettings(platformId = $('#scheduleChannel')?.value || 'facebook', contentTypeId = $('#scheduleContentType')?.value || 'post') {
  const container = $('#scheduleContentSettings');
  if (!container) return;
  const platform = selectedPlatformDefinition(platformId);
  const contentType = platform?.contentTypes?.find((item) => item.id === contentTypeId);
  if (!contentType) {
    container.innerHTML = '';
    return;
  }
  const settings = contentType.settings || [];
  container.innerHTML = '<p class="content-type-description">' + escapeHtml(contentType.description || '') + '</p>' + settings.map((setting) => {
    if (setting.type === 'select') {
      return '<label class="field"><span>' + escapeHtml(setting.name) + '</span><select data-content-setting="' + escapeHtml(setting.id) + '">' + setting.options.map((option) => '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>').join('') + '</select></label>';
    }
    return '<label class="field"><span>' + escapeHtml(setting.name) + '</span><input type="text" data-content-setting="' + escapeHtml(setting.id) + '" placeholder="' + escapeHtml(setting.placeholder || '') + '" /></label>';
  }).join('');
  const submit = $('#scheduleSubmitButton');
  if (submit) {
    submit.disabled = !contentType.canPublish;
    submit.title = contentType.canPublish ? '' : '此格式尚未串接發布功能';
  }
}

export function renderContentTypeOptions(platformId = 'facebook') {
  const select = $('#scheduleContentType');
  if (!select) return;
  const platform = selectedPlatformDefinition(platformId);
  const contentTypes = platform?.contentTypes || (platformId === 'facebook' ? [{ id: 'post', name: '貼文', canPublish: true }] : []);
  select.innerHTML = contentTypes.length
    ? contentTypes.map((contentType) => '<option value="' + escapeHtml(contentType.id) + '">' + escapeHtml(contentType.name) + (contentType.canPublish ? '' : '（規劃中）') + '</option>').join('')
    : '<option value="" disabled>尚未定義發布格式</option>';
  renderContentSettings(platformId, select.value);
}

export function readContentSettings() {
  return Object.fromEntries([...document.querySelectorAll('[data-content-setting]')].map((field) => [field.dataset.contentSetting, field.value]));
}

export function renderCreateContentSettings(platformId, contentTypeId) {
  const container = $('#createContentSettings');
  const platform = state.platforms.find((item) => item.id === platformId);
  const contentType = platform?.contentTypes?.find((item) => item.id === contentTypeId);
  if (!container || !contentType) return;
  container.innerHTML = '<p class="content-type-description">' + escapeHtml(contentType.description || '') + '</p>' + (contentType.settings || []).map((setting) => {
    if (setting.type === 'select') return '<label class="field"><span>' + escapeHtml(setting.name) + '</span><select data-create-content-setting="' + escapeHtml(setting.id) + '">' + setting.options.map((option) => '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>').join('') + '</select></label>';
    return '<label class="field"><span>' + escapeHtml(setting.name) + '</span><input type="text" data-create-content-setting="' + escapeHtml(setting.id) + '" placeholder="' + escapeHtml(setting.placeholder || '') + '" /></label>';
  }).join('');
}

export function renderCreatePublishSpec() {
  const platformSelect = $('#createChannel');
  const accountSelect = $('#createAccount');
  const typeSelect = $('#createContentType');
  if (!platformSelect || !accountSelect || !typeSelect) return;

  const platforms = state.platforms.length ? state.platforms : [];
  const currentVal = platformSelect.value;

  if (!platformSelect.options.length) {
    platformSelect.innerHTML = platforms.map((platform) => '<option value="' + escapeHtml(platform.id) + '">' + escapeHtml(platform.name) + '</option>').join('');
  }
  if (currentVal && [...platformSelect.options].some((opt) => opt.value === currentVal)) {
    platformSelect.value = currentVal;
  } else if (!platformSelect.value) {
    platformSelect.value = 'facebook';
  }

  const platformId = platformSelect.value || 'facebook';
  const platform = state.platforms.find((item) => item.id === platformId);

  const accounts = state.accounts.filter((account) => account.platformId === platformId);
  accountSelect.innerHTML = accounts.length
    ? accounts.map((account) => '<option value="' + escapeHtml(account.id) + '"' + (account.enabled ? '' : ' disabled') + '>' + escapeHtml(account.name) + (account.enabled ? '' : '（尚未連接）') + '</option>').join('')
    : '<option value="" disabled selected>尚未連接 ' + escapeHtml(platform?.name || '') + ' 帳號</option>';

  const firstAccount = accounts.find((account) => account.enabled);
  if (firstAccount) accountSelect.value = firstAccount.id;

  const contentTypes = platform?.contentTypes || [];
  typeSelect.innerHTML = contentTypes.length
    ? contentTypes.map((contentType) => '<option value="' + escapeHtml(contentType.id) + '">' + escapeHtml(contentType.name) + (contentType.canPublish ? '' : '（規劃中）') + '</option>').join('')
    : '<option value="" disabled selected>尚未定義格式</option>';

  renderCreateContentSettings(platformId, typeSelect.value);
}

export function readCreateContentSettings() {
  return Object.fromEntries([...document.querySelectorAll('[data-create-content-setting]')].map((field) => [field.dataset.createContentSetting, field.value]));
}
