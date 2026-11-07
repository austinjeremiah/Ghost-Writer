# Missing assets

The source scrape (`../template/page_content (13)/`) is an SSR snapshot of the
Ghost Writer page. It contains the rendered HTML, the compiled CSS bundle, two JS
chunks and six messenger icons — but several files the page references were
never downloaded. Everything below 404s until you drop the real file in.

Nothing here blocks the build or breaks the layout: each one has a stand-in.

## Fonts — `public/fonts/`

The stylesheet declares four faces. Drop these exact filenames in and they pick
up with no code change (`src/styles/globals.css` already points at them, and
`src/app/layout.tsx` preloads them):

| File | Family | Weight |
| --- | --- | --- |
| `Aeonik-Regular.woff2` | `Aeonik` | 400 |
| `RecifeDisplayWeb-BookItalic.woff2` | `Recife` | 350 |
| `NeueHaasDisplay-Medium.woff2` | `NeueHaas` | 600 |
| `NeueHaasDisplay-Roman.woff2` | `NeueHaas` | 500 |

All three are commercial licences, which is why they are not redistributable
with the scrape. Until they are present every `font-family` falls through to
the system sans-serif already listed in each stack, so the page is legible but
the display type is not the original cut.

## Videos — `public/`

| File | Used by |
| --- | --- |
| `1.mp4` | `home-2`, the "What does it mean Ghost Writer?" visual |
| `2.mp4` | `home-4`, the "Designed to make life {easier}" visual |
| `screencast.mp4` | `home-5`, the integration screencast |

`src/components/Video/index.tsx` renders the real `<video>` and swaps to a
placeholder with the same box when the source fails, so scroll distances and
sticky offsets stay identical to the original. Drop the files in and the
placeholders disappear.

## Images

- `favicon.ico` — replaced with `public/favicon.svg`, generated from the first
  path of the wordmark (the "flash" glyph) on the brand background.
- `twitter.png` — referenced by the OG/Twitter meta tags; the tags are kept so
  adding the file is enough.

## WebGL scenes

The template mounted two Three.js scenes and a Matter.js widget through chunks
that are **not** in the scrape — `app.modern-*.mjs`, `ButterflyScetch-*.mjs`,
`FallingLetters-*.mjs`, `Butterfly-*.mjs`, `LoadingManager-*.mjs` and friends
are all referenced by `index.html` but absent from the directory. Only their
containers, CSS and mount points survived.

They are rebuilt here from what the surviving CSS and markup imply, not ported:

| Original | Rebuild |
| --- | --- |
| `#gl-2` + `.home__revealer` (Three.js `Scetch`) | `src/components/Revealer` — a 2D-canvas accent wipe on the same scroll range. It also raises `.home-5__video-wrapper`, which the stylesheet ships at `opacity: 0` expecting the scene to reveal it. |
| `#letter-parent` (Matter.js `FallingLetters`) | `src/components/LetterCanvas` — real `matter-js` physics; the letters of GHOST WRITER drop in, collide and settle. Pointer-draggable. |
| `#gl` (`ButterflyScetch`) | Not rebuilt. It had no visible container left in the markup, so there is nothing to reproduce faithfully; the `#gl` CSS rule is kept in `globals.css` if you want to mount something there. |
