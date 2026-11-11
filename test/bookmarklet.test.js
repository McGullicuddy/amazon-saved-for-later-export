/* Headless-Chrome check of the SHIPPED bookmarklet: src/bookmarklet.js as built by
   scripts/build.mjs, run against test/fixture-cart.html (synthetic data only).

   Run (from the repo root):   npm test      (which runs: node test/bookmarklet.test.js)

   Needs the Playwright dev dependency and its cached Chromium. Chrome runs with
   --no-sandbox only because it loads nothing but our local fixture: every other request
   is blocked by the network guard below.

   Network guard: every request from every page goes through one route, and every WebSocket
   through a second one. Service workers are blocked, since they could answer requests
   without the route seeing them. Only an exact fixture load (a mapped host, the server's
   port, /cart.html, no query string) reaches the local server. Anything else is recorded
   and aborted. That covers the fixture's synthetic picture URLs, which name real CDN
   hostnames, and anything the bookmarklet might try to send, by any means: fetch, an <img>, a
   script, a WebSocket, a navigation or a popup. A request counts as the page's own only
   while that page is being opened. Everything else counts as the bookmarklet's, and the test
   fails if there is one. Positive controls prove the guard sees an image request and a
   WebSocket made from page script.

   What is tested is what ships: the built (comment-stripped) source is evaluated in the
   page, and the file the "Download file" button produces is captured through Playwright's
   download event.

   Hostname guard: instead of a test hook in the shipped code, Chrome is told to resolve
   several Amazon-looking hostnames to 127.0.0.1 (--host-resolver-rules) and the fixture is
   served over plain http at http://<host>:<port>/cart.html. The guard only checks the
   hostname. */
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BuildError, bookmarkletFile, buildBookmarklet, renderInstallPage } from '../scripts/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = readFileSync(join(ROOT, 'test', 'fixture-cart.html'));
const OVERLAY = '#saved-for-later-export-overlay';
const LONG_TITLE = 'Long title word '.repeat(25).slice(0, 399) + '!';

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Hostnames Chrome resolves to the local server (see "Hostname guard" above). */
const MAPPED_HOSTS = ['www.amazon.com', 'www.amazon.co.uk', 'amazon.com.evil.example'];
const FIXTURE_HOSTS = new Set([...MAPPED_HOSTS, '127.0.0.1']);

/* What the network guard saw. `loading` holds the pages openFixture is opening right now:
   their requests are the fixture's own. Everything else, including popups and requests
   that can't be tied to a page, counts as the bookmarklet's, so the guard fails closed.
   `control` marks the positive controls at the end. */
const network = { blocked: [], loading: new WeakSet(), control: false };

function phaseOf(request) {
  if (network.control) { return 'control'; }
  let page = null;
  try { page = request.frame().page(); } catch { /* not from a page frame, e.g. a worker */ }
  return page && network.loading.has(page) ? 'page load' : 'bookmarklet';
}

/* Only an exact fixture load passes, so nothing can be smuggled out to the local server
   in a path or query string either. */
function isFixtureLoad(url, port) {
  return FIXTURE_HOSTS.has(url.hostname) && url.port === String(port) &&
    url.pathname === '/cart.html' && url.search === '';
}

async function guardNetwork(context, port) {
  await context.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (isFixtureLoad(url, port)) { return route.continue(); }
    network.blocked.push({ phase: phaseOf(request), url: url.href });
    return route.abort();
  });
  /* WebSockets don't pass through route(). Record each one and close it without ever
     connecting. The fixture opens none, so outside a control every one is the bookmarklet's. */
  await context.routeWebSocket(/.*/, (ws) => {
    network.blocked.push({ phase: network.control ? 'control' : 'bookmarklet', url: ws.url() });
    ws.close();
  });
}

