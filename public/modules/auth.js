import { $, showToast } from './dom.js';
import { api } from './api.js';

function setGateVisible(visible) {
  const gate = $('#authGate');
  if (!gate) return;
  gate.classList.toggle('is-hidden', !visible);
  document.body.classList.toggle('auth-required', visible);
}

function setLogoutVisible(visible) {
  $('#authLogoutButton')?.classList.toggle('is-hidden', !visible);
}

export async function initializeAuth() {
  const status = await api('/api/auth/status');
  if (!status.enabled || status.authenticated) {
    setLogoutVisible(Boolean(status.enabled));
    return true;
  }

  setGateVisible(true);
  const form = $('#authForm');
  const input = $('#authPassword');
  const message = $('#authMessage');
  if (!form) return false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    if (message) message.textContent = '登入中…';
    try {
      await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input?.value || '' }),
      });
      window.location.reload();
    } catch (error) {
      if (message) message.textContent = error.message;
      showToast(error.message, 'error');
      if (submit) submit.disabled = false;
    }
  }, { once: true });
  return false;
}

export function initAuthListeners() {
  $('#authLogoutButton')?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}
