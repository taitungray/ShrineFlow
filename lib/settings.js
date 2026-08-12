import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

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

export function formatEnvContent(envObj = {}) {
  const lines = [
    '# ShrineFlow 環境設定 (可從網頁介面動態修改)',
    `GEMINI_API_KEY=${envObj.GEMINI_API_KEY || ''}`,
    `GEMINI_MODEL=${envObj.GEMINI_MODEL || 'gemini-3.6-flash'}`,
    `GEMINI_FALLBACK_MODELS=${envObj.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash'}`,
    `GEMINI_RETRY_ATTEMPTS=${envObj.GEMINI_RETRY_ATTEMPTS || '3'}`,
    `GEMINI_RETRY_BASE_MS=${envObj.GEMINI_RETRY_BASE_MS || '1000'}`,
    '',
    `FACEBOOK_PAGE_ID=${envObj.FACEBOOK_PAGE_ID || ''}`,
    `FACEBOOK_PAGE_ACCESS_TOKEN=${envObj.FACEBOOK_PAGE_ACCESS_TOKEN || ''}`,
    `META_GRAPH_VERSION=${envObj.META_GRAPH_VERSION || 'v25.0'}`,
    `FACEBOOK_SCHEDULER_INTERVAL_MS=${envObj.FACEBOOK_SCHEDULER_INTERVAL_MS || '30000'}`,
    `PORT=${envObj.PORT || '3000'}`,
  ];
  return lines.join('\n') + '\n';
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
    return parseEnvContent(content);
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
  };
}
