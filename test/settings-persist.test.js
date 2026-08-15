import test from 'node:test';
import assert from 'node:assert/strict';

import { encryptSecret } from '../lib/secret-storage.js';
import {
  hydrateRuntimeSettings,
  saveEnvSettings,
} from '../lib/settings.js';

function createMemorySettingsRepository(initial = {}) {
  let value = { ...initial };
  return {
    backend: 'firestore',
    appSettings: {
      async list() {
        return { ...value };
      },
      async replace(next) {
        value = { ...next };
        return value;
      },
    },
  };
}

test('cloud settings persist encrypted Gemini key to Firestore instead of .env', async () => {
  const previous = {
    SHRINEFLOW_MASTER_KEY: process.env.SHRINEFLOW_MASTER_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  };
  process.env.SHRINEFLOW_MASTER_KEY = 'cloud-master-key-16';
  delete process.env.GEMINI_API_KEY;
  const repositories = createMemorySettingsRepository();

  try {
    const saved = await saveEnvSettings({
      GEMINI_API_KEY: 'gemini-from-admin',
      GEMINI_MODEL: 'gemini-3.6-flash',
    }, { repositories, persistToFile: false });

    assert.equal(saved.GEMINI_API_KEY, 'gemini-from-admin');
    assert.equal(process.env.GEMINI_API_KEY, 'gemini-from-admin');
    const stored = await repositories.appSettings.list();
    assert.match(String(stored.GEMINI_API_KEY || ''), /^enc:v1:/);
    assert.equal(stored.GEMINI_MODEL, 'gemini-3.6-flash');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('cloud runtime hydrates Gemini key from Firestore after restart', async () => {
  const previous = {
    SHRINEFLOW_MASTER_KEY: process.env.SHRINEFLOW_MASTER_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  process.env.SHRINEFLOW_MASTER_KEY = 'cloud-master-key-16';
  delete process.env.GEMINI_API_KEY;
  const repositories = createMemorySettingsRepository({
    GEMINI_API_KEY: encryptSecret('persisted-gemini', 'cloud-master-key-16'),
  });

  try {
    await hydrateRuntimeSettings({ repositories });
    assert.equal(process.env.GEMINI_API_KEY, 'persisted-gemini');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
