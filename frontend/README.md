# Ghostwriter — frontend

The dApp from `docs/GHOSTWRITER_FRONTEND.md`: Home, Set up memory, Get cover,
My policies (+ detail), My memory, Underwriter, Agents and Proof. It talks only
to the backend API and SSE stream described in `docs/GHOSTWRITER_BACKEND.md` §5.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8787
npm install
npm run dev                  # start the backend first (CORS_ORIGINS=http://localhost:3000)
```

| Folder | What lives there |
| --- | --- |
| `src/app/` | one folder per route; `providers.tsx` (react-query, dApp Kit, SSE) loads client-only via `client-root.tsx` |
| `src/lib/` | `types` (ICD), `api`, `events` (one SSE connection), `format`, `errors`, `dapp-kit`, `memwal` (Mainnet), `buy` (Testnet) |
| `src/hooks/` | react-query hooks, `useBorrower`, `useDusdc` |
| `src/components/shell`, `common`, `policy` | app shell, shared widgets, policy pieces |
| `src/styles/app.css` | the app's styles, built on the template's Kido cream/royal-blue tokens |

Policies and money sign on **Sui Testnet**; Walrus Memory steps sign on **Sui Mainnet**.

The original landing-page rebuild below (components under `src/components/`
outside `shell/`, `common/`, `policy/`, plus `src/styles/globals.css`) is still
in the repo but no longer mounted at `/`.

---

# Ghost Writer — Next.js rebuild

> Built from a scrape of a landing page that shipped under the name
> "Flashform" (`../template/page_content (13)/`). The product is now called
> Ghost Writer; the old name survives only in that source directory.

A component-by-component rebuild of the scraped Ghost Writer landing page
(`../template/page_content (13)/`) as a Next.js 16 App Router app.

The scrape is a server-rendered Nuxt snapshot: one `index.html`, a 52 KB
compiled CSS bundle, two JS chunks and six icons. This project takes that apart
into real components — every section, every shared widget, every icon — with
the original copy, markup structure and class names preserved.

## Running it

Use the dev server while you work. It has Fast Refresh: save a file and the
page updates in place, usually inside a second, without a reload and **without
`npm run build`**.

```bash
npm install
npm run dev        # http://localhost:3000 — leave this running
```

`npm run build` makes a production bundle. It is a one-off check before you
ship, not something to run after each edit — in fact `build` output is never
what `npm run dev` serves, so running it mid-work changes nothing on screen.

```bash
npm run build      # production build (pre-ship check)
npm start          # serve that build — no hot reload
npm run typecheck  # tsc --noEmit
```

What Fast Refresh does and does not pick up:

| Change | Result |
| --- | --- |
| Any `.tsx` / `.ts` in `src/` | patched in place, component state kept |
| Any `.css` | restyled in place, no reload at all |
| Files in `public/` | served immediately; hard-refresh if the browser cached one |
| `next.config.mjs`, `postcss.config.mjs`, `components.json` | needs a dev-server restart |
| A brand-new Tailwind class outside `src/components/ui/` | will not generate — see the Theme section on why the scan is scoped |

If the page ever looks stale, it is almost always a cached `public/` asset or a
config change, not a build you forgot to run.

## Theme

The original was lime `#b1dd40` on a near-black `#111606`. This build runs the
**cream + royal blue light theme from the Kido design system**
(`Kido/frontend/public/styles/studio.css`, the `.cl-studio` block). Kido's token
names and values are carried over verbatim so the two codebases stay in step —
including its measured contrast ratios:

| Token | Value | Role here |
| --- | --- | --- |
| `--cl-canvas` | `#fef1d0` | the page ground |
| `--cl-ink` | `#0042af` | all type, rules and icons — 7.8:1 on the cream |
| `--cl-ink-inv` | `#fef1d0` | type on a blue fill (the rounded panels, the popup) |
| `--cl-line` / `--cl-line-strong` | `rgba(0,66,175,.18/.34)` | rules |
| `--cl-wash` | `rgba(0,66,175,.08)` | the ticker band, the column overlay |
| `--cl-scroll` / `--cl-scroll-hover` | `rgba(0,66,175,.24/.42)` | the custom scrollbar |
| `--cl-scrim` | `rgba(1,13,110,.4)` | the popup backdrop |
| `--cl-shadow` | `rgba(1,13,110,.28)` | the glow under each over-revealer |
| `--cl-deny` | `#b0143f` | form validation |

