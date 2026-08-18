import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('scan controls use official platform icons; help filters stay text', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const help = await fs.readFile(path.join(root, 'public', 'modules', 'help.js'), 'utf8');
  const helper = await fs.readFile(path.join(root, 'public', 'modules', 'platform-icon.js'), 'utf8');
  const facebook = await fs.readFile(path.join(root, 'public', 'icons', 'facebook.svg'), 'utf8');
  const instagram = await fs.readFile(path.join(root, 'public', 'icons', 'instagram.svg'), 'utf8');
  const threads = await fs.readFile(path.join(root, 'public', 'icons', 'threads.svg'), 'utf8');

  assert.match(html, /src="\/icons\/facebook\.svg"/);
  assert.match(html, /src="\/icons\/instagram\.svg"/);
  assert.match(html, /src="\/icons\/threads\.svg"/);
  assert.match(html, /settings-tab-platform[\s\S]*aria-label="Facebook"/);
  assert.equal(html.includes('<span>Facebook</span>'), false);
  assert.equal(html.includes('<span>Instagram</span>'), false);
  assert.equal(html.includes('<span>Threads</span>'), false);

  assert.match(help, /\['facebook', 'Facebook'\]/);
  assert.match(help, /\['instagram', 'Instagram'\]/);
  assert.match(help, /\['threads', 'Threads'\]/);

  assert.match(helper, /\/icons\/' \+ escapeHtml\(id\) \+ '\.svg/);
  assert.match(facebook, /fill="#1877F2"/);
  assert.match(instagram, /id="igAppMark"/);
  assert.match(threads, /fill="#000"/);
  assert.match(threads, /M12\.186 24h/);
});
