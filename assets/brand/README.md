# Threadrift brand assets

The approved logo is `threadrift-logo.png`: the woven pearl, sky-blue, and rose mark, including its original transparency. Preserve this source when updating the README artwork.

## Repository presentation

- `readme-dark.png`: primary 1600 × 880 README card.
- `readme-light.png`: light-background companion, with the approved logo on an ink tile so its pale strands retain contrast.
- `readme-card.html`: editable layout and typography source. Open with `?theme=dark` or `?theme=light`.
- `threadrift-logo.png`: approved transparent 1254 × 1254 raster source.
- `fonts/Manrope-Variable.ttf` and `fonts/OFL.txt`: the locally bundled presentation font and its license.

The root README uses GitHub's `<picture>` theme selection, with the dark artwork as its fallback. Both cards contain the same message and layout. The entire card links to the local playground setup section; the call to action is also repeated as a real Markdown link beneath the image. The route illustration is conceptual brand artwork, not a screenshot of the playground.

Theme support follows [GitHub's documented picture-element behavior](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#the-picture-element). No SVG scripts, external fonts, or remote image services are required to display the README.

## Regenerate the cards

Rendering is optional: the exported PNGs are included in the repository. To edit and regenerate them, install Playwright and its Chromium browser in your development environment:

```bash
bun add --dev playwright
bunx playwright install chromium
```

Then run:

```bash
node scripts/render-brand.cjs
```

The helper uses the installed `playwright` package and its Chromium browser by default. To reuse an external installation, set `THREADRIFT_PLAYWRIGHT_MODULE` to its absolute module path. Set `THREADRIFT_BROWSER_CHANNEL` to an installed channel such as `msedge` or `chrome` if preferred. These overrides are optional; no machine-specific paths are embedded in the helper.

Copy, geometry, and typography are defined in HTML/CSS/SVG. The approved logo remains a raster image and is not represented as an editable vector master.