/* Positive controls: wait until the guard has recorded `url`. */
async function blockedInControl(url) {
  for (let i = 0; i < 50; i++) {
    if (network.blocked.some((r) => r.phase === 'control' && r.url === url)) { return true; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/* Load the fixture and wait until its own (blocked) picture requests are over. The fixture
   has no lazy-loaded pictures, so anything the page requests after this comes from the
   bookmarklet. */
async function openFixture(page, host, port) {
  network.loading.add(page);
  await page.goto(`http://${host}:${port}/cart.html`);
  await page.waitForLoadState('networkidle');
  network.loading.delete(page);
}

/* Open the fixture under `host`, run the bookmarklet, click Download and return the parsed
   file plus what was observed on the way. */
async function exportFrom(context, port, host, bookmarklet) {
  const page = await context.newPage();
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await openFixture(page, host, port);
  await page.evaluate(bookmarklet);
  const downloadButton = page.locator(`${OVERLAY} button`, { hasText: 'Download file' });
  await downloadButton.waitFor({ timeout: 30000 });
  assert.deepStrictEqual(dialogs, [], `no alert on ${host}`);
  const overlayInfo = await page.evaluate((sel) => {
    const o = document.querySelector(sel);
    return { imgs: o.querySelectorAll('img').length, text: o.textContent };
  }, OVERLAY);
  /* Re-running while the overlay is open must not stack a second one. */
  await page.evaluate(bookmarklet);
  assert.strictEqual(await page.locator(OVERLAY).count(), 1, 'single overlay');
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
  const filename = download.suggestedFilename();
  const raw = readFileSync(await download.path(), 'utf8');
  return { page, overlayInfo, filename, raw, file: JSON.parse(raw) };
}

async function main() {
  /* ---- Build output checks, no browser needed. ---- */
  const { source: bookmarklet, url } = buildBookmarklet(readFileSync(join(ROOT, 'src', 'bookmarklet.js'), 'utf8'));
  assert(url.startsWith('javascript:'), 'built URL starts with javascript:');
  assert.strictEqual(decodeURIComponent(url.slice('javascript:'.length)), bookmarklet, 'URL decodes to the source');
  assert(!bookmarklet.includes('/*') && !bookmarklet.includes('*/'), 'built source has no comment markers');
  new Function(bookmarklet); /* parses as JavaScript (does not run it) */
  assert(!/\binnerHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b/.test(bookmarklet),
    'no HTML-string injection APIs in bookmarklet code');
  /* A first, cheap line of defence. The network guard in the browser run below is the real
     check, since a name can be disguised (window['Web' + 'Socket']). */
  assert(!/\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|window\.open|\bimport\s*\(|\.submit\(|\.src\s*=[^=]|\blocation\s*=[^=]/
    .test(bookmarklet), 'no network APIs');

  /* Install page rendering, on a tiny inline template. */
  const template = '<a href="{{BOOKMARKLET_HREF}}">v{{VERSION}} {{SIZE_KB}} KB</a>';
  const page1 = renderInstallPage(template, { url: 'javascript:a"<b>&c', version: '1.2.3' });
  assert.strictEqual(page1, '<a href="javascript:a&quot;&lt;b&gt;&amp;c">v1.2.3 0.0 KB</a>',
    'placeholders filled and href attribute-escaped');
  assert.throws(() => renderInstallPage(template + '{{UNKNOWN}}', { url, version: '1' }), BuildError,
    'a leftover placeholder throws BuildError');

  /* Checksum and commit: the page's checksum is the SHA-256 of bookmarklet.txt's exact bytes
     (computed here independently), and only a full commit SHA is accepted. */
  assert.strictEqual(bookmarkletFile(url), url + '\n');
  assert.strictEqual(renderInstallPage('{{CHECKSUM}}', { url, version: '1' }),
    createHash('sha256').update(url + '\n').digest('hex'), 'checksum is SHA-256 of bookmarklet.txt');
  const fakeCommit = '0123456789abcdef0123456789abcdef01234567';
  assert.strictEqual(renderInstallPage('{{COMMIT_SHORT}} {{COMMIT}}', { url, version: '1', commit: fakeCommit }),
    `0123456 ${fakeCommit}`);
  assert.throws(() => renderInstallPage('{{COMMIT}}', { url, version: '1', commit: 'main"><b>' }), BuildError,
    'a commit that is not a full SHA throws');

  /* The real template fills completely and keeps its Content-Security-Policy. */
  const realPage = renderInstallPage(readFileSync(join(ROOT, 'site', 'index.html'), 'utf8'),
    { url, version: '1.0.0', repoUrl: 'https://github.com/example/example', commit: fakeCommit });
  assert(!realPage.includes('{{'), 'install page has no unfilled placeholder');
  assert.match(realPage, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self';/,
    'install page keeps its CSP');
  assert(!/<script/i.test(realPage), 'install page has no scripts');
  console.log('built javascript: URL length: %d characters', url.length);

  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/cart.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fixture); }
    else { res.writeHead(404); res.end('nope'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--host-resolver-rules=' + MAPPED_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ')],
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
    await guardNetwork(context, port);

    /* ---- US storefront: full expected export. ---- */
    const us = await exportFrom(context, port, 'www.amazon.com', bookmarklet);
    assert.strictEqual(await us.page.evaluate(() => window.__xss), undefined, 'hostile title did not execute');
    assert.strictEqual(us.overlayInfo.imgs, 0, 'no <img> inside the overlay');
    assert.match(us.overlayInfo.text, /Found 18 items \(8 with pictures\)/);
    assert.strictEqual(us.filename, `amazon-saved-for-later-${localDate()}.json`, 'file name: amazon-saved-for-later-<local date>.json');
    assert(us.raw.startsWith('{\n  "format"'), 'pretty-printed with 2-space indent');
    const file = us.file;

    assert.deepStrictEqual(Object.keys(file), ['format', 'version', 'exportedAt', 'store', 'items']);
    assert.strictEqual(file.format, 'amazon-saved-for-later');
    assert.strictEqual(file.version, 2);
    assert.strictEqual(new Date(file.exportedAt).toISOString(), file.exportedAt, 'exportedAt is an ISO timestamp');
    assert(Math.abs(Date.now() - Date.parse(file.exportedAt)) < 120000, 'exportedAt is recent');
    assert.strictEqual(file.store, 'www.amazon.com', 'store is the bare hostname');
    for (const item of file.items) {
      assert.deepStrictEqual(Object.keys(item), ['asin', 'title', 'price', 'priceValue', 'images']);
      assert(/^[A-Z0-9]{10}$/.test(item.asin) && typeof item.title === 'string');
      assert(item.price === null || typeof item.price === 'string');
      assert(item.priceValue === null || (typeof item.priceValue === 'number' && item.priceValue > 0));
      assert(Array.isArray(item.images) && item.images.length <= 12);
      assert(item.images.every((u) => typeof u === 'string' && /^https?:\/\//.test(u) && u.length <= 1000));
    }

    const IMG = (s) => 'https://m.media-amazon.com/images/I/' + s;
    assert.deepStrictEqual(file.items, [
      { asin: 'B0SAVED001', title: 'Synthetic Widget with odd whitespace', price: '$19.90', priceValue: 19.9,
        images: [IMG('71abcDEF12L._AC_AA180_.jpg')] },
      { asin: 'B0SAVED002', title: 'Gadget that prices via text', price: '$5.00', priceValue: null,
        images: [IMG('81hiresXYZ._SX342_.png'), IMG('low.jpg')] },
      { asin: 'B0SAVED003', title: '<img src=x onerror=window.__xss=1> Hostile title', price: null, priceValue: null, images: [] },
      { asin: 'B0SAVED004', title: 'Link-text title item', price: null, priceValue: null,
        images: ['https://evil.example.com/images/I/71abcDEF12L._AC_AA180_.jpg'] },
      { asin: 'B0SAVED005', title: 'Item with a nested recommendation', price: null, priceValue: null,
        images: [IMG('55big._AC_UL320_.jpg'), IMG('55small._AC_UL100_.jpg'), IMG('55tiny._AC_UL50_.jpg')] },
      { asin: 'B0ROWIMG01', title: 'Picture lives in the row', price: null, priceValue: null, images: [IMG('row1._AC_UL200_.jpg')] },
      { asin: 'B0ROWNONE1', title: 'Row without a picture', price: null, priceValue: null, images: [] },
      { asin: 'B0QUERY001', title: 'Query string picture', price: null, priceValue: null,
        images: ['https://images-na.ssl-images-amazon.com/images/I/61qq1234.jpg?v=2&sz=large'] },
      { asin: 'B0DATASRC1', title: 'Lazy picture placeholder', price: null, priceValue: null, images: [IMG('lazy1._AC_UL200_.jpg')] },
      { asin: 'B0BADGE001', title: 'Badge before product picture', price: null, priceValue: null,
        images: [IMG('main1-old.jpg'), IMG('main1._AC_UL200_.jpg'), 'https://m.media-amazon.com/images/G/01/prime/badge._CB1_.png'] },
      { asin: 'B0PRICE001', title: 'Pound priced item', price: '£12.34', priceValue: 15.5, images: [] },
      { asin: 'B0PRICE002', title: 'Wordy price text item', price: '$7.00', priceValue: 7, images: [] },
      { asin: 'B0LONGTTL1', title: LONG_TITLE, price: null, priceValue: null, images: [] },
      { asin: 'B0PRICE003', title: 'Euro priced item', price: '19,99 €', priceValue: null, images: [] },
      { asin: 'B0LAZY0001', title: 'Lazy item 1', price: '$21.25', priceValue: 21.25, images: [] },
      { asin: 'B0LAZY0002', title: 'Lazy item 2', price: '$22.25', priceValue: 22.25, images: [] },
      { asin: 'B0LAZY0003', title: 'Lazy item 3', price: '$23.25', priceValue: 23.25, images: [] },
      { asin: 'B0LAZY0004', title: 'Lazy item 4', price: '$24.25', priceValue: 24.25, images: [] },
    ], 'items: order, lazy items, exclusions, dedupe, prices, untruncated title, picture candidates');
    assert.strictEqual(LONG_TITLE.length, 400);

    /* After the click: confirmation text with the file name, and no network traffic. */
    const doneText = await us.page.locator(OVERLAY).textContent();
    assert.strictEqual(doneText.trim(), `Saved ${us.filename}Close`, 'saved message names the file');
    assert.strictEqual(await us.page.locator(`${OVERLAY} button`, { hasText: 'Close' }).count(), 1);
    await us.page.locator(`${OVERLAY} button`, { hasText: 'Close' }).click();
    assert.strictEqual(await us.page.locator(OVERLAY).count(), 0, 'Close removes the overlay');
    assert.strictEqual(await us.page.evaluate(() => window.__likeClicked), false, '"See more like this" never clicked');
    assert.strictEqual(await us.page.evaluate(() => window.__seeMoreClicks), 1, 'real "See more" clicked exactly once');
    assert.strictEqual(await us.page.evaluate(() => window.__elsewhereClicked), false,
      'a "See more" link to another page is never clicked');

    /* ---- UK storefront: no "$" invented for a data-price fallback. ---- */
    const uk = await exportFrom(context, port, 'www.amazon.co.uk', bookmarklet);
    assert.strictEqual(uk.file.store, 'www.amazon.co.uk');
    const ukItem = (asin) => uk.file.items.find((i) => i.asin === asin);
    assert.strictEqual(ukItem('B0SAVED001').price, '19.90', 'data-price fallback has no $ off amazon.com');
    assert.strictEqual(ukItem('B0PRICE002').price, '7.00');
    assert.strictEqual(ukItem('B0PRICE001').price, '£12.34', 'displayed text still wins');
    assert.strictEqual(ukItem('B0SAVED001').priceValue, 19.9);

    /* ---- Lookalike host: the guard alerts and stops, no overlay. ---- */
    const other = await context.newPage();
    const otherDialogs = [];
    other.on('dialog', (d) => { otherDialogs.push(d.message()); d.dismiss(); });
    await openFixture(other, 'amazon.com.evil.example', port);
    await other.evaluate(bookmarklet);
    assert.strictEqual(otherDialogs.length, 1, 'lookalike host gets one alert');
    assert.strictEqual(await other.locator(OVERLAY).count(), 0, 'no overlay on a lookalike host');

    /* Plain non-Amazon host too. */
    const plain = await context.newPage();
    const plainDialogs = [];
    plain.on('dialog', (d) => { plainDialogs.push(d.message()); d.dismiss(); });
    await openFixture(plain, '127.0.0.1', port);
    await plain.evaluate(bookmarklet);
    assert.strictEqual(plainDialogs.length, 1, 'non-Amazon host gets one alert');
    assert.strictEqual(await plain.locator(OVERLAY).count(), 0, 'no overlay off Amazon');

    /* ---- Network: nothing left the page while the bookmarklet ran. ---- */
    assert.deepStrictEqual(network.blocked.filter((r) => r.phase === 'bookmarklet'), [],
      'the bookmarklet made no network requests');
    assert(network.blocked.some((r) => r.phase === 'page load'),
      'the guard saw the fixture\'s own picture requests (it is really intercepting)');
    assert(hits.every((h) => h === '/cart.html'), 'the server saw only fixture page loads');
    assert.strictEqual(hits.length, 4, 'one load per page opened');

    /* Positive controls: an image request and a WebSocket made from page script, the way a
       leaking bookmarklet would make them, are both caught. */
    network.control = true;
    const probe = 'https://exfil.example/probe';
    await plain.evaluate((u) => { new Image().src = u; }, probe);
    assert(await blockedInControl(probe), 'the guard records an image request made from page script');
    const socket = 'wss://exfil.example/socket';
    await plain.evaluate((u) => { new WebSocket(u); }, socket);
    assert(await blockedInControl(socket), 'the guard records a WebSocket opened from page script');

    console.log('PASS: %d items, built URL %d characters', file.items.length, url.length);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
