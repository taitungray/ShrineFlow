import crypto from 'node:crypto';

const ENCRYPTED_PREFIX = 'enc:v1:';
const SECRET_FIELDS = ['pageAccessToken', 'accessToken'];

export function getSecretMasterKey(explicitKey = '') {
  return String(explicitKey || process.env.SHRINEFLOW_MASTER_KEY || '').trim();
}

export function isEncryptedSecret(value) {
  return String(value || '').startsWith(ENCRYPTED_PREFIX);
}

function deriveKey(masterKey) {
  return crypto.createHash('sha256').update(masterKey).digest();
}

export function encryptSecret(value, explicitKey = '') {
  const plainText = String(value || '');
  const masterKey = getSecretMasterKey(explicitKey);
  if (!plainText || isEncryptedSecret(plainText) || !masterKey) return plainText;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(masterKey), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + [iv, authTag, encrypted].map((buffer) => buffer.toString('base64url')).join('.');
}

export function decryptSecret(value, explicitKey = '') {
  const encrypted = String(value || '');
  if (!isEncryptedSecret(encrypted)) return encrypted;
  const masterKey = getSecretMasterKey(explicitKey);
  if (!masterKey) throw new Error('偵測到已加密 Token，但尚未設定 SHRINEFLOW_MASTER_KEY。');
  const parts = encrypted.slice(ENCRYPTED_PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('加密 Token 格式不正確。');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(masterKey), Buffer.from(parts[0], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[1], 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2], 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Token 解密失敗，請確認 SHRINEFLOW_MASTER_KEY。');
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function decryptClientSecrets(client, explicitKey = '') {
  const next = clone(client);
  for (const field of SECRET_FIELDS) {
    if (next.credentials && next.credentials[field]) next.credentials[field] = decryptSecret(next.credentials[field], explicitKey);
  }
  for (const account of next.accounts || []) {
    for (const field of SECRET_FIELDS) {
      if (account.credentials?.[field]) account.credentials[field] = decryptSecret(account.credentials[field], explicitKey);
    }
  }
  return next;
}

export function encryptClientSecrets(client, explicitKey = '') {
  const next = clone(client);
  for (const field of SECRET_FIELDS) {
    if (next.credentials && next.credentials[field]) next.credentials[field] = encryptSecret(next.credentials[field], explicitKey);
  }
  for (const account of next.accounts || []) {
    for (const field of SECRET_FIELDS) {
      if (account.credentials?.[field]) account.credentials[field] = encryptSecret(account.credentials[field], explicitKey);
    }
  }
  return next;
}

export function secretStorageStatus() {
  return {
    configured: Boolean(getSecretMasterKey()),
    algorithm: 'AES-256-GCM',
    migration: 'next-write',
    rotation: 'manual-explicit-key-required',
  };
}
