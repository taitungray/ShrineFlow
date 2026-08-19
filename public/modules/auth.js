import { $, showToast } from './dom.js';
import { api, setReauthHandler, storeReauthToken } from './api.js';
import { rememberSignedIn } from './boot-stability.js';
import { currentMembership, state } from './state.js';

const FIREBASE_SDK_VERSION = '12.16.0';

let authMode = '';
let firebaseWebConfig = null;
let firebaseSdk = null;
let firebaseApp = null;
let reauthInFlight = null;

function setGateVisible(visible) {
  const gate = $('#authGate');
  if (!gate) return;
  gate.classList.toggle('is-hidden', !visible);
  document.body.classList.toggle('auth-required', visible);
  document.documentElement.classList.toggle('has-session', !visible);
  rememberSignedIn(!visible);
  if (visible) gate.setAttribute('aria-busy', 'false');
  else gate.removeAttribute('aria-busy');
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
    'auth/popup-closed-by-user': '已取消 Google 視窗。',
    'auth/cancelled-popup-request': '已取消 Google 視窗。',
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

async function loadFirebase() {
  if (!firebaseWebConfig) {
    const config = await api('/api/auth/config');
    firebaseWebConfig = config.firebase || {};
  }
  if (!firebaseSdk) firebaseSdk = await firebaseModules();
  if (!firebaseApp) firebaseApp = firebaseSdk.initializeApp(firebaseWebConfig);
  return firebaseSdk;
}

async function exchangeReauthToken(idToken) {
  const data = await api('/api/auth/reauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  storeReauthToken(data.token);
  return data.token;
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
  rememberSignedIn(true);
  window.location.reload();
}

async function setupFirebaseLogin(firebaseConfig) {
  firebaseWebConfig = firebaseConfig;
  const button = $('#authGoogleButton');
  const form = $('#authForm');
  const description = $('#authDescription');
  form?.classList.add('is-hidden');
  button?.classList.remove('is-hidden');
  if (description) description.textContent = inviteToken()
    ? '你已收到 ShrineFlow 邀請，請使用相同 Email 的 Google 帳號登入。'
    : '請使用已授權的 Google 帳號登入。';
  try {
    const firebase = await loadFirebase();
    const auth = firebase.getAuth(firebaseApp);
    const redirected = await firebase.getRedirectResult(auth);
    if (redirected?.user) {
      await exchangeFirebaseSession(redirected.user, auth, firebase.signOut);
      return;
    }
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

function setReauthMessage(message = '') {
  const element = $('#reauthMessage');
  if (element) element.textContent = message;
}

function promptReauth() {
  const dialog = $('#reauthDialog');
  if (!dialog) return Promise.reject(new Error('找不到二次驗證視窗。'));
  const form = $('#reauthForm');
  const passwordInput = $('#reauthPassword');
  const googleButton = $('#reauthGoogleButton');
  const cancelButton = $('#reauthCancelButton');
  const isFirebase = authMode === 'firebase';
  googleButton?.classList.toggle('is-hidden', !isFirebase);
  $('#reauthPasswordField')?.classList.toggle('is-hidden', isFirebase);
  $('#reauthSubmitButton')?.classList.toggle('is-hidden', isFirebase);
  if (passwordInput) passwordInput.value = '';
  setReauthMessage('');
  const description = $('#reauthDescription');
  if (description) {
    description.textContent = isFirebase
      ? '變更成員、平台憑證或系統設定前，請用同一個 Google 帳號再登入一次。'
      : '變更成員、平台憑證或系統設定前，請再輸入操作員密碼。';
  }
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');

  return new Promise((resolve, reject) => {
    const finish = (error, token) => {
      form?.removeEventListener('submit', onSubmit);
      googleButton?.removeEventListener('click', onGoogle);
      cancelButton?.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      dialog.close?.();
      if (error) reject(error);
      else resolve(token);
    };
    const onCancel = (event) => {
      event?.preventDefault?.();
      finish(new Error('已取消身分確認。'));
    };
    const onSubmit = async (event) => {
      event.preventDefault();
      if (isFirebase) {
        setReauthMessage('請用 Google 再次確認。');
        return;
      }
      const password = String(passwordInput?.value || '');
      if (!password) {
        setReauthMessage('請輸入密碼。');
        return;
      }
      setReauthMessage('確認中…');
      try {
        const data = await api('/api/auth/reauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        storeReauthToken(data.token);
        finish(null, data.token);
      } catch (error) {
        setReauthMessage(firebaseLoginMessage(error));
      }
    };
    const onGoogle = async () => {
      setReauthMessage('正在開啟 Google 登入…');
      try {
        const firebase = await loadFirebase();
        const auth = firebase.getAuth(firebaseApp);
        const provider = new firebase.GoogleAuthProvider();
        const result = await firebase.signInWithPopup(auth, provider);
        const idToken = await result.user.getIdToken(true);
        await firebase.signOut(auth).catch(() => {});
        finish(null, await exchangeReauthToken(idToken));
      } catch (error) {
        setReauthMessage(firebaseLoginMessage(error));
      }
    };
    form?.addEventListener('submit', onSubmit);
    googleButton?.addEventListener('click', onGoogle);
    cancelButton?.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
  });
}

export function ensureReauth() {
  if (reauthInFlight) return reauthInFlight;
  reauthInFlight = promptReauth().finally(() => { reauthInFlight = null; });
  return reauthInFlight;
}

function showLegacyPasswordForm(message) {
  const form = $('#authForm');
  const description = $('#authDescription');
  if (description) description.textContent = message;
  form?.classList.remove('is-hidden');
  return form;
}

function bindLegacyPasswordLogin(form) {
  const input = $('#authPassword');
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
      rememberSignedIn(true);
      window.location.reload();
    } catch (error) {
      setAuthMessage(error.message);
      showToast(error.message, 'error');
      if (submit) submit.disabled = false;
    }
  }, { once: true });
}

export async function initializeAuth() {
  try {
    let status;
    try {
      status = await api('/api/auth/status');
      if (status?.version) {
        const versionText = status.version.startsWith('v') ? status.version : `v${status.version}`;
        if ($('#authAppVersion')) $('#authAppVersion').textContent = versionText;
        if ($('#appVersion')) $('#appVersion').textContent = versionText;
      }
    } catch (error) {
      setGateVisible(true);
      const form = showLegacyPasswordForm(error.message || '無法確認登入狀態，請檢查網路連線或稍後再試。');
      if (form) bindLegacyPasswordLogin(form);
      return false;
    }
    authMode = status.mode || (status.enabled ? 'legacy' : 'disabled');
    if (!status.enabled || status.authenticated) {
      try {
        const me = status.actor ? { actor: status.actor } : await api('/api/me');
        state.actor = me.actor;
        setLogoutVisible(Boolean(status.enabled));
        renderUserIdentity();
        if (status.enabled) setReauthHandler(ensureReauth);
        setGateVisible(false);
        return true;
      } catch (meError) {
        console.warn('Failed to fetch /api/me:', meError);
        status.authenticated = false;
      }
    }

    setGateVisible(true);
    if (status.mode === 'firebase') {
      try {
        const config = await api('/api/auth/config');
        await setupFirebaseLogin(config.firebase || {});
      } catch (fbError) {
        setGateVisible(true);
        const description = $('#authDescription');
        if (description) description.textContent = 'Firebase 連線異常，請重新整理頁面重試。';
        setAuthMessage(fbError.message || '無法取得 Firebase 設定');
      }
      return false;
    }
    const form = showLegacyPasswordForm('請輸入操作員密碼；工作階段逾期或服務重啟後需重新登入。');
    if (!form) return false;
    bindLegacyPasswordLogin(form);
    return false;
  } catch (fatalError) {
    console.error('Fatal auth initialization error:', fatalError);
    setGateVisible(true);
    const description = $('#authDescription');
    if (description) description.textContent = '登入服務暫時無法連線，請重新整理重試。';
    setAuthMessage(fatalError.message || '連線逾時');
    return false;
  }
}

export function initAuthListeners() {
  $('#authLogoutButton')?.addEventListener('click', async () => {
    try {
      storeReauthToken('');
      rememberSignedIn(false);
      await api('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}
