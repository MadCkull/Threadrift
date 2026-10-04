# Navigation and persistence verification

Build `@threadrift/core` before running the core and React `test` package scripts. They bundle the TypeScript cases with tsup and run Node's built-in test runner. The sample-map fixture is independent of playground persistence.

## Browser checks

Build core, React, Studio, and the playground, then start the playground on port 3100. From the repository root, install the isolated test tooling (Node 20 or later):

```powershell
npm install --prefix .turbo/browser-tools --no-audit --no-fund playwright@1.63.0
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.turbo/browsers"
node .turbo/browser-tools/node_modules/playwright/cli.js install firefox webkit
node packages/react/tests/navigation.browser.mjs
$env:PLAYWRIGHT_BROWSER = 'firefox'
node packages/react/tests/navigation.browser.mjs
$env:PLAYWRIGHT_BROWSER = 'webkit'
node packages/react/tests/navigation.browser.mjs
```

The default Chromium run uses installed Microsoft Edge. Override `PLAYWRIGHT_CHANNEL` for another installed Chromium channel. `THREADRIFT_TEST_URL` overrides the preview URL; `PLAYWRIGHT_MODULE` overrides the absolute Playwright module path. Reports and screenshots are written to `.turbo/browser-artifacts/<engine>/`. Browser launch failures are recorded separately from application assertions.

`THREADRIFT_TEST_FILTER` optionally selects scenario names with a case-insensitive regular expression for a focused rerun. Studio checks cover wheel/keyboard travel, empty-canvas swipes, touch editing ownership, live camera follow during root dragging, and resize cancellation.

The suite checks rendered DOM and browser input. Chromium-only CDP touch cases are explicitly skipped on other engines. Editor tests intercept persistence requests so they cannot overwrite the sample map. WebKit automation is not a claim of testing Safari on an iPhone.

Navigation and layout checks serve a canonical copy of `fixtures/sample-map.json` through request interception. They are independent of user-edited node positions and routes. Anchor checks verify top-left offsets, explicit zero, editable width, intrinsic height, child-owned dimensions, absence of wrapper decoration, and stable CSS-pixel sizing after viewport resize. Real disk round trips remain covered by the separate persistence runner.

The two-viewer lifecycle scenario bundles `navigation.harness.tsx` with the existing tsup/esbuild dependency and the built React package. Playwright serves that fixture through request interception; no playground source or server routes are added. It verifies independent viewers and unmount/remount cleanup without reading their stores. The native browser zoom scenario runs last because Firefox can retain origin zoom across contexts.

## Persistence checks

The React package test script also runs `persistence.test.ts`. Deferred adapters exercise save ordering, immutable snapshots, stale completions, failed writes and retry, independent stores, settings-only saves, imports, draft recovery, quota failures, and disk reload races. These tests use memory storage and never write the playground graph.

`persistence.browser.mjs` tests the complete editor → HTTP → disk → browser reload flow. It must use a **separate local server** and an isolated file under `.turbo`, because its changes intentionally reach disk. After building the playground, start it from `apps/playground` in a separate terminal:

```powershell
# Run the setup from the repository root first.
New-Item -ItemType Directory -Force .turbo/persistence-browser | Out-Null
Copy-Item packages/react/tests/fixtures/sample-map.json .turbo/persistence-browser/graph.json
$env:THREADRIFT_GRAPH_PATH = "$PWD/.turbo/persistence-browser/graph.json"
Set-Location apps/playground
node node_modules/next/dist/bin/next start -p 3101
```

From another terminal at the repository root:

```powershell
$env:THREADRIFT_PERSISTENCE_TEST_URL = 'http://localhost:3101'
$env:THREADRIFT_TEST_GRAPH_FILE = "$PWD/.turbo/persistence-browser/graph.json"
node packages/react/tests/persistence.browser.mjs
```

The runner refuses port 3100 or a fixture outside `.turbo`, resets its isolated document using a revision precondition, and verifies the real sample graph's hash is unchanged. It covers all Studio node/anchor/curve/physics fields, recommendation and autosave policy, manual save, full reload, settings-only autosave, and failed-write retry. Evidence is written to `.turbo/browser-artifacts/persistence/`.

Persistence verification on 2026-10-04: 33 core, 87 React (61 navigation + 26 persistence), and 12 disk/API tests passed. All four real-disk browser scenarios and all 18 Edge navigation scenarios passed against the final production build. The reload tests include a write already in flight, a write starting during GET, and a write completing before that stale GET returns.

Verification on 2026-10-04: React unit suite 61/61 passed; Chromium/Edge browser scenarios 18/18 passed; Firefox and WebKit each passed 15/15 executed scenarios, with three CDP touch scenarios explicitly skipped. Firefox required launch outside this session's process sandbox. The new cases cover automatic continuation, persisted recommendations, continuous touch movement beyond its initial capture threshold, a rapid second backward swipe, the fixed reverse pause, and compact optional route controls. These results do not replace the physical-device matrix below.

## Camera verification (2026-10-04)

The final production build passed 27/27 Chromium/Edge browser scenarios with no skips, including saved camera return/reload, cancellation, independent view positioning, numeric and slider edits, narrow keyboard controls, reduced motion, viewport culling and touch commit/cancel. The final React suite passed 98/98 tests. Core passed 41/41 and the disk/API suite passed 12/12; five isolated real-disk browser scenarios passed, including camera centers and edge timing across save/reload. Library/declaration and production builds passed. New camera behavior has not been rerun in Firefox/WebKit or on physical devices; earlier engine results above apply to their dated navigation baseline.

See [CAMERA.md](../../../CAMERA.md) for the authoring and document contract. Navigation evidence is under `.turbo/browser-artifacts/chromium/`; persistence evidence is under `.turbo/browser-artifacts/persistence/`. All persistence writes used the separate `.turbo` fixture, and the user's graph hash remained unchanged.

## Physical input acceptance

On each available mouse, trackpad, or phone:

1. Travel through Crossroads without selecting anything; the suggested continuation should flow automatically. Return to Crossroads, release input, open Change route, and select Archive.
2. Travel partly toward Archive; release input and click the other branch. The route must stay unchanged.
3. Reverse to Crossroads and wait for enabled route buttons. Select a different exit.
4. Repeat at a nested fork; try a tiny continuous swipe, a long momentum tail, and rapid reversal. A second deliberate backward swipe should bypass the brief fork pause.
5. Check native scrolling inside content, browser zoom, resizing, and keyboard Previous/Next.

Record the device, OS, browser, refresh rate, settings, and observed failures. Automated events cannot certify physical momentum. For local diagnosis, `createInputRecorder(viewerElement)` provides `snapshot()`, `toJSON()`, `clear()`, and `stop()`; traces stay in memory unless explicitly saved by the caller.
