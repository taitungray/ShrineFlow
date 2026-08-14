import crypto from 'node:crypto';
import { Router } from 'express';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMetaWebhookSignature(rawBody, signature, appSecret) {
  if (!appSecret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

export function createWebhookRouter({
  appSecret = process.env.META_APP_SECRET || '',
  verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || '',
} = {}) {
  const router = Router();

  router.get('/webhooks/meta', (request, response) => {
    const mode = String(request.query['hub.mode'] || '').trim();
    const token = String(request.query['hub.verify_token'] || '').trim();
    const challenge = String(request.query['hub.challenge'] || '');
    if (!verifyToken) return response.status(503).json({ error: '尚未設定 Meta webhook verify token。' });
    if (mode !== 'subscribe' || !safeEqual(token, verifyToken)) {
      return response.status(403).json({ error: 'Meta webhook verify token 不正確。' });
    }
    return response.status(200).send(challenge);
  });

  router.post('/webhooks/meta', (request, response) => {
    if (!appSecret) return response.status(503).json({ error: '尚未設定 Meta webhook app secret。' });
    const signature = request.get('x-hub-signature-256') || '';
    if (!verifyMetaWebhookSignature(request.rawBody, signature, appSecret)) {
      return response.status(403).json({ error: 'Meta webhook 簽章驗證失敗。' });
    }
    return response.status(200).json({ received: true, stored: false });
  });

  return router;
}
