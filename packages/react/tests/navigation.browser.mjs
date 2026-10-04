/**
 * Real-browser integration against the separately running playground.
 * node packages/react/tests/navigation.browser.mjs
 * Optional: THREADRIFT_TEST_URL, PLAYWRIGHT_MODULE (absolute module path), PLAYWRIGHT_BROWSER, PLAYWRIGHT_CHANNEL.
 * Uses rendered DOM, native wheel/keyboard input, and CDP touch input; never reads app stores.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { realpathSync, readFileSync } from 'node:fs';
import { parseGraphDocument } from '../../core/dist/index.mjs';
const browserFixture = parseGraphDocument(JSON.parse(readFileSync(new URL('./fixtures/sample-map.json', import.meta.url), 'utf8')));
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const moduleUrl = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
  : new URL('../../../.turbo/browser-tools/node_modules/playwright/index.mjs', import.meta.url).href;
const engines = await import(moduleUrl);
const engine = process.env.PLAYWRIGHT_BROWSER || 'chromium';
assert(['chromium', 'firefox', 'webkit'].includes(engine), `Unsupported browser: ${engine}`);
const baseURL = process.env.THREADRIFT_TEST_URL || 'http://localhost:3100';
const output = fileURLToPath(new URL(`../../../.turbo/browser-artifacts/${engine}/`, import.meta.url));
await mkdir(output, { recursive: true });
async function bounded(promise, label, timeout = 20000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}
console.log(`Launching ${engine} against ${baseURL}`);
let browser;
try {
  browser = await engines[engine].launch({
    ...(engine === 'chromium' ? { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' } : {}), headless: true, timeout: 30000,
  });
} catch (error) {
  await writeFile(`${output}/report.json`, JSON.stringify({ url: baseURL, browser: engine, infrastructureFailure: error.stack || String(error), results: [] }, null, 2));
  throw error;
}
const results = [];
let harnessBundle;
async function mountHarness(page) {
  if (!harnessBundle) {
    const requireFromTsup = createRequire(realpathSync(fileURLToPath(new URL('../node_modules/tsup/dist/cli-default.js', import.meta.url))));
    const { build } = requireFromTsup('esbuild');
    const result = await build({ entryPoints: [fileURLToPath(new URL('./navigation.harness.tsx', import.meta.url))],
      bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' } });
    harnessBundle = result.outputFiles[0].text;
  }
  await page.route('**/__navigation_harness.js', route => route.fulfill({ contentType: 'application/javascript', body: harnessBundle }));
  await page.route('**/__navigation_harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
    body{margin:0;background:#09090b;color:white;font:14px Arial}.fill-transparent{fill:transparent}.fill-none{fill:none}.stroke-transparent{stroke:transparent}
    .pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}.node-label-group text{fill:white}
  </style></head><body><div id="root"></div><script src="/__navigation_harness.js"></script></body></html>` }));
  await page.goto(`${baseURL}/__navigation_harness`, { waitUntil: 'networkidle' });
}

const controls = page => page.locator('[data-threadrift-controls]');
const next = page => controls(page).getByRole('button', { name: /^Next/i });
const previous = page => controls(page).getByRole('button', { name: /^Previous/i });
const choice = (page, name) => controls(page).getByRole('button', { name });
const routeToggle = page => controls(page).getByRole('button', { name: 'Change route', exact: true });
async function openRoutes(page) {
  await enabled(routeToggle(page));
  if (await routeToggle(page).getAttribute('aria-expanded') !== 'true') await routeToggle(page).click();
}
async function choose(page, name) {
  await openRoutes(page);
  await choice(page, name).click();
}
const node = (page, id) => page.locator(`[data-threadrift-node="${id}"]`);
const active = (page, id) => page.locator(`[data-threadrift-edge-fill="${id}"]`).evaluate(el => !el.classList.contains('stroke-transparent'));

async function center(page, id) {
  const box = await node(page, id).boundingBox();
  assert(box, `Node ${id} must exist in rendered DOM`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function atNode(page, id) {
  await page.waitForFunction(nodeId => {
    const target = document.querySelector(`[data-threadrift-node="${nodeId}"]`);
    const svg = target?.ownerSVGElement;
    if (!target || !svg) return false;
    const nodeBox = target.getBoundingClientRect();
    const canvas = svg.getBoundingClientRect();
    return Math.abs(nodeBox.x + nodeBox.width / 2 - canvas.x - canvas.width / 2) < 0.05 &&
      Math.abs(nodeBox.y + nodeBox.height / 2 - canvas.y - canvas.height / 2) < 0.05;
  }, id);
}
async function enabled(locator) {
  await locator.waitFor({ state: 'visible' });
  await locator.page().waitForFunction(el => !el.disabled, await locator.elementHandle());
}
async function load(page) {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await enabled(next(page));
  await atNode(page, 0);
}
async function crossroads(page, expand = true) {
  await load(page);
  await next(page).click();
  await atNode(page, 1);
  await enabled(routeToggle(page));
  assert.equal(await next(page).isDisabled(), false, 'A fork must support forward travel without choosing');
  assert.equal(await controls(page).getByRole('group').count(), 0, 'Junction menu starts collapsed');
  if (expand) await openRoutes(page);
}
async function surfacePoint(page) {
  const surface = page.locator('[data-threadrift-surface]').first();
  const bounds = await surface.boundingBox();
  assert(bounds, 'Viewer surface must have a rendered box');
  for (const fraction of [0.95, 0.05, 0.5, 0.25, 0.75]) {
    const point = { x: bounds.x + bounds.width * fraction, y: bounds.y + 40 };
    if (await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return !!target?.closest('[data-threadrift-surface]') && !target.closest('[data-threadrift-content], [data-threadrift-controls]');
    }, point)) return point;
  }
  assert.fail('Wheel test must hit an unobscured navigation surface');
}
async function wheel(page, dy, dx = 0) {
  const point = await surfacePoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(dx, dy);
}
async function noMovement(page, id, duration = 480) {
  const before = await center(page, id);
  for (let elapsed = 0; elapsed < duration; elapsed += 80) {
    await page.waitForTimeout(80);
    const after = await center(page, id);
    assert(Math.hypot(after.x - before.x, after.y - before.y) < 0.1, `Unexpected movement at node ${id}`);
  }
}
async function run(name, body, options = {}) {
  if (process.env.THREADRIFT_TEST_FILTER && !new RegExp(process.env.THREADRIFT_TEST_FILTER, 'i').test(name)) return;
  console.log(`RUN ${name}`);
  const contextOptions = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, hasTouch: true, ...options };
  if (engine === 'firefox') { delete contextOptions.hasTouch; delete contextOptions.isMobile; }
  console.log(`Creating ${engine} context`);
  const context = await bounded(browser.newContext(contextOptions), `${engine} newContext`);
  console.log(`Creating ${engine} page`);
  const page = await bounded(context.newPage(), `${engine} newPage`);
  page.setDefaultTimeout(10000);
  // Navigation/layout checks must not depend on or write the user-authored map.
  await page.route('**/api/graph', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(route.request().method() === 'POST' ? { ok: true } : browserFixture) }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('favicon') && !message.location().url?.includes('favicon')) errors.push(message.text());
  });
  try {
    await body(page, context);
    assert.deepEqual(errors, [], 'Browser console must contain no application errors');
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const screenshot = `${output}/${name.replace(/[^a-z0-9]+/gi, '-')}.png`;
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    results.push({ name, passed: false, error: error.stack || String(error), consoleErrors: errors, screenshot });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await bounded(context.close(), `${engine} context.close`, 10000); }
}

try {
  await run('anchors provide node-relative positions and width without scaling or styling children', async page => {
    await page.route('**/api/graph', async route => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      const data = structuredClone(browserFixture);
      delete data.nodes[0].anchorX; delete data.nodes[0].anchorY; delete data.nodes[0].anchorWidth;
      await route.fulfill({ json: data });
    });
    await load(page);
    const anchor = page.locator('[data-threadrift-anchor="0"]');
    const measure = () => anchor.evaluate(el => {
      const bounds = el.getBoundingClientRect(), style = getComputedStyle(el);
      const node = document.querySelector('[data-threadrift-node="0"]').getBoundingClientRect();
      const child = el.firstElementChild.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, dx: bounds.x - node.x - node.width / 2,
        dy: bounds.y - node.y - node.height / 2, childWidth: child.width, font: getComputedStyle(el.firstElementChild).fontSize,
        border: style.borderTopWidth, padding: style.paddingTop, background: style.backgroundColor, transform: style.transform };
    });
    let initial = await measure();
    assert.equal(initial.width, 320); assert.equal(initial.childWidth, 320);
    assert(Math.abs(initial.dx - 24) < .1 && Math.abs(initial.dy - 24) < .1);
    assert.equal(initial.border, '0px'); assert.equal(initial.padding, '0px');
    assert.equal(initial.background, 'rgba(0, 0, 0, 0)'); assert.equal(initial.transform, 'none');
    await page.setViewportSize({ width: 1000, height: 720 }); await page.waitForTimeout(120);
    let resized = await measure();
    assert(Math.abs(resized.width - initial.width) < .1); assert(Math.abs(resized.height - initial.height) < .1); assert.equal(resized.font, initial.font);
    assert(Math.abs(resized.dx - 24) < .1 && Math.abs(resized.dy - 24) < .1, JSON.stringify(resized));
    await page.getByTitle('Toggle Threadrift Studio').click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Anchors', exact: true }).click();
    await page.getByRole('spinbutton', { name: /Anchor Width/ }).fill('410');
    await page.getByRole('slider', { name: /Offset X/ }).fill('0');
    await page.getByRole('slider', { name: /Offset Y/ }).fill('0');
    resized = await measure();
    assert.equal(resized.width, 410);
    assert(Math.abs(resized.dx) < .1 && Math.abs(resized.dy) < .1, 'Explicit zero is exactly the node origin');
    assert.equal(await page.getByRole('slider', { name: /^Scale/ }).count(), 0);
    await anchor.evaluate(el => { el.firstElementChild.style.width = '173px'; el.firstElementChild.querySelector('p').textContent = 'Naturally wrapping child content. '.repeat(30); });
    const intrinsic = await measure();
    assert.equal(intrinsic.childWidth, 173); assert.equal(intrinsic.width, 410);
    assert(intrinsic.height > resized.height, 'Content determines height and may choose its own width');
  });

  await run('explicit branch survives wheel and past-fork click is rejected', async page => {
    await crossroads(page);
    await page.screenshot({ path: `${output}/desktop-fork.png` });
    await choose(page, /Archive Gate/);
    assert.equal(await active(page, 'e-1-7'), true);
    assert.equal(await active(page, 'e-1-2'), false);
    await enabled(next(page));
    await wheel(page, 30);
    await page.waitForTimeout(320);
    assert.equal(await active(page, 'e-1-7'), true, 'Wheel must preserve Archive');
    const origin = await center(page, 1);
    const viewport = page.viewportSize();
    assert(Math.hypot(origin.x - viewport.width / 2, origin.y - viewport.height / 2) > 2, 'Wheel must actually advance');
    // The sibling remains rendered; clicking it after leaving the fork must not reroute.
    const sibling = await page.locator('[data-threadrift-edge="e-1-2"]').evaluate(el => {
      const p = el.getPointAtLength(el.getTotalLength() * 0.25);
      const screen = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
      return { x: screen.x, y: screen.y };
    });
    assert(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-threadrift-edge') === 'e-1-2', sibling), 'Rejected edge click must hit the intended visible sibling');
    await page.mouse.click(sibling.x, sibling.y);
    assert.equal(await active(page, 'e-1-7'), true);
    assert.equal(await active(page, 'e-1-2'), false);
  });

  await run('forward scrolling passes forks automatically and compact controls hide while travelling', async page => {
    await crossroads(page, false);
    const compact = await controls(page).boundingBox();
    assert(compact && compact.width < 250 && compact.height < 100, 'Resting controls must remain compact');
    assert.equal(await controls(page).getByRole('group').count(), 0);
    await wheel(page, 500);
    await controls(page).waitFor({ state: 'hidden' });
    await page.waitForTimeout(1000);
    const origin = await center(page, 1);
    const viewport = page.viewportSize();
    assert(Math.hypot(origin.x - viewport.width / 2, origin.y - viewport.height / 2) > 100, 'Forward travel must pass the fork without a menu choice');
    assert.equal(await active(page, 'e-1-2'), true);
  });



  if (engine === 'chromium') await run('continuous touch movement survives capture transfer after its first threshold', async (page, context) => {
    await crossroads(page);
    await choose(page, /Causeway/);
    const point = await center(page, 7);
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    assert.equal(await active(page, 'e-1-7'), false, 'Pointer down cannot select a sibling');
    const viewport = page.viewportSize();
    const distances = [];
    for (const delta of [3, 6, 12, 50, 100]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - delta, id: 1 }] });
      await page.waitForTimeout(120);
      const position = await center(page, 1);
      distances.push(Math.hypot(position.x - viewport.width / 2, position.y - viewport.height / 2));
    }
    assert(distances[3] > distances[2] + 25, `Further finger movement must advance after capture transfer: ${distances}`);
    assert(distances[4] > distances[3] + 25, `The drag must remain active through subsequent moves: ${distances}`);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await active(page, 'e-1-7'), false);
    assert.equal(await active(page, 'e-1-2'), true);
  });
  else results.push({ name: 'continuous touch movement survives capture transfer after its first threshold', skipped: true, reason: 'Chromium CDP touch pipeline only.' });

  if (engine === 'chromium') await run('Studio permits canvas swipes and reserves touch node drags for editing', async (page, context) => {
    await page.route('**/api/graph', route => route.request().method() === 'POST'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) : route.fallback());
    await load(page);
    await page.getByTitle('Toggle Threadrift Studio').click();
    await page.waitForTimeout(500);
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const root = await center(page, 0);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...root, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: root.x + 40, y: root.y - 40, id: 1 }] });
    await atNode(page, 0);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 360, id: 2 }] });
    for (const y of [345, 310, 260]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y, id: 2 }] });
      await page.waitForTimeout(50);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    assert((await center(page, 0)).y < root.y - 30, 'An empty-canvas swipe travels while Studio remains open');
  });

  if (engine === 'chromium') await run('a rapid second backward swipe bypasses the fork pause', async (page, context) => {
    await crossroads(page, false);
    await next(page).click();
    await atNode(page, 2);
    await enabled(previous(page));
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const x = 100;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 100, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 450, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 100, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 240, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1000);
    const fork = await center(page, 1);
    assert(fork.y > page.viewportSize().height / 2 + 30, 'Second swipe must move behind the fork without waiting for its old settle');
  });
  else results.push({ name: 'a rapid second backward swipe bypasses the fork pause', skipped: true, reason: 'Chromium CDP touch pipeline only.' });

  if (engine === 'chromium') await run('touch cancellation and a second finger clear pending selection', async (page, context) => {
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    for (const cancellation of ['touchCancel', 'secondFinger']) {
      await crossroads(page);
      await choose(page, /Causeway/);
      const point = await center(page, 7);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - 24, id: 1 }] });
      await page.waitForTimeout(60);
      if (cancellation === 'touchCancel') await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      else {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
          { x: point.x, y: point.y - 24, id: 1 }, { x: point.x + 48, y: point.y - 24, id: 2 },
        ] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      assert.equal(await active(page, 'e-1-7'), false);
      await enabled(next(page));
      await next(page).click();
      await atNode(page, 2);
      await enabled(previous(page));
      await previous(page).click();
      await atNode(page, 1);
      await choose(page, /Archive Gate/);
      assert.equal(await active(page, 'e-1-7'), true, `Fresh input must work after ${cancellation}`);
    }
  });
  else results.push({ name: 'touch cancellation and a second finger clear pending selection', skipped: true, reason: 'Chromium CDP touch pipeline only.' });

  await run('continuous reverse wheel input cannot extend the brief fork pause', async page => {
    await crossroads(page, false);
    await next(page).click();
    await atNode(page, 2);
    await enabled(previous(page));
    await wheel(page, -1200);
    for (let event = 0; event < 90; event++) {
      await page.waitForTimeout(12);
      await wheel(page, -20);
    }
    const fork = await center(page, 1);
    assert(fork.y > page.viewportSize().height / 2 + 20, 'Continued events must resume travel rather than perpetually extending the reverse pause');
  });

  await run('content controls and studio retain input ownership', async page => {
    await load(page);
    await page.getByText('Custom Spatial UI', { exact: true }).hover();
    await page.mouse.wheel(0, 600);
    await noMovement(page, 0);
    await next(page).hover();
    await page.mouse.wheel(0, 600);
    await noMovement(page, 0);
    await page.getByTitle('Toggle Threadrift Studio').click();
    await page.waitForTimeout(500);
    await page.getByText('Threadrift Studio', { exact: true }).hover();
    await page.mouse.wheel(0, 600);
    await noMovement(page, 0);
    await wheel(page, 600);
    await page.waitForTimeout(400);
    assert((await center(page, 0)).y < page.viewportSize().height / 2 - 20, 'Canvas wheel must travel with Studio open');
    await load(page);
    await page.getByTitle('Toggle Threadrift Studio').click();
    await page.waitForTimeout(500);
    await page.getByRole('region', { name: /Threadrift map/ }).focus();
    await page.keyboard.press('ArrowDown');
    await atNode(page, 1);
    await page.getByTitle('Toggle Threadrift Studio').click();
  });

  await run('keyboard offers route access through the optional menu', async page => {
    await load(page);
    const viewer = page.getByRole('region', { name: /Threadrift map/ });
    await viewer.focus();
    await page.keyboard.press('ArrowDown');
    await atNode(page, 1);
    await enabled(routeToggle(page));
    await routeToggle(page).focus();
    await page.keyboard.press('Enter');
    await choice(page, /Archive Gate/).focus();
    await page.keyboard.press('Enter');
    assert.equal(await active(page, 'e-1-7'), true);
    await viewer.focus();
    await page.keyboard.press('ArrowDown');
    await atNode(page, 7);
    await enabled(previous(page));
    await previous(page).focus();
    await page.keyboard.press('Space');
    await atNode(page, 1);
  });

  await run('native nested scrolling does not move the graph', async page => {
    await load(page);
    await page.locator('[data-threadrift-content]').evaluate(layer => {
      const scroller = document.createElement('div');
      scroller.setAttribute('data-test-nested-scroll', '');
      scroller.style.cssText = 'position:absolute;left:600px;top:-60px;width:200px;height:100px;overflow:auto;overscroll-behavior:contain;pointer-events:auto;background:#18181b;color:white;';
      const content = document.createElement('div');
      content.style.height = '1000px';
      content.textContent = 'Native scroll ownership fixture';
      scroller.append(content); layer.append(scroller);
    });
    const scroller = page.locator('[data-test-nested-scroll]');
    await scroller.hover();
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(el => el.scrollTop > 10, await scroller.elementHandle());
    await noMovement(page, 0);
    await scroller.evaluate(el => el.remove());
    await next(page).click();
    await atNode(page, 1);
  });

  await run('resize preserves graph position and selected route', async page => {
    await crossroads(page);
    await choose(page, /Archive Gate/);
    await next(page).click();
    await atNode(page, 7);
    await enabled(next(page));
    await page.setViewportSize({ width: 960, height: 680 });
    await atNode(page, 7);
    assert.equal(await active(page, 'e-1-7'), true);
    await enabled(previous(page));
    await previous(page).click();
    await atNode(page, 1);
  });

  await run('horizontal wheel onset preserves the following vertical gesture', async page => {
    await load(page);
    await wheel(page, 0, 100);
    await wheel(page, 80, 0);
    await page.waitForTimeout(400);
    const origin = await center(page, 0);
    const viewport = page.viewportSize();
    assert(Math.hypot(origin.x - viewport.width / 2, origin.y - viewport.height / 2) > 2);
  });

  await run('CSS-scaled ancestor keeps HTML content aligned with SVG', async page => {
    await load(page);
    await page.locator('[data-threadrift-content]').evaluate(el => {
      const position = document.querySelector('[data-threadrift-node="0"]').closest('g.node-group').transform.baseVal.consolidate().matrix;
      const probe = document.createElement('span');
      probe.setAttribute('data-test-camera-probe', '');
      probe.style.cssText = `position:absolute;left:calc(${position.e}px * var(--threadrift-world-scale));top:calc(${position.f}px * var(--threadrift-world-scale));width:0;height:0;pointer-events:none;`;
      el.append(probe);
    });
    const alignmentError = () => page.evaluate(() => {
      const html = document.querySelector('[data-test-camera-probe]').getBoundingClientRect();
      const svg = document.querySelector('[data-threadrift-node="0"]').getBoundingClientRect();
      return Math.hypot(html.x - svg.x - svg.width / 2, html.y - svg.y - svg.height / 2);
    });
    assert(await alignmentError() < 0.2);
    await page.getByRole('region', { name: /Threadrift map/ }).evaluate(el => {
      el.parentElement.style.transform = 'scale(0.5)';
      el.parentElement.style.transformOrigin = '0 0';
    });
    await page.setViewportSize({ width: 1282, height: 902 });
    await page.waitForTimeout(150);
    assert(await alignmentError() < 0.2);
    await atNode(page, 0);
  });

  await run('simultaneous viewers and remounts isolate input and choices', async page => {
    await mountHarness(page);
    let first = page.locator('[data-test-viewer="first"]');
    const second = page.locator('[data-test-viewer="second"]');
    await enabled(next(first)); await enabled(next(second));
    const secondBefore = await center(second, 0);
    await next(first).click();
    await openRoutes(first);
    assert.deepEqual(await center(second, 0), secondBefore);
    await choose(first, /Left end/);
    assert.equal(await active(first, 'left'), true);
    await next(second).click();
    await choose(second, /Right end/);
    assert.equal(await active(first, 'left'), true);
    assert.equal(await active(second, 'right'), true);
    await page.locator('[data-test-toggle-first]').click();
    assert.equal(await page.locator('[data-test-viewer]').count(), 1);
    await enabled(next(second));
    await next(second).click();
    await enabled(previous(second));
    assert.equal(await next(second).isDisabled(), true);
    await page.locator('[data-test-toggle-first]').click();
    first = page.locator('[data-test-viewer="first"]');
    await enabled(next(first));
    assert.equal(await previous(first).isDisabled(), true);
    assert.equal(await next(second).isDisabled(), true);
    await next(first).click();
    await openRoutes(first);
    assert.equal(await next(first).isDisabled(), false);
  });

  await run('editor recommendation persists through reload and drives automatic travel', async page => {
    let saved;
    await page.route('**/api/graph', async route => {
      if (route.request().method() === 'POST') {
        saved = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      } else if (saved) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) });
      else await route.fallback();
    });
    await crossroads(page, false);
    await page.getByTitle('Toggle Threadrift Studio').click();
    await page.waitForTimeout(500);
    await node(page, 1).click();
    const response = page.waitForResponse(item => item.url().endsWith('/api/graph') && item.request().method() === 'POST');
    await page.getByLabel('Recommended path', { exact: false }).selectOption('e-1-7');
    await response;
    assert.equal(saved.nodes[1].recommendedEdgeId, 'e-1-7', 'Authored recommendation must be present in saved JSON');
    await load(page);
    assert.equal(await active(page, 'e-1-7'), true, 'Reload must restore the authored recommendation');
    await next(page).click(); await atNode(page, 1); await enabled(next(page));
    await next(page).click(); await atNode(page, 7);
  });

  await run('editor camera follows root drag live without feedback and resize cancels dragging', async page => {
    let interceptedWrites = 0;
    let saved;
    await page.route('**/api/graph', async route => {
      if (route.request().method() === 'POST') {
        interceptedWrites++;
        saved = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      } else await route.fallback();
    });
    await load(page);
    await page.getByTitle('Toggle Threadrift Studio').click();
    await page.getByText('Threadrift Studio', { exact: true }).waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    const start = await center(page, 0);
    const initialPosition = await node(page, 0).evaluate(el => el.closest('g.node-group').getAttribute('transform'));
    const neighbour = await center(page, 1);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 45, { steps: 6 });
    const dragged = await center(page, 0);
    assert(Math.hypot(dragged.x - start.x, dragged.y - start.y) < 1, 'Current node remains centered before pointer release');
    const movedNeighbour = await center(page, 1);
    assert(Math.abs(movedNeighbour.x - neighbour.x + 60) < 3 && Math.abs(movedNeighbour.y - neighbour.y + 45) < 3, 'Camera follows pointer displacement without accumulating feedback');
    assert.notEqual(await node(page, 0).evaluate(el => el.closest('g.node-group').getAttribute('transform')), initialPosition);
    await page.mouse.up();
    await page.waitForTimeout(450);
    assert(interceptedWrites > 0);
    await page.mouse.move(dragged.x, dragged.y); await page.mouse.down();
    await page.mouse.move(dragged.x + 20, dragged.y, { steps: 3 });
    await page.setViewportSize({ width: 1100, height: 800 }); await page.waitForTimeout(120);
    const afterResize = await center(page, 0);
    const stoppedPosition = await node(page, 0).evaluate(el => el.closest('g.node-group').getAttribute('transform'));
    await page.mouse.move(afterResize.x + 100, afterResize.y + 100, { steps: 5 }); await page.mouse.up();
    const afterStaleMove = await center(page, 0);
    assert(Math.hypot(afterStaleMove.x - afterResize.x, afterStaleMove.y - afterResize.y) < 0.1);
    assert.equal(await node(page, 0).evaluate(el => el.closest('g.node-group').getAttribute('transform')), stoppedPosition);
    await page.getByTitle('Toggle Threadrift Studio').click(); await atNode(page, 0);
  });

  const cameraCenter = page => page.locator('[data-threadrift-camera]').evaluate(el => {
    const matrix = el.getScreenCTM(), bounds = el.ownerSVGElement.getBoundingClientRect();
    const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  });
  const closePoint = (actual, expected, epsilon = .08) => assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < epsilon, JSON.stringify({ actual, expected }));
  async function studio(page) {
    await page.getByTitle('Toggle Threadrift Studio').click();
    await page.getByRole('button', { name: 'Freeze camera', exact: true }).waitFor(); await page.waitForTimeout(450);
  }
  await run('camera freeze commits node and view together then restores that view on return and reload', async page => {
    let saved, writes = 0;
    await page.route('**/api/graph', route => {
      if (route.request().method() === 'POST') { writes++; saved = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: saved ?? browserFixture });
    });
    await load(page); await studio(page);
    const before = await cameraCenter(page), origin = await center(page, 0);
    await page.getByRole('button', { name: 'Freeze camera', exact: true }).click();
    closePoint(await cameraCenter(page), before);
    await page.mouse.move(origin.x, origin.y); await page.mouse.down();
    for (const delta of [20, 50, 80]) {
      await page.mouse.move(origin.x - delta, origin.y - 30, { steps: 3 }); closePoint(await cameraCenter(page), before);
    }
    await page.waitForTimeout(350); assert.equal(writes, 0, 'Unfinished drag must not autosave');
    await page.mouse.up(); await page.waitForTimeout(450);
    assert.equal(writes, 1); closePoint(saved.nodes[0].camera, before); assert.notEqual(saved.nodes[0].x, browserFixture.nodes[0].x);
    closePoint(await cameraCenter(page), before);
    await wheel(page, 300); closePoint(await cameraCenter(page), before);
    await page.getByRole('button', { name: 'Return to route', exact: true }).click();
    await page.getByTitle('Toggle Threadrift Studio').click(); await enabled(next(page));
    await next(page).click(); await atNode(page, 1); await previous(page).click(); await enabled(next(page));
    closePoint(await cameraCenter(page), before);
    await page.reload({ waitUntil: 'networkidle' }); await enabled(next(page)); closePoint(await cameraCenter(page), before);
    const projected = await page.locator('[data-threadrift-anchor="0"]').evaluate(el => {
      const html = el.getBoundingClientRect(), node = document.querySelector('[data-threadrift-node="0"]').getBoundingClientRect();
      return { x: html.x - node.x - node.width / 2, y: html.y - node.y - node.height / 2 };
    });
    closePoint(projected, { x: saved.nodes[0].anchorX ?? 24, y: saved.nodes[0].anchorY ?? 24 });
    await page.screenshot({ path: `${output}/camera-saved-view.png` });
  });

  await run('camera drag cancellation and later ordinary movement preserve authored views', async page => {
    let saved;
    await page.route('**/api/graph', route => {
      if (route.request().method() === 'POST') { saved = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); }
      return route.fallback();
    });
    await load(page); await studio(page);
    await page.getByRole('button', { name: 'Freeze camera', exact: true }).click();
    const origin = await center(page, 0), before = await cameraCenter(page);
    const nodePosition = () => node(page, 0).evaluate(el => el.parentElement.getAttribute('transform'));
    const initial = await nodePosition();
    await page.mouse.move(origin.x, origin.y); await page.mouse.down(); await page.mouse.move(origin.x - 60, origin.y - 40, { steps: 4 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal(await nodePosition(), initial); closePoint(await cameraCenter(page), before);
    await page.waitForTimeout(350); assert.equal(saved, undefined);
    await page.getByRole('button', { name: 'Use current view', exact: true }).click();
    await page.getByRole('button', { name: 'Return to route', exact: true }).click(); await page.waitForTimeout(220);
    await page.mouse.move(origin.x, origin.y); await page.mouse.down(); await page.mouse.move(origin.x - 50, origin.y - 30, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(450); closePoint(saved.nodes[0].camera, before); closePoint(await cameraCenter(page), before);
    await page.getByRole('button', { name: 'Reset to Follow', exact: true }).click();
    await page.getByRole('button', { name: 'Return to route', exact: true }).click(); await page.getByTitle('Toggle Threadrift Studio').click(); await atNode(page, 0);
  });

  await run('camera positioning pans only the view and numeric framing persists without moving nodes', async page => {
    let saved;
    await page.route('**/api/graph', route => {
      if (route.request().method() === 'POST') { saved = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); }
      return route.fallback();
    });
    await load(page); await studio(page);
    await page.getByRole('button', { name: 'Position camera', exact: true }).click();
    const before = await cameraCenter(page), point = await surfacePoint(page);
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 80, point.y + 60, { steps: 5 }); await page.mouse.up();
    assert(Math.hypot((await cameraCenter(page)).x - before.x, (await cameraCenter(page)).y - before.y) > 30);
    await page.getByRole('button', { name: 'Use current view', exact: true }).click(); await page.waitForTimeout(350);
    assert.equal(saved.nodes[0].x, browserFixture.nodes[0].x); assert.equal(saved.nodes[0].y, browserFixture.nodes[0].y);
    await page.getByRole('spinbutton', { name: 'Camera X', exact: true }).fill('-125'); await page.keyboard.press('Enter');
    await page.getByRole('spinbutton', { name: 'Camera Y', exact: true }).fill('75'); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
    closePoint(saved.nodes[0].camera, { x: -125, y: 75 }); closePoint(await cameraCenter(page), { x: -125, y: 75 });
    await page.screenshot({ path: `${output}/camera-studio.png` });
  });

  await run('camera position sliders cancel cleanly and commit a complete view on release', async page => {
    let saved, writes = 0;
    await page.route('**/api/graph', route => {
      if (route.request().method() === 'POST') { writes++; saved = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); }
      return route.fallback();
    });
    await load(page); await studio(page); await page.getByRole('button', { name: 'Freeze camera', exact: true }).click();
    const view = await cameraCenter(page), slider = page.getByRole('slider', { name: 'Node X slider', exact: true });
    await slider.scrollIntoViewIfNeeded(); const box = await slider.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * .5, y); await page.mouse.down(); await page.mouse.move(box.x + box.width * .7, y, { steps: 3 });
    await page.keyboard.press('Escape'); await page.mouse.move(box.x + box.width * .8, y, { steps: 3 }); await page.mouse.up();
    await page.waitForTimeout(350); assert.equal(writes, 0); assert.equal(Number(await slider.inputValue()), browserFixture.nodes[0].x);
    // Cancellation status can change the panel's available height; use its current layout.
    await slider.scrollIntoViewIfNeeded(); const nextBox = await slider.boundingBox(), nextY = nextBox.y + nextBox.height / 2;
    await page.mouse.move(nextBox.x + nextBox.width * .5, nextY); await page.mouse.down(); await page.mouse.move(nextBox.x + nextBox.width * .65, nextY, { steps: 3 });
    await page.waitForTimeout(350); assert.equal(writes, 0); closePoint(await cameraCenter(page), view);
    await page.mouse.up(); await page.waitForTimeout(350); assert.equal(writes, 1); closePoint(saved.nodes[0].camera, view);
  });

  await run('camera tools are keyboard accessible in a narrow editor and respect reduced motion', async page => {
    await load(page); await studio(page);
    const freeze = page.getByRole('button', { name: 'Freeze camera', exact: true });
    await freeze.focus(); await page.keyboard.press('Enter'); assert.equal(await freeze.getAttribute('aria-pressed'), 'true');
    for (const name of ['Node', 'Edge', 'Anchors', 'Settings']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= 391 && box.height >= 40);
    }
    await page.getByRole('combobox', { name: 'View destination', exact: true }).selectOption('7');
    await page.getByRole('button', { name: 'Preview view', exact: true }).click();
    closePoint(await cameraCenter(page), browserFixture.nodes[7]);
    await page.getByRole('button', { name: 'Return to route', exact: true }).click();
    await page.waitForTimeout(40); closePoint(await cameraCenter(page), browserFixture.nodes[0]);
    await page.screenshot({ path: `${output}/camera-mobile-editor.png` });
  }, { viewport: { width: 390, height: 844 }, isMobile: true, reducedMotion: 'reduce' });

  await run('camera custom view culling includes nearby nodes and crossing inactive curves', async page => {
    const fixture = structuredClone(browserFixture);
    fixture.nodes[0].camera = { x: 10000, y: 10000 };
    fixture.nodes[90] = { id: 90, name: 'Far A', content: '', x: 7000, y: 10000 };
    fixture.nodes[91] = { id: 91, name: 'Far B', content: '', x: 13000, y: 10000 };
    fixture.nodes[92] = { id: 92, name: 'Visible distant node', content: '', x: 10000, y: 10000 };
    fixture.edges.push({ id: 'crossing', from: 90, to: 91, type: 'main', curve: 0 }); fixture.nextNodeId = 93;
    await page.route('**/api/graph', route => route.fulfill({ json: fixture }));
    await page.goto(baseURL, { waitUntil: 'networkidle' }); await enabled(next(page));
    assert.equal(await node(page, 0).count(), 0); assert.equal(await node(page, 92).count(), 1);
    assert.equal(await node(page, 90).count(), 0); assert.equal(await node(page, 91).count(), 0);
    assert.equal(await page.locator('[data-threadrift-edge="crossing"]').count(), 1);
    closePoint(await cameraCenter(page), fixture.nodes[0].camera);
    await page.setViewportSize({ width: 500, height: 900 }); await page.waitForTimeout(80);
    closePoint(await cameraCenter(page), fixture.nodes[0].camera);
  });

  if (engine === 'chromium') await run('camera touch freeze drag commits and cancellation restores both fields', async (page, context) => {
    let saved, writes = 0;
    await page.route('**/api/graph', route => {
      if (route.request().method() === 'POST') { saved = route.request().postDataJSON(); writes++; return route.fulfill({ json: { ok: true } }); }
      return route.fallback();
    });
    await load(page); await studio(page); await page.getByRole('button', { name: 'Freeze camera', exact: true }).click();
    const session = await context.newCDPSession(page), origin = await center(page, 0), view = await cameraCenter(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: origin.x, y: origin.y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: origin.x - 50, y: origin.y - 40, id: 1 }] });
    closePoint(await cameraCenter(page), view);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await page.waitForTimeout(350);
    assert.equal(writes, 0); closePoint(await center(page, 0), origin);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: origin.x, y: origin.y, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: origin.x - 60, y: origin.y - 40, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(450);
    assert.equal(writes, 1); closePoint(saved.nodes[0].camera, view);
  });
  else results.push({ name: 'camera touch freeze drag commits and cancellation restores both fields', skipped: true, reason: 'Chromium CDP touch pipeline only.' });

  await run('narrow viewport keeps compact controls and optional choices reachable', async page => {
    await crossroads(page, false);
    await page.screenshot({ path: `${output}/mobile-collapsed.png` });
    await openRoutes(page);
    await page.screenshot({ path: `${output}/mobile-fork.png` });
    for (const locator of [next(page), previous(page), choice(page, /Archive Gate/), choice(page, /Causeway/), choice(page, /Signal/)]) {
      const box = await locator.boundingBox();
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845);
      assert(box.height >= 40);
    }
    await choose(page, /Archive Gate/);
    const box = await next(page).boundingBox();
    assert(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-threadrift-controls] button'),
      { x: box.x + box.width * .85, y: box.y + box.height / 2 }));
    await next(page).click(); await atNode(page, 7);
  }, { viewport: { width: 390, height: 844 }, isMobile: true });

  await run('reduced motion preserves rest and automatic forward continuation', async page => {
    await crossroads(page, false);
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    await next(page).click(); await atNode(page, 2);
    await previous(page).click(); await atNode(page, 1);
    await choose(page, /Archive Gate/);
    await next(page).click(); await atNode(page, 7);
    await page.screenshot({ path: `${output}/desktop.png` });
  }, { reducedMotion: 'reduce' });

  // Last: Firefox may retain native origin zoom across contexts.
  await run('modifier wheel preserves browser zoom ownership', async page => {
    await load(page); await page.keyboard.down('Control'); await wheel(page, 120); await page.keyboard.up('Control');
    await noMovement(page, 0); await page.keyboard.press('Control+0');
  });
} finally {
  await bounded(browser.close(), `${engine} browser.close`, 10000);
  await writeFile(`${output}/report.json`, JSON.stringify({ url: baseURL, browser: engine, results }, null, 2));
}
console.log(`${results.filter(result => result.passed).length}/${results.filter(result => !result.skipped).length} browser scenarios passed; ${results.filter(result => result.skipped).length} explicitly skipped`);
if (results.some(result => result.passed === false)) process.exitCode = 1;
