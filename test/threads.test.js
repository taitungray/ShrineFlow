import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createThreadsPublisher,
  ThreadsPublishError,
} from '../lib/threads.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('publishes text-only threads post', async () => {
  const calls = [];
  const publisher = createThreadsPublisher({
    userId: 'th-1',
    accessToken: 'token',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ href: String(url), options });
      if (String(url).includes('/threads_publish')) {
        return jsonResponse({ id: 'thr-9' });
      }
      return jsonResponse({ id: 'container-t' });
    },
  });

  const result = await publisher.publish(
    { facebook: '純文字' },
    { mediaWebPaths: [] },
  );

  assert.deepEqual(result, { externalId: 'thr-9', scheduled: false });
  assert.equal(calls[0].href, 'https://graph.threads.net/v1.0/th-1/threads');
  assert.equal(calls[0].options.body.get('media_type'), 'TEXT');
  assert.equal(calls[0].options.body.get('text'), '純文字');
  assert.equal(calls[1].options.body.get('creation_id'), 'container-t');
  assert.ok(calls.some(({ href }) => href.includes('/threads_publish')));
});

test('publishes one image using the public media base URL', async () => {
  const calls = [];
  const publisher = createThreadsPublisher({
    userId: 'th-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://tunnel.example/',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ href: String(url), options });
      return jsonResponse({
        id: String(url).includes('/threads_publish') ? 'thr-image' : 'container-image',
      });
    },
  });

  const result = await publisher.publish(
    { facebook: '圖片文案' },
    { mediaWebPaths: ['/uploads/a.jpg'] },
  );

  assert.equal(calls[0].options.body.get('media_type'), 'IMAGE');
  assert.equal(calls[0].options.body.get('image_url'), 'https://tunnel.example/uploads/a.jpg');
  assert.equal(calls[0].options.body.get('text'), '圖片文案');
  assert.equal(result.externalId, 'thr-image');
});

test('publishes one video with VIDEO media type', async () => {
  const calls = [];
  const publisher = createThreadsPublisher({
    userId: 'th-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://cdn.example',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ href: String(url), options });
      return jsonResponse({
        id: String(url).includes('/threads_publish') ? 'thr-video' : 'container-video',
      });
    },
  });

  await publisher.publish(
    { facebook: '影片文案' },
    { mediaWebPaths: ['/uploads/a.mp4'] },
  );

  assert.equal(calls[0].options.body.get('media_type'), 'VIDEO');
  assert.equal(calls[0].options.body.get('video_url'), 'https://cdn.example/uploads/a.mp4');
});

test('rejects invalid public media base URL', async () => {
  let fetchCalls = 0;
  const publisher = createThreadsPublisher({
    userId: 'th-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'not-a-url',
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
  });

  await assert.rejects(
    () => publisher.publish(
      { facebook: 'x' },
      { mediaWebPaths: ['/uploads/a.jpg'] },
    ),
    (error) => error instanceof ThreadsPublishError
      && /PUBLIC_MEDIA_BASE_URL|公開|網址/.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test('rejects media publish when public media base is missing', async () => {
  let fetchCalls = 0;
  const publisher = createThreadsPublisher({
    userId: 'th-1',
    accessToken: 'token',
    publicMediaBaseUrl: '',
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
  });

  await assert.rejects(
    () => publisher.publish(
      { facebook: 'x' },
      { mediaWebPaths: ['/uploads/a.jpg'] },
    ),
    (error) => error instanceof ThreadsPublishError
      && /PUBLIC_MEDIA_BASE_URL|公開/.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test('verify requests the configured Threads identity and username', async () => {
  let request;
  const publisher = createThreadsPublisher({
    userId: 'th-1',
    accessToken: 'token',
    graphBaseUrl: 'https://threads.example/',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ id: 'th-1', username: 'shrine.flow' });
    },
  });

  assert.equal(publisher.configured, true);
  assert.deepEqual(await publisher.verify(), { id: 'th-1', username: 'shrine.flow' });
  assert.equal(String(request.url), 'https://threads.example/v1.0/th-1?fields=id%2Cusername');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer token');
});

test('rejects multiple or unsupported media items', async () => {
  const publisher = createThreadsPublisher({
    userId: 'th-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://cdn.example',
    fetchImpl: async () => jsonResponse({}),
  });

  await assert.rejects(
    () => publisher.publish(
      { facebook: '多媒體' },
      { mediaWebPaths: ['/uploads/a.jpg', '/uploads/b.jpg'] },
    ),
    (error) => error instanceof ThreadsPublishError && /單一/.test(error.message),
  );
  await assert.rejects(
    () => publisher.publish(
      { facebook: '文件' },
      { mediaWebPaths: ['/uploads/a.pdf'] },
    ),
    (error) => error instanceof ThreadsPublishError && /不支援/.test(error.message),
  );
});
