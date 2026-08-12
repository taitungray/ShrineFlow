import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFacebookPublisher, FacebookPublishError, formatFacebookMessage } from '../lib/facebook.js';

test('formatFacebookMessage appends only missing hashtags', () => {
  const message = formatFacebookMessage({
    facebook: '作品完成 #神像彩繪',
    hashtags: ['#神像彩繪', '#宮廟藝術', '#宮廟藝術'],
  });
  assert.equal(message, '作品完成 #神像彩繪\n\n#宮廟藝術');
});

test('publishes a text post to the page feed without putting the token in the URL', async () => {
  let request;
  const publisher = createFacebookPublisher({
    pageId: '12345',
    pageAccessToken: 'secret-token',
    graphVersion: 'v25.0',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: '12345_67890' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await publisher.publish({ facebook: '測試貼文', hashtags: ['#測試'] });
  assert.equal(String(request.url), 'https://graph.facebook.com/v25.0/12345/feed');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
  assert.equal(String(request.url).includes('secret-token'), false);
  assert.equal(request.options.body.get('message'), '測試貼文\n\n#測試');
  assert.deepEqual(result, { externalId: '12345_67890', type: 'feed' });
});

test('uploads a local image to the page photos endpoint', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'facebook-publisher-'));
  const imagePath = path.join(temporaryDirectory, 'sample.jpg');
  await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let request;

  try {
    const publisher = createFacebookPublisher({
      pageId: '12345',
      pageAccessToken: 'secret-token',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({ id: 'photo-1', post_id: 'post-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const result = await publisher.publish({ facebook: '圖片貼文' }, { imageFilePath: imagePath });
    assert.equal(String(request.url).endsWith('/12345/photos'), true);
    assert.equal(request.options.body instanceof FormData, true);
    assert.equal(request.options.body.get('caption'), '圖片貼文');
    assert.equal(request.options.body.get('source').type, 'image/jpeg');
    assert.deepEqual(result, { externalId: 'post-1', photoId: 'photo-1', type: 'photo' });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('publishes multiple local images as one Facebook post', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'facebook-multi-photo-'));
  const imagePaths = [path.join(temporaryDirectory, 'one.jpg'), path.join(temporaryDirectory, 'two.png')];
  await Promise.all(imagePaths.map((filePath) => fs.writeFile(filePath, Buffer.from([1, 2, 3]))));
  const requests = [];

  try {
    const publisher = createFacebookPublisher({
      pageId: '12345',
      pageAccessToken: 'secret-token',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        const endpoint = String(url).endsWith('/photos') ? { id: 'photo-' + requests.length } : { id: 'post-1' };
        return new Response(JSON.stringify(endpoint), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const result = await publisher.publish({ facebook: '多圖貼文' }, { mediaFilePaths: imagePaths });
    assert.equal(requests.length, 3);
    assert.equal(requests[0].options.body.get('published'), 'false');
    assert.equal(requests[1].options.body.get('published'), 'false');
    assert.equal(requests[2].options.body.get('attached_media[0]'), JSON.stringify({ media_fbid: 'photo-1' }));
    assert.equal(requests[2].options.body.get('attached_media[1]'), JSON.stringify({ media_fbid: 'photo-2' }));
    assert.deepEqual(result, { externalId: 'post-1', photoIds: ['photo-1', 'photo-2'], type: 'multi-photo' });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('publishes one local video to the page videos endpoint', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'facebook-video-'));
  const videoPath = path.join(temporaryDirectory, 'clip.mp4');
  await fs.writeFile(videoPath, Buffer.from([1, 2, 3]));
  let request;

  try {
    const publisher = createFacebookPublisher({
      pageId: '12345',
      pageAccessToken: 'secret-token',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({ id: 'video-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const result = await publisher.publish({ facebook: '影片貼文' }, { mediaFilePaths: [videoPath] });
    assert.equal(String(request.url).endsWith('/12345/videos'), true);
    assert.equal(request.options.body.get('description'), '影片貼文');
    assert.equal(request.options.body.get('source').type, 'video/mp4');
    assert.deepEqual(result, { externalId: 'video-1', videoId: 'video-1', type: 'video' });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('verifies the configured page identity', async () => {
  let request;
  const publisher = createFacebookPublisher({
    pageId: '12345',
    pageAccessToken: 'secret-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: '12345', name: '測試粉專' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.deepEqual(await publisher.verify(), { id: '12345', name: '測試粉專' });
  assert.equal(request.options.method, 'GET');
  assert.equal(request.url.searchParams.get('fields'), 'id,name');
});

test('marks transient Graph API failures as retriable', async () => {
  const publisher = createFacebookPublisher({
    pageId: '12345',
    pageAccessToken: 'secret-token',
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: 'Please retry', code: 2, is_transient: true, fbtrace_id: 'trace-1' },
    }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
  });

  await assert.rejects(
    () => publisher.publish({ facebook: '測試' }),
    (error) => error instanceof FacebookPublishError && error.retriable && error.traceId === 'trace-1',
  );
});
