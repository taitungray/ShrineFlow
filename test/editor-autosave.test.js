import test from 'node:test';
import assert from 'node:assert/strict';

function installStorage() {
  const memory = new Map();
  global.localStorage = {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(String(key), String(value));
    },
    removeItem(key) {
      memory.delete(String(key));
    },
    clear() {
      memory.clear();
    },
  };
  return memory;
}

test('formatSavedAt shows clock time for today and keeps the date when older', async () => {
  installStorage();
  const { formatSavedAt, savedStatusLabel } = await import('../public/modules/editor-autosave.js');
  const now = new Date(2026, 7, 18, 21, 0, 0);
  assert.equal(formatSavedAt(new Date(2026, 7, 18, 13, 27, 0).toISOString(), now), '13:27');
  assert.equal(formatSavedAt(new Date(2026, 0, 5, 9, 8, 0).toISOString(), now), '1月5日 09:08');
  assert.equal(formatSavedAt(new Date(2024, 0, 2, 3, 4, 0).toISOString(), now), '2024年1月2日 03:04');
  assert.equal(formatSavedAt('', now), '');
  assert.equal(savedStatusLabel('已自動儲存', new Date(2026, 7, 18, 13, 27, 0).toISOString(), now), '已自動儲存 · 13:27');
  assert.equal(savedStatusLabel('已載入草稿', '', now), '已載入草稿');
});

test('restoreRecoverySnapshotForPost merges local snapshot onto saved post', async () => {
  installStorage();
  const { state } = await import('../public/modules/state.js');
  const {
    setAutosaveDependencies,
    writeRecoverySnapshot,
    restoreRecoverySnapshotForPost,
  } = await import('../public/modules/editor-autosave.js');

  const post = {
    id: 'post-recover',
    status: 'draft',
    version: 2,
    facebook: '伺服器舊文案',
    contentTopic: '邢府四千歲',
  };
  state.currentClientId = 'client-a';
  state.savedPost = post;
  state.editorDirty = true;
  setAutosaveDependencies({
    getDraft: () => ({
      facebook: '本機未存文案',
      contentTopic: '邢府四千歲',
    }),
  });
  writeRecoverySnapshot();

  const recovered = restoreRecoverySnapshotForPost(post);
  assert.equal(recovered.facebook, '本機未存文案');
  assert.equal(recovered.contentTopic, '邢府四千歲');
  assert.equal(recovered.id, 'post-recover');
  assert.equal(restoreRecoverySnapshotForPost({ ...post, status: 'archived' }), null);
  assert.equal(restoreRecoverySnapshotForPost({ id: 'post-missing', status: 'draft' }), null);
});
