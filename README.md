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
- 🧲 **Magnetic Snap Physics**: Smooth camera interpolation (60fps GSAP pipeline) with intelligent dead-zones and snappy integer landing on nodes.
- 📐 **Dual-Curve Splines**: Smooth Catmull-Rom splines for main trunks, cubic Béziers with start/end curve bias and divergence angles for branch junctions.
- ⚓ **Zero-Drift HTML Anchoring**: Embed rich React / HTML components anchored directly to graph nodes with subpixel-perfect alignment via native SVG coordinate projection (`<Threadrift.Node>`).
- 🛠️ **Built-in Studio Suite**:
  - **Node Tab**: Add main/branch children, merge nodes, rename, delete (with automatic recursive orphaned node cleanup).
  - **Edge Tab**: Adjust start and end curve sweeps, tweak branch divergence, and delete connections.
  - **Anchors Tab**: Fine-tune spatial offsets ($X$, $Y$) and scale multipliers for attached HTML elements.
  - **Settings Tab**: Live tuning of scroll sensitivity, touch sensitivity, snap strength, and auto-save controls.
- 💾 **Real-time Auto-Persistence**: Instant disk sync via local API endpoints with localStorage fallback.

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

- **Trackpad / Mouse Wheel**: Scroll forward / backward along the currently active path.
- **Node & Edge Clicking**:
  - *Editor OFF*: Path changes are accepted only when scrolling is completely at rest on a node: input is idle and both the target and camera progress have snapped to that exact node.
  - Only routes reachable forward from the resting node can be selected. The travelled path through that node is preserved; clicks between nodes, while settling, or toward a fork already passed do nothing. This applies at every branch depth.
  - Clicking an edge selects that specific connection, including at merges. Clicking a node already on the active path does not move the camera or rewrite the route.
  - *Editor ON*: Clicks select nodes/edges for property inspection and live dragging without also changing the navigation route.
- **Touch / Mobile**: Single-finger swipe up/down/left/right follows branching path vectors.

Gesture-driven branch changes use the same complete-rest rule. Returning to a fork and fully settling there allows a different branch to be selected again.

---

## 📄 Documentation

Looking for the complete manual? Check out [DOCUMENTATION.md](./DOCUMENTATION.md).

---

## 📜 License

MIT © [Threadrift Contributors](LICENSE)

