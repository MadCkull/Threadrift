# Threadrift design context

Existing surface: a dark spatial map with bright routes, node labels, and anchored story content. Visitors follow that content on desktop and phone; navigation should recede against the existing dark canvas rather than introduce a new theme.

Use the product register and a restrained palette. Reuse the host font, muted neutral controls, and a single cool accent for the active route. New control colors use OKLCH.

Navigation is a compact row of 44px icon targets at rest. Only junctions expose a route toggle. Destination names appear in a small, scrollable list on demand, with the chosen route clearly marked. The list closes when movement starts, selection completes, focus leaves, or Escape is pressed.

Avoid a persistent card, instructional paragraphs, decorative blur, and layout animations. Preserve visible focus, reduced motion, and space around the playground's Studio toggle. Existing editor fields retain their established styling.

Studio uses a selection-driven inspector. Nothing selected shows a short prompt; selecting a node or edge reveals its controls. An Inspect picker supports keyboard selection and narrow screens. Anchors expand within the node inspector; document settings and statistics remain available in a Settings disclosure. Scroll sensitivity, touch sensitivity, snap strength and snap threshold stay in a separate visible navigation area. The inspector scrolls independently and returns to the top when selection changes. Closing and reopening preserves selection; loading a document starts with no selection. A completed blank-canvas tap deselects; swipes retain selection.

Studio camera tools use compact labelled Freeze and Set view buttons with pressed states for selected nodes. Active modes show their meaning, a node destination selector and Return to route even after deselection. Node camera controls provide capture, preview, X/Y and Reset to Follow when a saved view exists; Edge controls provide travel mode and a movement window. Saved-view guides are editor-only. Merge cancellation remains available across selections. Node actions follow hierarchy, existing connections and valid merge targets. Numeric edits commit on Enter/blur and revert on Escape. The opaque panel uses the existing neutral palette; its labelled close button replaces the floating toggle while open.