Two roles sit on top of those — `--bg` and `--fg` — and the template's own
`--black` / `--accent` are kept as aliases onto them, so all 27 ported
stylesheets work unchanged. `--black` means "the ground" and `--accent` means
"everything drawn on it"; they are named for the original dark theme, not for
literal colours. Retheming is a two-line change at the top of
`src/styles/globals.css`.

Every icon is drawn in `currentColor`, so it takes the colour of wherever it
sits — blue on the page, cream on the blue panels — with no per-icon rules. The
six messenger icons in `public/icons/` are the exception: they load through
`<img>`, which cannot inherit `currentColor`, so their fill is set in the file.

Two things needed deciding rather than translating:

- **All type is `--cl-ink` royal blue, headings included.** Kido reserves
  `--cl-ink-heading` (`#0c1424`, near-black) for headings; the token is defined
  and unused, so pointing `--fg-heading` at it brings that separation back.
- **The navbar lost `mix-blend-mode: difference`.** The original relied on the
  type being one of the two ground colours, so it stayed lime over the dark page
  and flipped to black over the lime panels. With cream and royal blue the same
  blend resolves to mustard over the page and purple over the panels, so the
  blend is off and `.navbar__content` carries a translucent `--cl-panel` ground
  instead. The bar stays royal blue everywhere, over page and panel alike.

## How the original's machinery was rebuilt

The compiled animation modules (`animations-*.mjs`, `Ticker-*.mjs`,
`SplitHeading-*.mjs`, `Sticky-*.mjs`, `HorizontalScroll-*.mjs`, …) are
referenced by `index.html` but are not in the scrape. What survived is the CSS,
which pins down the starting state of every animation precisely — so the
engine here is written against those rules rather than guessed at.

**Scrolling.** The page scrolls inside `#scroll-container`, not the window. On
desktop `SmoothScroll` intercepts wheel/key/touch input and lerps the
container's `scrollTop` (`friction: 0.07`, `stepSize: 0.8` — the template's own
settings), exposed as `window.ss`. Below 1060px it steps aside and the
stylesheet's native `overflow-y: auto` takes over. ScrollTrigger is pointed at
the same element.

**Reveals.** The stylesheet pre-styles five attributes, and `lib/animations.ts`
animates each back to rest:

| Attribute | Start state in CSS | Animation |
| --- | --- | --- |
| `data-a-h` | chars at `translateY(100%) scaleY(1.5)`, opacity 0 | chars rise and un-squash, staggered |
| `data-a-p` | `.line-inner` at `translateY(100%)`, opacity 0 | lines rise behind their `.e-line` mask |
| `data-a-t` | `translateY(100%)`, opacity 0 | rises inside its `data-a-twrapper` mask |
| `data-a-l` | `scaleX(0)`, origin left | rule draws out to the right |
| `data-a-o` | opacity 0 | fade |

`data-in-view="0.4"` on a section sets how far it must enter the viewport
first. `splitText` builds the `.e-line > .line-inner > .word > .char` nesting
those rules target.

**Scroll effects.** `data-section-scale` (0.88 → 1), `data-section-sticky` +
`data-section-sticky-scroller` (the pinned green panels), `data-cards-scale`
(the fanned benefits stack), and the `.wrapper > .scroller > .scroller-el`
horizontal scrollers used by the integration heading and the roadmap.

**Reused components.** `home-3` appears twice — "Purpose of using Ghost Writer"
and "Problems that we solve" — so `sections/Purpose` takes its heading and
cards as props and `sections/ProblemsWeSolve` is the second configuration.

## Deviations from the original

Everything below is a deliberate, documented change. Nothing else differs.

- **The two Three.js scenes and the Matter.js letter widget are rebuilds, not
  ports** — their chunks are missing from the scrape. See MISSING-ASSETS.md.
- **The forms have no backend.** The template posted to an endpoint that is not
  part of the scrape, so both the footer form and the beta popup validate,
  acknowledge through the toast stack, and reset.
- **Anchor links are handled in JS** (`Navbar`), because the browser's native
  hash jump does not reach inside `#scroll-container`.
- **The 12-column debug grid is bound to the `g` key.** The template's handler
  shipped empty, but the overlay and its CSS were still there.
- **`AGENTS.md` is generated by `next dev`**, not written by hand.
