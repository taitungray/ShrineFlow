import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertFacebookScheduleWindow,
  createFacebookPublisher,
  FacebookPublishError,
  formatFacebookMessage,
} from '../lib/facebook.js';

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
  assert.deepEqual(result, { externalId: '12345_67890', type: 'feed', scheduled: false });
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
    assert.deepEqual(result, { externalId: 'post-1', photoId: 'photo-1', type: 'photo', scheduled: false });
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
    assert.deepEqual(result, { externalId: 'post-1', photoIds: ['photo-1', 'photo-2'], type: 'multi-photo', scheduled: false });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('schedules a multi-photo post as unpublished temporary photos then a scheduled feed', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'facebook-scheduled-multi-photo-'));
  const imagePaths = [path.join(temporaryDirectory, 'one.jpg'), path.join(temporaryDirectory, 'two.png')];
  await Promise.all(imagePaths.map((filePath) => fs.writeFile(filePath, Buffer.from([1, 2, 3]))));
  const requests = [];
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

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
    const result = await publisher.publish(
      { facebook: '排程多圖' },
      { mediaFilePaths: imagePaths, scheduledAt },
    );
    assert.equal(requests.length, 3);
    assert.equal(requests[0].options.body.get('published'), 'false');
    assert.equal(requests[0].options.body.get('temporary'), 'true');
    assert.equal(requests[1].options.body.get('published'), 'false');
    assert.equal(requests[1].options.body.get('temporary'), 'true');
    assert.equal(requests[2].options.body.get('published'), 'false');
    assert.equal(requests[2].options.body.get('unpublished_content_type'), 'SCHEDULED');
    assert.equal(
      requests[2].options.body.get('scheduled_publish_time'),
      String(Math.floor(new Date(scheduledAt).getTime() / 1000)),
    );
    assert.equal(result.type, 'multi-photo');
    assert.equal(result.scheduled, true);
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
    assert.deepEqual(result, { externalId: 'video-1', videoId: 'video-1', type: 'video', scheduled: false });
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

