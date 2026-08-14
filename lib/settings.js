import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptSecret, encryptSecret, secretStorageStatus } from './secret-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const SECRET_ENV_KEYS = ['GEMINI_API_KEY', 'FACEBOOK_PAGE_ACCESS_TOKEN', 'META_APP_SECRET'];

export const environmentFilePath = envPath;

export function decryptEnvironmentSecrets(env = {}, explicitMasterKey = undefined) {
  const next = { ...env };
  for (const key of SECRET_ENV_KEYS) {
    if (next[key]) next[key] = decryptSecret(next[key], explicitMasterKey);
  }
  return next;
}

function hydrateProcessEnvSecrets() {
  for (const key of SECRET_ENV_KEYS) {
    if (process.env[key]) process.env[key] = decryptSecret(process.env[key]);
  }
}

hydrateProcessEnvSecrets();

export function parseEnvContent(content = '') {
  const env = {};
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex > 0) {
      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  });
  return env;
}

export function formatEnvContent(envObj = {}, explicitMasterKey = undefined) {
  const persisted = { ...envObj };
  for (const key of SECRET_ENV_KEYS) {
    if (persisted[key]) persisted[key] = encryptSecret(persisted[key], explicitMasterKey);
  }
  const lines = [
    '# ShrineFlow 環境設定 (可從網頁介面動態修改)',
    `GEMINI_API_KEY=${persisted.GEMINI_API_KEY || ''}`,
    `GEMINI_MODEL=${envObj.GEMINI_MODEL || 'gemini-3.6-flash'}`,
    `GEMINI_FALLBACK_MODELS=${envObj.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash'}`,
    `GEMINI_RETRY_ATTEMPTS=${envObj.GEMINI_RETRY_ATTEMPTS || '3'}`,
    `GEMINI_RETRY_BASE_MS=${envObj.GEMINI_RETRY_BASE_MS || '1000'}`,
    '',
    `FACEBOOK_PAGE_ID=${envObj.FACEBOOK_PAGE_ID || ''}`,
    `FACEBOOK_PAGE_ACCESS_TOKEN=${persisted.FACEBOOK_PAGE_ACCESS_TOKEN || ''}`,
    `META_GRAPH_VERSION=${persisted.META_GRAPH_VERSION || 'v25.0'}`,
    `META_APP_SECRET=${persisted.META_APP_SECRET || ''}`,
    `META_WEBHOOK_VERIFY_TOKEN=${envObj.META_WEBHOOK_VERIFY_TOKEN || ''}`,
    `SHRINEFLOW_MASTER_KEY=${envObj.SHRINEFLOW_MASTER_KEY || ''}`,
    `PUBLIC_MEDIA_BASE_URL=${envObj.PUBLIC_MEDIA_BASE_URL || ''}`,
    `FACEBOOK_SCHEDULER_INTERVAL_MS=${envObj.FACEBOOK_SCHEDULER_INTERVAL_MS || '30000'}`,
    `PORT=${envObj.PORT || '3000'}`,
  ];
  return lines.join('\n') + '\n';
}

export function rotateEnvironmentContent(content = '', currentMasterKey = '', newMasterKey = '') {
  const plainEnv = decryptEnvironmentSecrets(parseEnvContent(content), currentMasterKey);
  const nextEnv = { ...plainEnv, SHRINEFLOW_MASTER_KEY: newMasterKey };
  return {
    content: formatEnvContent(nextEnv, newMasterKey),
    plainEnv,
  };
}

export function maskKey(value = '') {
  const str = String(value || '').trim();
  if (!str) return '';
  if (str.length <= 8) return '****';
  return str.slice(0, 4) + '...' + str.slice(-4);
}

export async function loadEnvSettings() {
  try {
    const content = await fs.readFile(envPath, 'utf8');
    return decryptEnvironmentSecrets(parseEnvContent(content));
  } catch {
    return {};
  }
}

export async function saveEnvSettings(newSettings = {}) {
  const currentEnv = await loadEnvSettings();
  const keys = [
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'GEMINI_FALLBACK_MODELS',
    'FACEBOOK_PAGE_ID',
    'FACEBOOK_PAGE_ACCESS_TOKEN',
    'META_GRAPH_VERSION',
    'META_APP_SECRET',
    'META_WEBHOOK_VERIFY_TOKEN',
    'PUBLIC_MEDIA_BASE_URL',
  ];

  keys.forEach((key) => {
    if (newSettings[key] !== undefined) {
      const val = String(newSettings[key]).trim();
      // If the value sent is masked (e.g. contains '...'), keep current setting
      if (!val.includes('...')) {
        currentEnv[key] = val;
        process.env[key] = val;
      }
    }
  });

  const content = formatEnvContent(currentEnv);
  await fs.writeFile(envPath, content, 'utf8');
  return currentEnv;
}

export function getPublicSettings() {
  return {
    geminiApiKey: maskKey(process.env.GEMINI_API_KEY),
    geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    geminiFallbackModels: process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash',
    facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
    facebookPageAccessToken: maskKey(process.env.FACEBOOK_PAGE_ACCESS_TOKEN),
    facebookAccessTokenConfigured: Boolean(process.env.FACEBOOK_PAGE_ACCESS_TOKEN),
    metaGraphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    publicMediaBaseUrl: process.env.PUBLIC_MEDIA_BASE_URL || '',
    metaAppSecretConfigured: Boolean(process.env.META_APP_SECRET),
    secretStorage: secretStorageStatus(),
  };
}
