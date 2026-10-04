# 🌌 Threadrift

> **A fluid, path-traversing spatial graph engine for non-linear storytelling, interactive roadmaps, and node-driven web experiences.**

---

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Turborepo](https://img.shields.io/badge/monorepo-Turborepo-ef4444.svg)](https://turbo.build)
[![Bun](https://img.shields.io/badge/runtime-Bun-f472b6.svg)](https://bun.sh)
[![GSAP](https://img.shields.io/badge/motion-GSAP-88CE02.svg)](https://greensock.com)

---

## ⚡ The Origin Story

### *How It Started*
It began as a simple itch: *"Why are all web portfolios and stories linear top-to-bottom scroll dumps or clunky Figma-style canvas pan-and-zoom viewers?"* 

We didn't want users freely panning around an endless void lost in 2D space. We wanted users to **travel *through* nodes and paths**, riding along organic spline curves, taking branching choices at critical intersections, and exploring interactive narrative trees without ever losing their sense of momentum or orientation.

### *How It Ended Up*
What was supposed to be a small interactive script evolved into **Threadrift**: a full-scale, modular spatial engine with:
- Dedicated **vector spline math** (Catmull-Rom + Bézier branch interpolation)
- Multi-input gesture physics with **magnetic node snapping**
- **Zero-drift spatial HTML anchors** rendered directly in the camera coordinate space
- A complete, built-in **Visual Studio Editor (`@threadrift/studio`)** with real-time persistence, drag-and-drop node placement, dynamic edge curve bending, and anchor positioning.

---

## ✨ Features

- 🧭 **Path-Constrained Navigation**: Travel along active paths and make intentional branching decisions. Direction locked to node rest stops for zero accidental turns.
- 🧲 **Magnetic Snap Physics**: Time-based spline motion with exact node stops and a single animation driver.
- 📐 **Dual-Curve Splines**: Smooth Catmull-Rom splines for main trunks, cubic Béziers with start/end curve bias and divergence angles for branch junctions.
- ⚓ **Spatial HTML Anchoring**: Embed React / HTML content in a separate native interaction layer that follows the SVG camera (`<Threadrift.Node>`).
- 🛠️ **Built-in Studio Suite**:
  - **Node Tab**: Add main/branch children, merge nodes, rename, delete (with automatic recursive orphaned node cleanup).
  - **Edge Tab**: Adjust start and end curve sweeps, tweak branch divergence, and delete connections.
  - **Anchors Tab**: Set node-relative top-left offsets ($X$, $Y$) and the available layout width for attached React content. Height and appearance remain component-owned.
  - **Settings Tab**: Live tuning of scroll sensitivity, touch sensitivity, snap strength, and auto-save controls.
- 💾 **Document Persistence**: Versioned graph and settings JSON, queued autosave, manual save/export, browser recovery drafts, and atomic local disk writes with conflict protection. See [PERSISTENCE.md](PERSISTENCE.md).

---

## 📦 Packages & Architecture

Threadrift is structured as a performant Turborepo monorepo:

| Package | Description |
|---|---|
| [`@threadrift/core`](./packages/core) | Pure TypeScript mathematical foundation: Catmull-Rom & Bézier splines, graph topology algorithms, magnetic physics, gesture parsing. |
| [`@threadrift/react`](./packages/react) | React context, store (Zustand), SVG renderer, 60fps GSAP camera loop, navigation listeners, and `<Threadrift.Node>` spatial anchors. |
| [`@threadrift/studio`](./packages/studio) | Floating dark-mode in-browser visual editor panel for manipulating nodes, edges, spatial anchors, and global physics in real-time. |
| [`apps/playground`](./apps/playground) | Next.js 14 playground app showcasing full spatial UI anchoring and real-time auto-saving. |

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/your-username/threadrift.git
cd threadrift
bun install
```

### 2. Run the Playground & Studio

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to explore the interactive canvas and open the Studio Editor!

---

## 💻 Usage Example

```tsx
import { Threadrift, ThreadriftApp } from "@threadrift/react";
import { EditorPanel, EditorToggle } from "@threadrift/studio";

export default function MySpatialStory() {
  return (
    <main className="relative w-full h-screen bg-zinc-950 overflow-hidden">
      {/* Root Provider */}
      <Threadrift.Root>
        {/* Main Canvas & Navigation */}
        <ThreadriftApp>
          {/* Spatial HTML Element anchored to Node 0 */}
          <Threadrift.Node id={0}>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-white w-64 shadow-xl">
              <h3 className="font-bold text-sky-400">Chapter 1: The Root</h3>
              <p className="text-sm text-zinc-400 mt-2">
                This UI is glued to Node 0 and tracks camera motion with zero drift.
              </p>
            </div>
          </Threadrift.Node>

          {/* Spatial HTML Element anchored to Node 1 */}
          <Threadrift.Node id={1}>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-white w-64 shadow-xl">
              <h3 className="font-bold text-emerald-400">Chapter 2: The Fork</h3>
            </div>
          </Threadrift.Node>
        </ThreadriftApp>

        {/* Visual Studio Panel (Toggleable) */}
        <EditorPanel />
        <EditorToggle />
      </Threadrift.Root>
    </main>
  );
}
```

---

## 🎮 Navigation Controls

`Threadrift.Node` is an unstyled positioning container for your React content. Its top-left starts 24px right and below its node by default; Studio → Anchors edits X/Y and width per node. `(0, 0)` aligns it exactly with the node. Width defaults to 320 CSS pixels, height grows with normal-flow content, and canvas motion does not scale your component. Put visual styling on your child component; use `width: 100%` when it should fill the anchor. Existing v1/v2 maps load into v3 with their offsets preserved and legacy anchor scaling removed.

- **Trackpad / Mouse Wheel**: Vertical scrolling travels forward/backward along the selected route. Horizontal input never silently selects another route. Wheel units are normalized, and input is scoped to the map.
- **Junctions**: Continue through the preselected route without a mandatory choice. Priority is your explicit choice, then the author's recommended path, then the straightest continuation relative to the previous node. Equally straight exits prefer the closest destination, then a stable edge ID. At the root, where there is no incoming direction, a main exit is preferred.
- **Node & Edge Clicking**:
  - *Editor OFF*: Path changes are accepted only when scrolling is completely at rest on a node: input is idle and both the target and camera progress have snapped to that exact node.
  - Only routes reachable forward from the resting node can be selected. The travelled path through that node is preserved; clicks between nodes, while settling, or toward a fork already passed do nothing. This applies at every branch depth.
  - Clicking an edge selects that exact connection, including parallel edges and merges. Clicking a future node confirms the route to it, retaining existing planned detours. Selection never moves the camera.
  - *Editor ON*: Clicks select nodes/edges for property inspection and live dragging without also changing the navigation route. Wheel scrolling, swiping on empty canvas, and focused-map keyboard navigation remain available. The camera follows the current node during dragging; only an active node drag temporarily owns motion. Editor fields and panels retain their own scrolling and keyboard input.
- **Touch / Mobile**: Swipe up to advance, down to retreat. Continuous movement follows the whole swipe. A drag is not a tap. Pinch remains available to the browser, and anchored HTML content keeps native interaction.
- **Keyboard / Buttons**: Focus the map and use Up/Down or PageUp/PageDown, or use Previous/Next. Focus destination buttons and press Enter/Space to select. Reduced-motion preferences remove travel interpolation.

Navigation is a small icon row shown at rest. At a junction, **Change route** opens a compact list of destinations; choosing closes it. The controls disappear during travel. Previous/Next and focused-viewer keyboard navigation remain available without opening the route list.

Reverse travel follows the exact edges taken and briefly stops at earlier forks. A fresh swipe continues immediately. Wheel input has a fixed 90 ms pause after arrival, never extended by further samples; a fresh non-momentum burst can bypass it. Wheel gesture separation uses a 90 ms quiet interval and a 40 ms gap shortcut at reverse stops. These timings are input heuristics, not proof of physical gesture boundaries. Route changes still require exact node rest and preserve the travelled prefix.

In **Studio → Node → Recommended path**, choose **Automatic · straightest continuation** or an outgoing destination. The latter saves `recommendedEdgeId` on that node in JSON. Removing the recommended connection restores automatic routing. Existing JSON without this optional field uses automatic routing. Explicit visitor choices always take priority.

Embedded content and custom controls can opt out of navigation with `data-threadrift-ignore`. Custom canvas compositions must mount one `Threadrift.Navigation` alongside `Threadrift.Canvas` per provider. The convenience `ThreadriftApp` includes both.

Imported graphs are validated before being published: a valid root, unique IDs, finite geometry, existing endpoints, and no directed cycles or zero-length connections are required. Failed imports leave the previous graph intact. Valid graph edits cancel active gestures and settle at the last surviving node in the travelled prefix.

## Navigation verification

Build core first, then run `bun run --filter @threadrift/core test` and `bun run --filter @threadrift/react test`. The suites cover strict rest, route precedence, generated DAGs, spline geometry, exact merge/parallel-edge history, input replay, and all complete sample routes. Test fixtures are independent of local persisted playground data.

An opt-in `createInputRecorder(viewerElement)` export records bounded event traces in memory. Its `snapshot()`, `toJSON()`, `clear()`, and `stop()` methods support local hardware diagnosis; it never sends data or records page text. See the [browser test setup and hardware checklist](packages/react/tests/README.md) for integration checks. Simulated touch/wheel events do not certify physical OS momentum.

---

## 📄 Documentation

Looking for the complete manual? Check out [DOCUMENTATION.md](./DOCUMENTATION.md).

The current [document and persistence contract](PERSISTENCE.md) describes saved fields, schema migration, storage adapters, conflict recovery, and how to add future settings. Studio Settings includes **Save now**, **Export JSON**, and safe disk reload with draft recovery.

---

## 📜 License

MIT © [Threadrift Contributors](LICENSE)
