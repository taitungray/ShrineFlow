import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInstagramPublisher,
  InstagramPublishError,
} from '../lib/instagram.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('publishes a single-image feed post via container then media_publish', async () => {
  const calls = [];
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    graphVersion: 'v25.0',
    publicMediaBaseUrl: 'https://tunnel.example',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/ig-1/media')) return jsonResponse({ id: 'container-1' });
      if (href.includes('/container-1?')) return jsonResponse({ status_code: 'FINISHED' });
      if (href.endsWith('/ig-1/media_publish')) return jsonResponse({ id: 'media-9' });
      return jsonResponse({ error: { message: `unexpected ${href}` } }, 404);
    },
  });

  const result = await publisher.publish(
    { facebook: '你好' },
    { contentType: 'feed', mediaWebPaths: ['/uploads/a.jpg'] },
  );

  assert.deepEqual(result, { externalId: 'media-9', scheduled: false });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.body.get('image_url'), 'https://tunnel.example/uploads/a.jpg');
  assert.equal(calls[0].options.body.get('caption'), '你好');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(new URL(calls[1].href).searchParams.get('fields'), 'status_code');
  assert.equal(calls[2].options.body.get('creation_id'), 'container-1');
});

test('rejects publish when public media base is missing', async () => {
  let fetchCalls = 0;
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
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
      { contentType: 'feed', mediaWebPaths: ['/uploads/a.jpg'] },
    ),
    /PUBLIC_MEDIA_BASE_URL|公開/,
  );
  assert.equal(fetchCalls, 0);
});

test('verify requests the configured Instagram identity and username', async () => {
  let request;
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    graphBaseUrl: 'https://graph.example/',
    graphVersion: 'v25.0',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ id: 'ig-1', username: 'shrine.flow' });
    },
  });

  assert.deepEqual(await publisher.verify(), { id: 'ig-1', username: 'shrine.flow' });
  assert.equal(String(request.url), 'https://graph.example/v25.0/ig-1?fields=id%2Cusername');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer token');
});

test('publishes a reel with REELS media type and reel caption', async () => {
  const calls = [];
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://cdn.example',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/ig-1/media')) return jsonResponse({ id: 'reel-container' });
      if (href.includes('/reel-container?')) return jsonResponse({ status_code: 'FINISHED' });
      return jsonResponse({ id: 'reel-media' });
    },
  });

  const result = await publisher.publish(
    { facebook: 'feed 文案', reel: 'reel 文案' },
    { contentType: 'reel', mediaWebPaths: ['/uploads/reel.mp4'] },
  );

  assert.equal(calls[0].options.body.get('media_type'), 'REELS');
  assert.equal(calls[0].options.body.get('video_url'), 'https://cdn.example/uploads/reel.mp4');
  assert.equal(calls[0].options.body.get('caption'), 'reel 文案');
  assert.deepEqual(result, { externalId: 'reel-media', scheduled: false });
});

test('publishes story without caption even when post.facebook is set', async () => {
  const calls = [];
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://cdn.example',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/ig-1/media')) return jsonResponse({ id: 'story-container' });
      if (href.includes('/story-container?')) return jsonResponse({ status_code: 'FINISHED' });
      return jsonResponse({ id: 'story-media' });
    },
  });

  await publisher.publish(
    { facebook: 'should-not-appear' },
    { contentType: 'story', mediaWebPaths: ['/uploads/story.jpg'] },
  );

  assert.equal(calls[0].options.body.get('media_type'), 'STORIES');
  assert.equal(calls[0].options.body.get('image_url'), 'https://cdn.example/uploads/story.jpg');
  assert.equal(calls[0].options.body.has('caption'), false);
});

test('publishes one image story with STORIES media type', async () => {
  const calls = [];
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://cdn.example',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/ig-1/media')) return jsonResponse({ id: 'story-container' });
      if (href.includes('/story-container?')) return jsonResponse({ status_code: 'FINISHED' });
      return jsonResponse({ id: 'story-media' });
    },
  });

  await publisher.publish(
    {},
    { contentType: 'story', mediaWebPaths: ['/uploads/story.jpg'] },
  );

  assert.equal(calls[0].options.body.get('media_type'), 'STORIES');
  assert.equal(calls[0].options.body.get('image_url'), 'https://cdn.example/uploads/story.jpg');
  assert.equal(calls[0].options.body.has('caption'), false);
});

test('publishes multiple feed images as child containers and a carousel', async () => {
  const calls = [];
  let mediaCalls = 0;
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://cdn.example',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/ig-1/media')) {
        mediaCalls += 1;
        return jsonResponse({ id: mediaCalls < 3 ? `child-${mediaCalls}` : 'carousel-1' });
      }
      if (href.includes('/carousel-1?')) return jsonResponse({ status_code: 'FINISHED' });
      return jsonResponse({ id: 'carousel-media' });
    },
  });

  await publisher.publish(
    { facebook: '多圖' },
    { contentType: 'feed', mediaWebPaths: ['/uploads/a.jpg', '/uploads/b.png'] },
  );

  assert.equal(calls[0].options.body.get('is_carousel_item'), 'true');
  assert.equal(calls[1].options.body.get('is_carousel_item'), 'true');
  assert.equal(calls[2].options.body.get('media_type'), 'CAROUSEL');
  assert.equal(calls[2].options.body.get('children'), 'child-1,child-2');
  assert.equal(calls[2].options.body.get('caption'), '多圖');
});

test('rejects missing media and stories with more than one media item', async () => {
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://cdn.example',
    fetchImpl: async () => jsonResponse({}),
  });

  await assert.rejects(
    () => publisher.publish({}, { contentType: 'feed', mediaWebPaths: [] }),
    (error) => error instanceof InstagramPublishError && /至少一個媒體/.test(error.message),
  );
  await assert.rejects(
    () => publisher.publish(
      {},
      { contentType: 'story', mediaWebPaths: ['/uploads/a.jpg', '/uploads/b.jpg'] },
    ),
    (error) => error instanceof InstagramPublishError && /恰好一個媒體/.test(error.message),
  );
});

test('wraps Graph API errors with code and retriable state', async () => {
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    fetchImpl: async () => jsonResponse({
      error: { message: 'Please retry', code: 2, is_transient: true },
    }, 500),
  });

  await assert.rejects(
    () => publisher.verify(),
    (error) => error instanceof InstagramPublishError
      && error.message === 'Please retry'
      && error.code === 2
      && error.retriable,
  );
});
