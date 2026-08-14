import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectDeploymentReadiness } from '../lib/deployment-readiness.js';

test('deployment readiness blocks missing secrets and flags non-HTTPS media', async () => {
  const readiness = await inspectDeploymentReadiness({
    env: { NODE_ENV: 'production', PUBLIC_MEDIA_BASE_URL: 'http://media.example.test' },
    directoriesOverride: { data: 'data', uploads: 'uploads', backups: 'backups' },
    writableCheckImpl: async () => true,
    listBackupsImpl: async () => [],
  });
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.checks.find((item) => item.id === 'master_key').status, 'fail');
  assert.equal(readiness.checks.find((item) => item.id === 'public_media_base_url').status, 'warn');
});

test('deployment readiness is ready when production prerequisites are present', async () => {
  const readiness = await inspectDeploymentReadiness({
    env: {
      NODE_ENV: 'production',
      SHRINEFLOW_MASTER_KEY: 'a-secure-master-key',
      PUBLIC_MEDIA_BASE_URL: 'https://media.example.test',
    },
    directoriesOverride: { data: 'data', uploads: 'uploads', backups: 'backups' },
    writableCheckImpl: async () => true,
    listBackupsImpl: async () => [{ id: 'backup-1' }],
  });
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.mode, 'single_operator_json');
});
