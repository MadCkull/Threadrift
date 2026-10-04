# Threadrift design context

Existing surface: a dark spatial map with bright routes, node labels, and anchored story content. Visitors follow that content on desktop and phone; navigation should recede against the existing dark canvas rather than introduce a new theme.

Use the product register and a restrained palette. Reuse the host font, muted neutral controls, and a single cool accent for the active route. New control colors use OKLCH.

Navigation is a compact row of 44px icon targets at rest. Only junctions expose a route toggle. Destination names appear in a small, scrollable list on demand, with the chosen route clearly marked. The list closes when movement starts, selection completes, focus leaves, or Escape is pressed.

Avoid a persistent card, instructional paragraphs, decorative blur, and layout animations. Preserve visible focus, reduced motion, and space around the playground's Studio toggle. Existing editor fields retain their established styling.

Studio camera tools use compact labelled Freeze and Set view buttons with pressed states. Active modes show their meaning, a node destination selector and Return to route. Node camera controls provide capture, preview, X/Y and Reset to Follow; Edge controls provide travel mode and a movement window. Saved-view guides are editor-only. Studio tabs stack icon and label to fit the panel, including narrow screens. Numeric edits commit on Enter/blur and revert on Escape.
