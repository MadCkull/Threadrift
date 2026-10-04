# Graph documents and saving

Updated 2026-10-04. The JSON is the authored document; navigation sessions and computed layout are not part of it.

## What is saved

| Editor data | Document location |
| --- | --- |
| Root and next unused node ID | `root`, `nextNodeId` |
| Node name, content, X/Y | `nodes[id]` |
| Anchor offsets and layout width | `nodes[id].anchorX`, `anchorY`, `anchorWidth` |
| Recommended outgoing connection | `nodes[id].recommendedEdgeId` |
| Saved camera center | `nodes[id].camera.x`, `camera.y` |
| Edge identity, endpoints, main/branch type | `edges[]` |
| Start/end curve and divergence | `edges[].curve`, `curveEnd`, `diverge` |
| Camera movement mode and travel window | `edges[].camera.mode`, `camera.start`, `camera.end` |
| Wheel/touch sensitivity, snap strength/threshold | `settings.physics` |
| Autosave preference | `settings.editor.autoSaveEnabled` |
| Application-specific JSON data | `extensions` on the document, settings, nodes or edges |

All four physics controls are available in Studio Settings. Turning autosave off keeps subsequent edits local; **Save now** commits them, including the disabled preference. Graph changes and settings share one save queue.

`level`, sequence IDs, tangents, geometry caches, cursor/target, branch choices, visited nodes, editor selection, open panels, and save status are runtime state. They are omitted from exports and recomputed/reset on load. Visitor history is session-local, avoiding the former global localStorage history leaking between maps. React content supplied as component children remains application code; authored `node.content` is a persisted string.

## Schema and future fields

Anchor coordinates are offsets from the node to the container's **top-left corner**, measured in CSS pixels. Unspecified offsets default to `(24, 24)`; explicit `(0, 0)` starts exactly at the node. `anchorWidth` is a positive finite number of CSS pixels, defaulting to 320. Height is intrinsic. Children receive an ordinary containing block and may use its width or set their own dimensions. No centering transform, content scale, border, padding, background or clipping is supplied by Threadrift. Camera projection moves anchor positions without scaling their contents; browser zoom and application CSS still behave normally. For useful auto height, children should participate in normal flow (an absolutely positioned child cannot give its parent height).

`@threadrift/core` owns the schema and its defaults:

- `parseGraphDocument(unknown)` validates and migrates a v1, v2, v3 or v4 document into canonical `"4.0"`.
- `serializeGraphDocument(...)` produces a detached snapshot of durable fields. Mutating an export cannot change the live store.
- `GraphDocument`, `DocumentSettings`, `PhysicsSettings`, `PHYSICS_BOUNDS` and `DEFAULT_DOCUMENT_SETTINGS` are shared contracts.

Existing v1 maps receive explicit settings defaults when loaded. V1/v2 anchors migrate to top-left placement with CSS-pixel offsets and width; their deprecated `anchorScale` is removed. Existing X/Y values are retained, so old centered/scaled layouts may need repositioning. V3 rejects `anchorScale` rather than accepting a setting with no effect. Missing settings are filled; malformed supplied values are rejected. Unknown versions and unsupported fields are rejected, never silently discarded. Known legacy computed node fields are deliberately stripped. Custom data belongs in a namespaced `extensions` object with finite plain JSON values. Cycles, functions, getters, sparse arrays, unsafe prototype properties and excessively deep values are rejected.

V4 adds optional saved node camera centers and per-edge camera transitions. V1–v3 migrate without adding camera overrides; earlier versions reject those fields. Node centers are finite graph-space X/Y within ±1e9. Edge transitions use `path` or `direct` with `0 <= start < end <= 1` and a minimum window of `.001`. Equal saved endpoint views hold still. See [camera authoring](CAMERA.md) for behavior and API contracts.

To add an authored setting: define its type/default/bounds in core, add validation/migration, connect the editor to a store action that marks the document dirty, and add round-trip coverage. Change the schema version when a format change cannot be represented compatibly. Avoid serializing the entire Zustand state.

## Save and load lifecycle

`packages/react/src/persistence/` contains the transport contracts, HTTP adapter and per-store coordinator. Accepted edits create an immediate browser recovery draft and schedule a 250 ms save. Pointer/slider node movements now preview separately: node coordinates and the captured camera are committed together on release. Save, export and recovery drafts exclude unfinished previews. Numeric changes commit complete values. Only one request per coordinator writes at a time. Later edits are coalesced into a follow-up snapshot; acknowledging an older snapshot never marks newer edits saved. Failed writes remain visible and can be retried with **Save now**. HTTP requests time out after 15 seconds.

