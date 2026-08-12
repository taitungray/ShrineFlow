import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCopy } from '../lib/copy-format.js';

test('formats a one-line Facebook copy into readable paragraphs', () => {
  const result = formatCopy('第一句介紹作品與神明。第二句補充工藝細節。第三句邀請大家留言分享。', 'facebook');
  assert.equal(result, '第一句介紹作品與神明。 第二句補充工藝細節。\n\n第三句邀請大家留言分享。');
});

test('keeps Reel blessing lines separated', () => {
  const result = formatCopy('這是一段短影音介紹作品。影片祝福：🙏 願平安常在。✨ 願所行皆順。', 'reel');
  assert.equal(result, '這是一段短影音介紹作品。\n\n影片祝福：\n🙏 願平安常在。\n✨ 願所行皆順。');
});
