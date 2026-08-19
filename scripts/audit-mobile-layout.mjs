import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const PHONE_VIEWPORTS = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-14', width: 390, height: 844 },
];
const WEB_VIEWPORTS = [
  { name: 'tablet-900', width: 900, height: 700 },
  { name: 'desktop-1100', width: 1100, height: 720 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];
const preset = process.argv.includes('--phone')
  ? 'phone'
  : process.argv.includes('--web')
    ? 'web'
    : 'all';
const VIEWPORTS = preset === 'phone'
  ? PHONE_VIEWPORTS
  : preset === 'web'
    ? WEB_VIEWPORTS
    : [...PHONE_VIEWPORTS, ...WEB_VIEWPORTS];

const ALL_PANELS = [
  'overview',
  'composer',
  'settings',
  'drafts',
  'reviews',
  'schedule',
  'media',
  'templates',
  'campaigns',
  'publishing',
  'insights',
  'inbox',
  'platforms',
  'team',
  'errors',
  'help',
];
const panelArg = process.argv.find((arg) => arg.startsWith('--panels='));
const PANELS = panelArg
  ? panelArg.slice('--panels='.length).split(',').map((name) => name.trim()).filter(Boolean)
  : ALL_PANELS;

const INNER = {
  settings: ['gemini', 'brand', 'facebook', 'instagram', 'threads', 'backup'],
  composer: ['edit', 'preview'],
  calendar: ['month', 'week', 'list'],
  team: ['members', 'invitations', 'audit'],
};

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function mime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  }[ext] || 'application/octet-stream';
}

function auditPage() {
  const index = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const bodyMatch = index.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch?.[1] || '')
    .replace(/<section class="auth-gate"[\s\S]*?<\/section>/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mobile-audit</title>
  <link rel="stylesheet" href="/style.css" />
  <style>.is-hidden { display: none !important; }</style>
</head>
<body>
  ${bodyHtml}
  <pre id="report"></pre>
  <script>
    const PANELS = ${JSON.stringify(PANELS)};
    const INNER = ${JSON.stringify(INNER)};

    function overflowHits() {
      const limit = document.documentElement.clientWidth + 1;
      return [...document.querySelectorAll('body *')].filter((el) => {
        if (el.id === 'report') return false;
        if (el.closest('.app-sidebar, .ambient, .sidebar-scrim, .auth-gate, .visually-hidden, .mobile-bottom-nav')) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && (rect.left < -2 || rect.right > limit);
      }).slice(0, 8).map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id,
        className: String(el.className).slice(0, 80),
        left: Math.round(el.getBoundingClientRect().left),
        right: Math.round(el.getBoundingClientRect().right),
      }));
    }

    function showPanel(name) {
      document.querySelectorAll('[data-view-panel]').forEach((panel) => {
        panel.classList.toggle('is-hidden', panel.getAttribute('data-view-panel') !== name);
      });
    }

    function setSettings(page) {
      document.querySelectorAll('.settings-page').forEach((node) => {
        node.classList.toggle('is-hidden', node.dataset.settingsPage !== page);
      });
    }

    function setComposer(mode) {
      const panel = document.getElementById('composerPanel');
      if (panel) panel.dataset.composerMode = mode;
    }

    function setCalendar(view) {
      const panel = document.getElementById('schedulePanel');
      if (panel) panel.dataset.calendarView = view;
    }

    function setTeam(section) {
      document.querySelectorAll('[data-team-section-panel]').forEach((node) => {
        node.classList.toggle('is-hidden', node.getAttribute('data-team-section-panel') !== section);
      });
    }

    const results = [];
    for (const name of PANELS) {
      showPanel(name);
      const variants = [];
      if (name === 'settings') INNER.settings.forEach((page) => variants.push(() => setSettings(page)));
      else if (name === 'composer') INNER.composer.forEach((mode) => variants.push(() => setComposer(mode)));
      else if (name === 'schedule') INNER.calendar.forEach((view) => variants.push(() => setCalendar(view)));
      else if (name === 'team') INNER.team.forEach((section) => variants.push(() => setTeam(section)));
      else variants.push(() => {});

      for (let index = 0; index < variants.length; index += 1) {
        variants[index]();
        if (name === 'drafts') {
          const host = document.getElementById('postsList');
          if (host) {
            host.className = 'record-list content-list';
            if (!host.querySelector('.content-card')) {
              host.innerHTML = '<article class="record-card content-card" data-status="draft"><label class="content-select-label"><input type="checkbox" class="content-select-checkbox" aria-label="選取貼文" /></label><button class="record-card-main" type="button"><span class="record-thumb">🖼</span><span class="record-body"><strong>週末工坊體驗與預約邀請</strong><small>2026-08-18 21:10 · 排程：2026-08-20 10:00</small><span>尚未填寫文案</span><span class="content-platforms"><span class="platform-chip" data-platform="facebook">Facebook</span><span class="platform-chip" data-platform="instagram">Instagram</span></span></span></button><span class="content-card-side"><em class="content-status" data-status="draft">草稿</em><span class="content-card-actions"><button class="content-card-action" type="button">封存</button><button class="content-card-action" type="button">隱藏</button><button class="content-card-action" type="button">複製</button></span></span></article>';
            }
          }
          if (host && !document.querySelector('.list-pager')) {
            const nav = document.createElement('nav');
            nav.className = 'list-pager';
            nav.dataset.listPager = 'true';
            nav.innerHTML = '<div class="list-pager-bar" role="navigation" aria-label="內容分頁"><p class="list-pager-meta">第 21–40 筆，共 87 筆</p><div class="list-pager-controls"><button type="button" class="list-pager-nav">上一頁</button><span class="list-pager-pages"><button type="button" class="list-pager-page">1</button><button type="button" class="list-pager-page is-active">2</button><button type="button" class="list-pager-page">3</button><span class="list-pager-ellipsis">…</span><button type="button" class="list-pager-page">8</button></span><button type="button" class="list-pager-nav">下一頁</button></div></div>';
            host.after(nav);
          }
        }
        if (name === 'publishing') {
          const host = document.getElementById('publishingLogList');
          if (host) {
            host.className = 'record-list content-list publishing-log-list';
            if (!host.querySelector('.publishing-log-card')) {
              host.innerHTML = '<article class="record-card content-card publishing-log-card" data-status="scheduled"><button class="record-card-main" type="button"><span class="record-thumb">🖼</span><span class="record-body"><strong>週末工坊體驗與預約邀請</strong><small>Facebook 粉專 · 貼文 · 排程：2026-08-20 10:00</small><span>親手為神像上色完成！看到成品的那一刻，心中滿滿的成就感與恭敬。細心彩繪出金耀戰甲與莊嚴神韻…</span><span class="content-platforms"><span class="platform-chip" data-platform="facebook">Facebook</span></span></span></button><span class="content-card-side"><em class="content-status" data-status="scheduled">已排程</em><span class="content-card-actions"><button class="content-card-action" type="button">查看內容</button><button class="content-card-action" type="button">前往日曆</button></span></span></article>';
            }
          }
        }
        document.body.offsetHeight;
        const hits = overflowHits();
        const scrollOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const extra = [];
        const topbar = document.querySelector('.topbar');
        if (topbar && topbar.scrollWidth > topbar.clientWidth + 2) extra.push('topbar clips actions');
        const heading = document.querySelector('.page-heading');
        if (heading && window.innerWidth >= 768 && getComputedStyle(heading).display === 'none') {
          extra.push('page title hidden on web');
        }
        if (name === 'composer' && window.innerWidth >= 1100) {
          const editor = document.querySelector('.composer-editor-pane');
          const preview = document.querySelector('.composer-preview-pane');
          const dock = document.querySelector('.composer-dock');
          const editorBox = editor?.getBoundingClientRect();
          const previewBox = preview?.getBoundingClientRect();
          const editorHidden = !editor || getComputedStyle(editor).display === 'none';
          const previewHidden = !preview || getComputedStyle(preview).display === 'none';
          if (editorHidden || previewHidden) extra.push('desktop composer must show both panes');
          if (editorBox && editorBox.height < 80) extra.push('editor pane collapsed');
          if (previewBox && previewBox.height < 80) extra.push('preview pane collapsed');
          if (dock) {
            const dockBox = dock.getBoundingClientRect();
            if (dockBox.bottom > window.innerHeight + 4) extra.push('composer dock clipped below viewport');
            if (dockBox.right > window.innerWidth + 2) extra.push('composer dock overflows right');
          }
        }
        if (name === 'settings') {
          const tabs = [...document.querySelectorAll('.settings-tab')];
          const clipped = tabs.filter((tab) => {
            const box = tab.getBoundingClientRect();
            return box.width > 2 && (box.left < -2 || box.right > window.innerWidth + 2);
          });
          if (clipped.length) extra.push('settings tabs overflow');
        }
        if (name === 'schedule') {
          const days = document.querySelector('.calendar-weekdays, .calendar-days');
          if (days && days.scrollWidth > days.clientWidth + 2) extra.push('calendar grid overflows');
        }
        if (hits.length || scrollOverflow > 2 || extra.length) {
          results.push({ panel: name, variant: index, scrollOverflow, hits, extra });
        }
      }
    }

    const payload = {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      failCount: results.length,
      results: results,
    };
    document.getElementById('report').textContent = JSON.stringify(payload);
    document.title = 'AUDIT:' + JSON.stringify(payload);
  </script>
