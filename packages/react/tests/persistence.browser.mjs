/** Real editor -> HTTP adapter -> isolated disk file -> reload integration.
 * Requires an explicitly configured test server and a graph file under .turbo.
 * Never run against the normal playground server or its public/data/graph.json.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseGraphDocument } from '../../core/dist/index.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baseURL = process.env.THREADRIFT_PERSISTENCE_TEST_URL;
const graphFile = process.env.THREADRIFT_TEST_GRAPH_FILE && resolve(process.env.THREADRIFT_TEST_GRAPH_FILE);
assert(baseURL && graphFile, 'Set THREADRIFT_PERSISTENCE_TEST_URL and THREADRIFT_TEST_GRAPH_FILE for the isolated server');
const url = new URL(baseURL);
assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.port && url.port !== '3100', 'Use a separate local test server port');
const within = relative(resolve(root, '.turbo'), graphFile);
assert(within && !within.startsWith('..') && !isAbsolute(within), 'Test graph must be inside workspace .turbo');
const userGraph = resolve(root, 'apps/playground/public/data/graph.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalHash = hash(await readFile(userGraph));
const initial = JSON.parse(await readFile(graphFile, 'utf8'));
const initialResponse = await fetch(`${baseURL}/api/graph`, { cache: 'no-store' });
assert(initialResponse.ok);
const served = await initialResponse.json();
assert.deepEqual(served, parseGraphDocument(initial), 'Server must serve the designated isolated fixture after v1 migration');
const fixture = JSON.parse(await readFile(new URL('./fixtures/sample-map.json', import.meta.url), 'utf8'));
const resetResponse = await fetch(`${baseURL}/api/graph`, { method: 'POST', headers: {
  'Content-Type': 'application/json', 'If-Match': initialResponse.headers.get('etag'),
  Origin: url.origin,
}, body: JSON.stringify(fixture) });
assert(resetResponse.ok, `Isolated fixture reset failed: ${resetResponse.status} ${await resetResponse.text()}`);

const moduleURL = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
  : new URL('../../../.turbo/browser-tools/node_modules/playwright/index.mjs', import.meta.url).href;
const { chromium } = await import(moduleURL);
const output = resolve(root, '.turbo/browser-artifacts/persistence');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true, timeout: 30000 });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const results = [];

async function disk() { return JSON.parse(await readFile(graphFile, 'utf8')); }
async function waitDisk(predicate) {
  for (let index = 0; index < 100; index++) {
    const data = await disk(); if (predicate(data)) return data;
    await page.waitForTimeout(50);
  }
  assert.fail('Expected editor changes were not committed to the isolated disk file');
}
async function slider(name, value) {
  // EdgeTab's existing Curve label wraps its Start/End buttons before the range.
  const input = name.source === '^Curve' ? page.locator('input[type="range"]').first() : page.getByRole('slider', { name });
  await input.fill(String(value));
  assert.equal(Number(await input.inputValue()), value);
}
async function settings() { await page.getByRole('button', { name: 'Settings', exact: true }).click(); }
async function openStudio() {
  await page.getByTitle('Toggle Threadrift Studio').click();
  await page.getByText('Threadrift Studio', { exact: true }).waitFor();
  await page.waitForTimeout(500);
}
async function selectFork() {
  await page.locator('[data-threadrift-controls]').getByRole('button', { name: /^Next/ }).click();
  await page.waitForFunction(() => {
    const target = document.querySelector('[data-threadrift-node="1"]');
    if (!target) return false;
    const node = target.getBoundingClientRect(), surface = target.ownerSVGElement.getBoundingClientRect();
    return Math.abs(node.y + node.height / 2 - surface.y - surface.height / 2) < .05;
  });
  await openStudio();
  await page.locator('[data-threadrift-node="1"]').click();
}
async function saveNow() {
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
}

try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await selectFork();
  await settings();
  await page.getByRole('checkbox', { name: 'Autosave', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Persistence audit fork');
  await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Durable text\nUnicode: café 🎯');
  await page.getByLabel('Recommended path', { exact: false }).selectOption('e-1-7');
  await slider(/^X\s/, 715);
  await slider(/^Y\s/, 355);
  await page.getByRole('button', { name: 'Anchors', exact: true }).click();
  await slider(/Offset X/, -123); await slider(/Offset Y/, 88); await page.getByRole('spinbutton', { name: /Anchor Width/ }).fill('420');
  const edge = page.locator('[data-threadrift-edge="e-1-7"]');
  const point = await edge.evaluate(path => {
    const point = path.getPointAtLength(path.getTotalLength() * .35).matrixTransform(path.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await slider(/^Curve/, -.24);
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await slider(/^Curve/, .31); await slider(/^Divergence/, -.12);
  await settings();
  await slider(/Scroll Sensitivity/, .0023); await slider(/Touch Sensitivity/, .0034);
  await slider(/Snap Strength/, .27); await slider(/Snap Threshold/, .34);
  const beforeSave = await disk();
  assert.notEqual(beforeSave.nodes[1].name, 'Persistence audit fork', 'Disabled autosave must not write edits');
  await saveNow();
  const saved = await waitDisk(data => data.nodes[1].name === 'Persistence audit fork');
  assert.deepEqual(Object.fromEntries(['name', 'content', 'x', 'y', 'anchorX', 'anchorY', 'anchorWidth', 'recommendedEdgeId'].map(key => [key, saved.nodes[1][key]])),
    { name: 'Persistence audit fork', content: 'Durable text\nUnicode: café 🎯', x: 715, y: 355, anchorX: -123, anchorY: 88, anchorWidth: 420, recommendedEdgeId: 'e-1-7' });
  const savedEdge = saved.edges.find(edge => edge.id === 'e-1-7');
  assert.deepEqual([savedEdge.curve, savedEdge.curveEnd, savedEdge.diverge], [-.24, .31, -.12]);
  assert.deepEqual(saved.settings.physics, { scrollSensitivity: .0023, touchSensitivity: .0034, snapStrength: .27, snapThreshold: .34 });
  assert.equal(saved.settings.editor.autoSaveEnabled, false);
  assert.equal(saved.version, '3.0');
  for (const node of Object.values(saved.nodes)) for (const key of ['level', 'seqId', 'parentSeqId', 'vx', 'vy']) assert.equal(key in node, false);
  results.push({ name: 'Every editable node, anchor, curve and physics field reaches real disk', status: 'passed' });

  await page.reload({ waitUntil: 'networkidle' }); await selectFork(); await settings();
  assert.equal(await page.getByRole('checkbox', { name: 'Autosave', exact: true }).isChecked(), false);
  for (const [name, value] of [[/Scroll Sensitivity/, .0023], [/Touch Sensitivity/, .0034], [/Snap Strength/, .27], [/Snap Threshold/, .34]]) {
    assert.equal(Number(await page.getByRole('slider', { name }).inputValue()), value);
  }
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Persistence audit fork');
  assert.equal(await page.getByLabel('Recommended path', { exact: false }).inputValue(), 'e-1-7');
  results.push({ name: 'Full browser reload restores durable document and settings', status: 'passed' });

  await settings(); await page.getByRole('checkbox', { name: 'Autosave', exact: true }).check();
  await waitDisk(data => data.settings.editor.autoSaveEnabled === true);
  await slider(/Touch Sensitivity/, .0038);
  await waitDisk(data => data.settings.physics.touchSensitivity === .0038);
  results.push({ name: 'Settings-only edits autosave without graph edits', status: 'passed' });

  await page.route('**/api/graph', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await slider(/Snap Strength/, .29);
  await page.getByText('Error', { exact: true }).waitFor();
  assert.equal((await disk()).settings.physics.snapStrength, .27, 'Failed write cannot claim disk was changed');
  await page.unroute('**/api/graph'); await saveNow();
  await waitDisk(data => data.settings.physics.snapStrength === .29);
  results.push({ name: 'Failed save remains visible and manual retry persists changes', status: 'passed' });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, 'settings-saved.png') });
} catch (error) {
  results.push({ name: 'Persistence integration', status: 'failed', error: error.stack || String(error) });
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close(); await browser.close();
  assert.equal(hash(await readFile(userGraph)), originalHash, 'User graph must remain unchanged by integration tests');
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ url: baseURL, graphFile, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