The Settings panel distinguishes unsaved, saving, saved and error states. No timer later overwrites a newer status. Manual save, autosave and imports use the same queue. Physics-only edits trigger saving. Disabling autosave cancels a pending debounce; an already sent write may finish, but later unsaved edits remain dirty.

Loads validate fully before publishing. A stale reload cannot replace a newer edit or import. Reload is refused during a save, and discarded if a save starts while the read is pending, even if that save finishes first. **Reload from disk** loads a clean document. With unsaved edits, **Load disk copy (keep draft)** first verifies that the latest draft was stored, then exposes restore/discard controls. If browser storage is unavailable or full, it refuses that replacement and offers **Export JSON** instead.

On reopening, a draft based on the same disk revision is recovered. A conflicting draft is offered separately instead of silently replacing newer disk data. Offline recovery retains the old revision precondition, so reconnecting cannot blindly overwrite newer changes. Dirty pages keep a recovery draft on visibility/page exit and request the browser's standard unsaved-change warning. Provider unmount preserves the draft and attempts pending autosave; browser exit/network delivery is never treated as a confirmed disk save.

`loadGraph(data, { revision, source })` is the validated load boundary. `importGraph(data)` (also used by the imperative import API) marks an imported document dirty. `toJSON()` exports it. Use store actions for edits; direct mutation of Zustand internals bypasses change tracking.

## Storage adapters and isolation

`Threadrift.Root` accepts optional `persistence` configuration, captured when the provider is created:

```tsx
<Threadrift.Root persistence={{ endpoint: "/api/my-map", storageKey: "threadrift:my-map" }}>
  {/* canvas, content and editor */}
</Threadrift.Root>
```

Set `persistence={false}` for a viewer without saving, or supply a `PersistenceAdapter` with `load` and `save`. Each save receives a detached `GraphDocument` and the last acknowledged revision. Distinct documents need distinct storage keys. Providers have independent queues; providers/tabs editing the same server document are protected by server revision checks.

The default adapter uses `/api/graph` and the endpoint-scoped draft key `threadrift:draft:/api/graph`. Only a missing default API (404) permits static `/data/graph.json` fallback. Corrupt files or server errors do not silently load an older static copy. Custom endpoints have no implicit fallback. `initialData` does not establish an HTTP revision: authoring against an existing HTTP document must first load its revision (through the adapter or `loadGraph` options). This prevents an arbitrary initial graph overwriting a different saved file.

## Disk writes and recovery

The playground's thin route delegates to `src/server/graph-repository.ts`. Its default path remains `public/data/graph.json`. `THREADRIFT_GRAPH_PATH` is a trusted server-side override used for isolated tests.

- GET returns a validated document and a strong ETag derived from the exact disk bytes.
- POST requires `If-Match` from the load; creating a missing file requires `If-None-Match: *`.
- An exclusive file lock covers revision comparison, backup and commit across processes.
- Writes use a unique same-directory temporary file, file sync and atomic rename. The previous valid bytes are atomically retained in `graph.json.bak` before replacing the main file.
- Invalid documents/UTF-8, non-finite geometry, stale revisions and bodies over 5 MiB are rejected before replacing the document. Reads are uncached. A corrupt existing document is not overwritten automatically.

On a conflict, export your edits or load the disk copy while keeping a local draft, then decide which content to restore. There is no automatic merge. A `.bak` contains the prior valid disk document; restore it deliberately after stopping writers and inspecting both versions. A crashed process can leave `.lock`: verify its recorded PID is no longer writing before manually removing that lock. The repository never steals a lock based solely on age.

These guarantees target local authoring. Atomicity does not mean unlimited history or immunity to filesystem/hardware failure. The same-origin check is not authentication; a hosted editor needs an authenticated, authorized storage adapter/endpoint.

## Verification

Core schema tests cover migration, durable-field round trips, detached snapshots, extensions, invalid versions/settings and derived geometry. React tests cover save ordering, failed retries, multiple stores, autosave cancellation, stale reload/import responses and local recovery including quota failure. Disk/API tests use temporary directories and independent writer processes. Browser persistence tests use an explicit `.turbo` fixture on a separate port, exercise actual editor controls and disk writes, reload, and assert the real sample file is unchanged. Reproduction commands are in `packages/react/tests/README.md` and `apps/playground/tests/tsup.config.ts`.