test('publishes a reel through the resumable video_reels flow', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'facebook-reel-'));
  const videoPath = path.join(temporaryDirectory, 'reel.mp4');
  await fs.writeFile(videoPath, Buffer.from([1, 2, 3, 4]));
  const requests = [];

  try {
    const publisher = createFacebookPublisher({
      pageId: '12345',
      pageAccessToken: 'secret-token',
      graphVersion: 'v25.0',
      fetchImpl: async (url, options) => {
        requests.push({ url: String(url), options });
        const href = String(url);
        if (href.endsWith('/12345/video_reels') && options.body?.get?.('upload_phase') === 'start') {
          return new Response(JSON.stringify({
            video_id: 'reel-video-1',
            upload_url: 'https://rupload.facebook.com/video-upload/v25.0/reel-video-1',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (href.includes('rupload.facebook.com')) {
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (href.endsWith('/12345/video_reels') && options.body?.get?.('upload_phase') === 'finish') {
          return new Response(JSON.stringify({ success: true, post_id: 'reel-post-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: { message: 'unexpected ' + href } }), { status: 400 });
      },
    });

    const result = await publisher.publish(
      { reel: 'Reel 文案 #測試', hashtags: ['#測試'] },
      { contentType: 'reel', mediaFilePaths: [videoPath] },
    );

    assert.equal(requests.length, 3);
    assert.equal(requests[0].url.endsWith('/12345/video_reels'), true);
    assert.equal(requests[0].options.body.get('upload_phase'), 'start');
    assert.equal(requests[1].url.includes('rupload.facebook.com'), true);
    assert.equal(requests[1].options.headers.offset, '0');
    assert.equal(requests[1].options.headers.file_size, '4');
    assert.equal(requests[2].options.body.get('upload_phase'), 'finish');
    assert.equal(requests[2].options.body.get('video_id'), 'reel-video-1');
    assert.equal(requests[2].options.body.get('video_state'), 'PUBLISHED');
    assert.equal(requests[2].options.body.get('description'), 'Reel 文案 #測試');
    assert.deepEqual(result, {
      externalId: 'reel-post-1',
      videoId: 'reel-video-1',
      postId: 'reel-post-1',
      type: 'reel',
      scheduled: false,
    });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('publishes a photo story via unpublished photo then photo_stories', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'facebook-story-'));
  const imagePath = path.join(temporaryDirectory, 'story.jpg');
  await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const requests = [];

  try {
    const publisher = createFacebookPublisher({
      pageId: '12345',
      pageAccessToken: 'secret-token',
      fetchImpl: async (url, options) => {
        requests.push({ url: String(url), options });
        if (String(url).endsWith('/photos')) {
          return new Response(JSON.stringify({ id: 'photo-story-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ success: true, post_id: 'story-post-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const result = await publisher.publish(
      { facebook: 'ignored for story' },
      { contentType: 'story', mediaFilePaths: [imagePath] },
    );

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url.endsWith('/photos'), true);
    assert.equal(requests[0].options.body.get('published'), 'false');
    assert.equal(requests[1].url.endsWith('/photo_stories'), true);
    assert.equal(requests[1].options.body.get('photo_id'), 'photo-story-1');
    assert.deepEqual(result, {
      externalId: 'story-post-1',
      photoId: 'photo-story-1',
      postId: 'story-post-1',
      type: 'photo-story',
      scheduled: false,
    });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('publishes a video story through video_stories resumable upload', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'facebook-video-story-'));
  const videoPath = path.join(temporaryDirectory, 'story.mp4');
  await fs.writeFile(videoPath, Buffer.from([9, 8, 7]));
  const requests = [];

  try {
    const publisher = createFacebookPublisher({
      pageId: '12345',
      pageAccessToken: 'secret-token',
      fetchImpl: async (url, options) => {
        requests.push({ url: String(url), options });
        const href = String(url);
        if (href.endsWith('/video_stories') && options.body?.get?.('upload_phase') === 'start') {
          return new Response(JSON.stringify({
            video_id: 'story-video-1',
            upload_url: 'https://rupload.facebook.com/video-upload/v25.0/story-video-1',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (href.includes('rupload.facebook.com')) {
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: true, post_id: 'story-v-post-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const result = await publisher.publish({}, { contentType: 'story', mediaFilePaths: [videoPath] });
    assert.equal(requests[0].url.endsWith('/video_stories'), true);
    assert.equal(requests[2].options.body.get('video_id'), 'story-video-1');
    assert.deepEqual(result, {
      externalId: 'story-v-post-1',
      videoId: 'story-video-1',
      postId: 'story-v-post-1',
      type: 'video-story',
      scheduled: false,
    });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('assertFacebookScheduleWindow rejects times sooner than 10 minutes', () => {
  const now = new Date('2026-08-13T12:00:00.000Z');
  assert.throws(
    () => assertFacebookScheduleWindow(new Date(now.getTime() + 5 * 60 * 1000).toISOString(), now),
    /10 分鐘/,
  );
});

test('rejects scheduled reel before upload when schedule time is too soon', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'facebook-reel-schedule-'));
  const videoPath = path.join(temporaryDirectory, 'reel.mp4');
  await fs.writeFile(videoPath, Buffer.from([1, 2, 3, 4]));
  let fetchCalls = 0;

  try {
    const publisher = createFacebookPublisher({
      pageId: '12345',
      pageAccessToken: 'secret-token',
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ id: 'unexpected' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const scheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await assert.rejects(
      () => publisher.publish(
        { reel: '排程 Reel' },
        { contentType: 'reel', mediaFilePaths: [videoPath], scheduledAt },
      ),
      (error) => error instanceof FacebookPublishError && /10 分鐘/.test(error.message),
    );
    assert.equal(fetchCalls, 0);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('throws when scheduled feed publish returns no id', async () => {
  let fetchCalls = 0;
  const publisher = createFacebookPublisher({
    pageId: '12345',
    pageAccessToken: 'secret-token',
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  await assert.rejects(
    () => publisher.publish({ facebook: '排程貼文' }, { scheduledAt }),
    (error) => error instanceof FacebookPublishError && /排程 ID/.test(error.message),
  );
  assert.equal(fetchCalls, 1);
});

test('schedules a text feed post with published=false and scheduled_publish_time', async () => {
  let body;
  const publisher = createFacebookPublisher({
    pageId: '12345',
    pageAccessToken: 'secret-token',
    fetchImpl: async (url, options) => {
      body = options.body;
      return new Response(JSON.stringify({ id: '12345_999' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const result = await publisher.publish(
    { facebook: '排程貼文' },
    { scheduledAt },
  );
  assert.equal(body.get('published'), 'false');
  assert.equal(body.get('unpublished_content_type'), 'SCHEDULED');
  assert.equal(body.get('scheduled_publish_time'), String(Math.floor(new Date(scheduledAt).getTime() / 1000)));
  assert.equal(result.externalId, '12345_999');
  assert.equal(result.scheduled, true);
});

test('deleteScheduled sends DELETE for the external id', async () => {
  let request;
  const publisher = createFacebookPublisher({
    pageId: '12345',
    pageAccessToken: 'secret-token',
    fetchImpl: async (url, options) => {
      request = { url: String(url), method: options.method };
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  await publisher.deleteScheduled('12345_999');
  assert.equal(request.method, 'DELETE');
  assert.match(request.url, /\/12345_999$/);
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