</body>
</html>`;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__audit') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(auditPage());
        return;
      }
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const filePath = path.normalize(path.join(publicDir, rel));
      if (!filePath.startsWith(publicDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (error, data) => {
        if (error) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': mime(filePath) });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function runBrowser(browser, url, width, height) {
  const mobile = width < 768;
  const userAgent = mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  return new Promise((resolve, reject) => {
    const child = spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=20000',
      `--window-size=${width},${height}`,
      `--user-agent=${userAgent}`,
      `--dump-dom`,
      url,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !stdout.includes('AUDIT:')) {
        reject(new Error(stderr || `browser exited ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseReport(dom) {
  const titled = dom.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
  if (titled.startsWith('AUDIT:')) {
    return JSON.parse(titled.slice('AUDIT:'.length).replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  }
  const pre = dom.match(/<pre id="report">([\s\S]*?)<\/pre>/i)?.[1] || '';
  if (!pre) throw new Error('audit report missing from dump-dom');
  return JSON.parse(pre.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}

const browser = findBrowser();
if (!browser) {
  console.log('SKIP: no Edge/Chrome for visual overflow audit');
  process.exit(0);
}

const { server, port } = await startServer();
const failures = [];
try {
  for (const viewport of VIEWPORTS) {
    const url = `http://127.0.0.1:${port}/__audit`;
    const dom = await runBrowser(browser, url, viewport.width, viewport.height);
    const report = parseReport(dom);
    console.log(`${viewport.name} ${viewport.width}x${viewport.height} failCount=${report.failCount}`);
    if (report.failCount) {
      console.log(JSON.stringify(report.results, null, 2));
      failures.push({ viewport: viewport.name, ...report });
    }
  }
} finally {
  server.close();
}

if (failures.length) {
  console.error('LAYOUT_OVERFLOW', failures.length, 'viewport(s)');
  process.exit(1);
}
console.log('OK: no overflow across audited panels and tabs');
