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
