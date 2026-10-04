# Camera and view authoring

Threadrift keeps visitor travel on graph paths while allowing authors to frame the view separately from node placement. Maps without saved views retain the existing path-following behavior.

## Studio workflow

- **Freeze** captures the current view and pauses route travel. Dragging a node, moving its position slider, or editing its position numbers saves that view with the moved node. A click or a move back to the starting position does not create a saved view.
- **Set view** lets you drag the map to position an editor preview without moving nodes. Choose a **View destination**, then use **Use current view** in the Node tab to save it. This switches to Freeze so later node placement keeps that view.
- **Camera X/Y** specify the saved center in graph coordinates. Enter or blur commits a complete value; Escape restores the previous value. Zero and negative values are supported.
- **Preview view** inspects the selected node's resolved view without travelling or marking it visited. The destination list can select nodes that are offscreen or outside the active route.
- **Return to route** resumes the route view. Turning Freeze off and closing Studio keep saved views. The return takes 180 ms, or finishes on the next animation frame with reduced motion enabled.
- **Reset to Follow** removes the selected node's saved view and previews its normal node-centered view. Use Return to route to resume navigation.

Saved centers stay fixed when a node is moved outside Freeze. To update one, use Freeze again, edit Camera X/Y, or capture a new view. During frozen or preview modes, map travel is paused; native content scrolling and browser zoom remain available. A guide links the selected node to its saved center.

## Camera travel on a connection

The Edge tab provides **Follow path shape** and **Direct between views**. The default follows the visible curve while blending the endpoint camera offsets. Direct travel interpolates the endpoint views independently of the curve.

**Move starts (%)** and **Move ends (%)** define the movement window along the connection's graph distance. Before that window the view holds at the starting center; after it, the view holds at the destination. The window must span at least 0.1%. Backward travel retraces the same positions and timing window. Reset camera travel removes the override.

When both endpoint nodes have exactly the same saved center, the camera holds still throughout the connection, including on curved paths. The visitor still advances through the graph, reveals the path and reaches the next node normally. Camera distance never determines scrolling distance or branch eligibility.

Path-shaped transitions guarantee matching endpoint positions, not constant visual velocity or continuous velocity at every graph junction. Large camera offsets over short connections can produce rapid visual movement. Preview the actual route in both directions when composing these transitions.

## Saving and cancellation

Node dragging and position sliders preview the candidate graph in memory. Save/export/recovery snapshots contain the previously committed graph until release. A successful release validates and commits node placement and its camera together, then uses the existing autosave setting and save queue. Numeric position changes commit one complete edit.

Escape, pointer cancellation, lost capture, a second pointer, blur, resize, hiding the page, closing Studio and teardown cancel an unfinished node drag. Earlier completed edits remain. Invalid positions retain the last valid preview and show an error; release commits that valid preview if it differs from the starting position. Imports, deletions and competing graph edits invalidate the transaction before applying newer data, so stale pointer events cannot restore an older graph.

Panning in Set view changes only the preview. Cancelling that gesture restores its starting preview. Capture the view explicitly to persist it.

## Document and API

Canonical document version is `4.0`. Versions 1–3 migrate with no saved camera fields and retain their default behavior; the existing anchor migration still applies. Older readers should reject version 4 instead of dropping camera intent.

```json
{
  "nodes": {
    "7": {
      "id": 7,
      "name": "A framed stop",
      "content": "",
      "x": 600,
      "y": 800,
      "camera": { "x": 520, "y": 730 }
    }
  },
  "edges": [
    {
      "id": "connection",
      "from": 3,
      "to": 7,
      "type": "main",
      "curve": 0,
      "camera": { "mode": "direct", "start": 0.2, "end": 0.8 }
    }
  ]
}
```

This is a field example, not a complete importable graph. Node cameras require both finite X/Y values within ±1,000,000,000 graph units. Edge cameras require a supported mode and a finite movement window. Unknown properties, unsafe descriptors and malformed values are rejected. Exported camera data is detached from the live store.

The store exposes `setNodeCamera(id, point | undefined)`, `setEdgeCamera(id, transition | undefined)`, `setCameraMode("follow" | "freeze" | "position")`, `moveCameraPreview(point)`, `previewNodeCamera(id)` and `captureNodeCamera(id)`. Clear an authored field with `undefined`. Camera-only edits preserve route progress and geometry; they do not recompute topology. `flyToNode` continues travelling on the active route and now resolves authored views automatically.

`sampleCamera(routeGeometry, progress)` in core is the pure playback sampler. `resolveCamera(storeState)` in React includes editor preview and return state. `sampleRoute` remains responsible for graph position, distance and reveal. Runtime modes, pointers and return animation never belong in exported JSON.

## Viewport behavior

The saved center refers to the full canvas center, including while Studio overlays it. Resizing changes the crop, not the saved center. HTML anchors stay attached to their nodes with their existing CSS-pixel offsets and intrinsic size. Visibility is computed around the actual view and includes curves crossing the viewport even when both endpoints are outside it.

This release controls position and connection timing. It keeps the existing camera scale, has no camera rotation or responsive framing presets, and does not add a global undo history. Check narrow and wide layouts for the content you author. Browser touch emulation verifies event handling; physical trackpad/phone feel still needs device testing.
