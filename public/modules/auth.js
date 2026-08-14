import { $, showToast } from './dom.js';
import { api } from './api.js';
import { currentMembership, state } from './state.js';

const FIREBASE_SDK_VERSION = '12.16.0';

function setGateVisible(visible) {
  const gate = $('#authGate');
  if (!gate) return;
  gate.classList.toggle('is-hidden', !visible);
  document.body.classList.toggle('auth-required', visible);
}

function setLogoutVisible(visible) {
  $('#authLogoutButton')?.classList.toggle('is-hidden', !visible);
}

function inviteToken() {
  return new URL(window.location.href).searchParams.get('invite') || '';
}

function clearInviteToken() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

function setAuthMessage(message = '') {
  const element = $('#authMessage');
  if (element) element.textContent = message;
}

export function renderUserIdentity() {
  const actor = state.actor;
  const container = $('#userIdentity');
  if (!container || !actor) return;
  const displayName = actor.displayName || actor.email || '使用者';
  const membership = currentMembership();
  const role = membership?.role || actor.systemRole || (actor.legacy ? 'owner' : 'member');
  const roleLabels = { owner: 'Owner', admin: 'Admin', editor: 'Editor', reviewer: 'Reviewer', publisher: 'Publisher', viewer: 'Viewer' };
  $('#userDisplayName').textContent = displayName;
  $('#userRoleLabel').textContent = roleLabels[role] || role;
  $('#userAvatar').textContent = displayName.trim().slice(0, 1).toUpperCase() || 'U';
  container.title = actor.email || displayName;
  container.classList.remove('is-hidden');
}

async function firebaseModules() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  const [{ initializeApp }, authModule] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  return { initializeApp, ...authModule };
}

async function exchangeFirebaseSession(user, auth, signOut) {
  setAuthMessage('正在建立安全工作階段…');
  const { csrfToken } = await api('/api/auth/csrf');
  const idToken = await user.getIdToken(true);
  await api('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ idToken, inviteToken: inviteToken() }),
  });
  await signOut(auth).catch(() => {});
  clearInviteToken();
  window.location.reload();
}

async function setupFirebaseLogin(firebaseConfig) {
  const button = $('#authGoogleButton');
  const form = $('#authForm');
  const description = $('#authDescription');
  form?.classList.add('is-hidden');
  button?.classList.remove('is-hidden');
  if (description) description.textContent = inviteToken()
    ? '你已收到 ShrineFlow 邀請，請使用受邀的 Google Email 登入。'
    : '請使用已授權的 Google 帳號登入 ShrineFlow。';
  try {
    const firebase = await firebaseModules();
    const firebaseApp = firebase.initializeApp(firebaseConfig);
    const auth = firebase.getAuth(firebaseApp);
    const redirected = await firebase.getRedirectResult(auth);
    if (redirected?.user) {
      await exchangeFirebaseSession(redirected.user, auth, firebase.signOut);
      return;
    }
    button?.addEventListener('click', async () => {
      button.disabled = true;
      setAuthMessage('正在開啟 Google 登入…');
      try {
        const provider = new firebase.GoogleAuthProvider();
        const result = await firebase.signInWithPopup(auth, provider);
        await exchangeFirebaseSession(result.user, auth, firebase.signOut);
      } catch (error) {
        setAuthMessage(error.message || 'Google 登入失敗。');
        button.disabled = false;
      }
    }, { once: true });
  } catch (error) {
    setAuthMessage(`Firebase 登入元件載入失敗：${error.message}`);
  }
}

export async function initializeAuth() {
  const status = await api('/api/auth/status');
  if (!status.enabled || status.authenticated) {
    const me = status.actor ? { actor: status.actor } : await api('/api/me');
    state.actor = me.actor;
    setLogoutVisible(Boolean(status.enabled));
    renderUserIdentity();
    return true;
  }

  setGateVisible(true);
  if (status.mode === 'firebase') {
    const config = await api('/api/auth/config');
    await setupFirebaseLogin(config.firebase || {});
    return false;
  }
  const form = $('#authForm');
  const input = $('#authPassword');
  const description = $('#authDescription');
  if (description) description.textContent = '請輸入操作員密碼；工作階段逾期或服務重啟後需重新登入。';
  if (!form) return false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setAuthMessage('登入中…');
    try {
      await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input?.value || '' }),
      });
      window.location.reload();
    } catch (error) {
      setAuthMessage(error.message);
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
