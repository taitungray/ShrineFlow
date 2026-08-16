import { $, escapeHtml, showToast } from './dom.js';
import { api } from './api.js';
import { clientQuery, currentClient, hasPermission, state } from './state.js';

let initialized = false;

function selectedScope() {
  return document.querySelector('input[name="crisisPauseScope"]:checked')?.value || 'client';
}

function selectedPlatform() {
  return document.querySelector('input[name="crisisPausePlatform"]:checked')?.value || 'facebook';
}

function renderScopeFields() {
  const scope = selectedScope();
  $('#crisisPauseAccountField')?.classList.toggle('is-hidden', scope !== 'account');
  $('#crisisPausePlatformField')?.classList.toggle('is-hidden', scope !== 'platform');
}

export function renderCrisisPause() {
  const card = $('#crisisPauseCard');
  if (!card) return;
  const client = currentClient();
  const pause = state.crisisPause?.pause || client?.crisisPause || null;
  const paused = state.crisisPause?.status === 'paused' || pause?.status === 'paused';
  const accountSelect = $('#crisisPauseAccount');
  if (accountSelect) {
    accountSelect.innerHTML = (client?.accounts || []).filter((account) => account.enabled !== false)
      .map((account) => '<option value="' + escapeHtml(account.id) + '">' + escapeHtml(account.name || account.id) + '</option>')
      .join('');
  }
  const button = $('#crisisPauseButton');
  if (button) {
    button.textContent = paused ? '恢復發布' : '立即暫停發布';
    button.dataset.action = paused ? 'resume' : 'pause';
    button.disabled = !client || !hasPermission('schedule.manage');
    button.classList.toggle('btn-danger', !paused);
  }
  const status = $('#crisisPauseStatus');
  if (status) {
    status.textContent = paused
      ? `已暫停${pause?.reason ? `：${pause.reason}` : ''} · 影響 ${pause?.targetCount || 0} 個排程${pause?.remoteCancelFailedCount ? ` · ${pause.remoteCancelFailedCount} 個遠端取消失敗` : ''}`
      : '目前未啟用危機暫停。';
    status.dataset.status = paused ? 'paused' : 'active';
  }
  const reason = $('#crisisPauseReason');
  if (reason) reason.disabled = paused;
  document.querySelectorAll('input[name="crisisPauseScope"], input[name="crisisPausePlatform"]').forEach((input) => {
    input.disabled = paused;
  });
  if (accountSelect) accountSelect.disabled = paused;
  if ('open' in card) card.open = paused;
  renderScopeFields();
}

export async function loadCrisisPause() {
  if (!currentClient()?.id) {
    state.crisisPause = null;
    renderCrisisPause();
    return null;
  }
  state.crisisPause = await api(clientQuery('/api/crisis-pause')).catch(() => null);
  renderCrisisPause();
  return state.crisisPause;
}

export function initCrisisPause(refreshListsFn) {
  if (initialized) return;
  initialized = true;
  document.querySelectorAll('input[name="crisisPauseScope"]').forEach((input) => input.addEventListener('change', renderScopeFields));
  $('#crisisPauseForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#crisisPauseButton');
    const action = button?.dataset.action || 'pause';
    if (!currentClient()?.id) return;
    if (button) button.disabled = true;
    try {
      const path = action === 'resume' ? '/api/crisis-pause/resume' : '/api/crisis-pause';
      const body = action === 'resume'
        ? { clientId: currentClient().id }
        : {
          clientId: currentClient().id,
          scope: selectedScope(),
          accountId: $('#crisisPauseAccount')?.value || '',
          platformId: selectedPlatform(),
          reason: $('#crisisPauseReason')?.value || '',
        };
      const result = await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      state.crisisPause = result;
      renderCrisisPause();
      if (typeof refreshListsFn === 'function') await refreshListsFn();
      showToast(action === 'resume' ? '發布暫停已解除。' : '發布已暫停；遠端取消結果已逐筆回報。', action === 'resume' && result.status === 'paused' ? 'error' : 'success');
    } catch (error) {
      if (button) button.disabled = false;
      const status = $('#crisisPauseStatus');
      if (status) status.textContent = error.message || '危機暫停操作失敗。';
      showToast(error.message || '危機暫停操作失敗。', 'error');
    }
  });
  renderCrisisPause();
}
