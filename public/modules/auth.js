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

function firebaseLoginMessage(error) {
  const messages = {
    'auth/invalid-credential': 'Email 或密碼不正確。',
    'auth/invalid-login-credentials': 'Email 或密碼不正確。',
    'auth/user-not-found': '找不到此 Email 帳號。',
    'auth/wrong-password': 'Email 或密碼不正確。',
    'auth/user-disabled': '此 Email 帳號已被停用。',
    'auth/too-many-requests': '登入嘗試過於頻繁，請稍後再試。',
    'auth/operation-not-allowed': 'Firebase 尚未啟用 Email／密碼登入。',
  };
  return messages[error?.code] || error?.message || '登入失敗，請稍後再試。';
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
  const emailForm = $('#authEmailForm');
  const emailInput = $('#authEmail');
  const emailPassword = $('#authEmailPassword');
  const providerDivider = $('#authProviderDivider');
  const description = $('#authDescription');
  form?.classList.add('is-hidden');
  emailForm?.classList.remove('is-hidden');
  providerDivider?.classList.remove('is-hidden');
  button?.classList.remove('is-hidden');
  if (description) description.textContent = inviteToken()
    ? '你已收到 ShrineFlow 邀請，請使用相同 Email 的 Google 或 Email 帳號登入。'
    : '請使用已授權的 Google 帳號，或已建立並受邀的 Email 帳號登入。';
  try {
    const firebase = await firebaseModules();
    const firebaseApp = firebase.initializeApp(firebaseConfig);
    const auth = firebase.getAuth(firebaseApp);
    const redirected = await firebase.getRedirectResult(auth);
    if (redirected?.user) {
      await exchangeFirebaseSession(redirected.user, auth, firebase.signOut);
      return;
    }
    emailForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = emailForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setAuthMessage('Email 登入中…');
      try {
        const result = await firebase.signInWithEmailAndPassword(
          auth,
          String(emailInput?.value || '').trim(),
          emailPassword?.value || '',
        );
        await exchangeFirebaseSession(result.user, auth, firebase.signOut);
      } catch (error) {
        setAuthMessage(firebaseLoginMessage(error));
        if (submit) submit.disabled = false;
      }
    });
    button?.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      setAuthMessage('正在開啟 Google 登入…');
      try {
        const provider = new firebase.GoogleAuthProvider();
        const result = await firebase.signInWithPopup(auth, provider);
        await exchangeFirebaseSession(result.user, auth, firebase.signOut);
      } catch (error) {
        setAuthMessage(firebaseLoginMessage(error));
        button.disabled = false;
      }
    });
  } catch (error) {
    setAuthMessage(`Firebase 登入元件載入失敗：${firebaseLoginMessage(error)}`);
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
