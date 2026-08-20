import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildIndexHtml, HTML_PARTIAL_ORDER } from '../scripts/build-html.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('buildIndexHtml accurately combines all partials and synchronizes version tags', async () => {
  const viewsDir = path.join(root, 'public', 'views');
  
  // Verify all expected partial files exist in public/views/
  for (const partial of HTML_PARTIAL_ORDER) {
    const stat = await fs.stat(path.join(viewsDir, partial));
    assert.ok(stat.size > 0, `Partial ${partial} must not be empty`);
  }

  // Build and verify result
  const result = buildIndexHtml({ version: '9.9.9' });
  assert.equal(result.partsCount, HTML_PARTIAL_ORDER.length);

  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /style\.css\?v=9\.9\.9/);
  assert.match(html, /app\.js\?v=9\.9\.9/);
  assert.match(html, /<em class="version-tag" id="appVersion">v9\.9\.9<\/em>/);
  assert.match(html, /<span class="version-tag" id="authAppVersion">v9\.9\.9<\/span>/);

  // Restore active version
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  buildIndexHtml({ version: pkg.version });
});
