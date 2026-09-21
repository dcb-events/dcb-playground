# Layouts — DCB Playground

One page, one shell. No framework, no router. The static HTML skeleton lives in
`app/index.html:966-997`; everything inside `#rail`, `#main`, the topbar spans, `#modal-host`
and `#palette-host` is (re)built by JS on every `render()`.

## The HTML skeleton (app/index.html:966-997)

```html
<body>

<div class="topbar">
  <div class="disclaimer">Experimental — everything here is subject to change.</div>
  <div class="app-bar">
    <span id="menu-toggle"></span>
    <button type="button" class="brand-link" title="Home — examples, FAQ, and starting a new model"
            onclick="closeForms(); state.splash = true; render();">
      <img class="brand-mark" src="logo-mark.png" alt="" aria-hidden="true">
      <h1>DCB Playground</h1>
    </button>
    <span id="model-switch"></span>
    <span id="tools"></span>
    <span class="spacer"></span>
    <span id="jump"></span>
    <span id="actions"></span>
  </div>
</div>

<div class="layout">
  <div class="rail-backdrop" id="rail-backdrop" onclick="state.railOpen = false; render();"></div>
  <aside class="rail" id="rail"></aside>
  <main class="slice" id="main"></main>
</div>
<footer class="site-footer">
  © <span id="footer-year"></span> – … CC BY-SA 4.0 … · <a href="https://dcb.events">dcb.events ↗</a>
</footer>
<div id="modal-host"></div>
<div id="palette-host"></div>
```

Script load order (all classic scripts, one global scope, index.html:999-1003):
`model.js` → `evaluate.js` → `shared.js` → `webmcp-schemas.js` → `webmcp.js` → inline app script.

## Top header bar

Two stacked strips that stick together as one unit:

```css
/* app/shared.css:97-111 */
.topbar { position: sticky; top: 0; z-index: 20; }
.disclaimer {
  text-align: center; font-size: 11.5px; font-weight: 700; letter-spacing: .01em;
  padding: 5px 12px;
  background: #fef3c7; color: #92400e; border-bottom: 1px solid #fde68a;
}
.app-bar {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 18px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.app-bar .spacer { flex: 1; }
```

The bar's real height is measured into `--topbar-h` by `syncTopbarHeight()`
(app/index.html:10008-10015, initial value 86px in shared.css:10) — everything docking under
it (`.layout` min-height, sticky slice header, mobile rail) reads that token.

Slots filled by `paintPage()` (app/index.html:3695-3777):
- `#menu-toggle` — hamburger `.icon-btn.menu-btn`, only visible ≤760px (3753-3757).
- `.brand-link` — logo + title, opens the splash (static HTML).
- `#model-switch` — ghost button with the open model's name (`.model-name`, ellipsized),
  opens the Models modal / "← Back to X" on the splash (3711-3723).
- `#tools` — the Problems button + badge, only when there are problems (3762-3763);
  `#tools:empty { display: none; }` (shared.css:133).
- `#jump` — the quick-open `.trigger` fake search field with `⌘K` kbd hint (3765-3768;
  CSS shared.css:161-173).
- `#actions` — import/export `.icon-btn` and `settingsButton()` (3770-3774; settingsButton
  app/index.html:1446-1459).

Scroll behavior: `paintPage` toggles `body.scrolled` past 60px; the sticky slice header then
gains a bottom border/shadow and hides its summary lines (CSS index.html:632-639).

## The two-column layout + left rail

```css
/* app/index.html:11-16 */
.layout { display: grid; grid-template-columns: 250px 1fr; min-height: calc(100vh - var(--topbar-h)); }
.layout.no-rail { grid-template-columns: 1fr; }   /* splash: no rail, full row */
.rail { border-right: 1px solid var(--border); background: var(--surface); padding: 14px 0; }
.rail-backdrop { display: none; }
```

### Rail contents — `renderRail()` (app/index.html:3148-3375) + `renderEntityRail()` (3380-3420)

Section order (all `h4` headings, uppercase via base `h4` style):

1. **Features** — feature groups (`featureGroups`, shared.js:1175), each a `.group` heading
   row (caret ▸/▾, name, hover-visible `+` gadd and remove) over `.rail a.cmd` command links
   (emoji mark + readable name, drag-and-drop between features, `.on` state = current page).
   Then `.add` row: `+ Command` (`.btn`) and `+ Feature` (`.btn ghost`). Inline forms
   (`inlineForm`, `newCommandForm`) render in place in the rail.
2. **Model** — the collapsible **Entities** list (same `.group` two-level pattern, `a.cmd.ent`
   rows in entity green, `+ Entity` ghost button), then links: *Custom types* (Advanced only),
   *Projections* (Advanced or non-empty), *Events* (Advanced or non-empty).
3. **Overview** (Advanced + commands exist) — *Coupling*, *Rule map*, *Lifecycles*.
4. **Try it** — *Sandbox*, with a right-aligned `.gcount` event-count pill.
5. **Nothing uses these** — orphaned entities as quiet `.loose` qrows with a reveal-remove.

Key rail CSS (app/index.html:38-89):

```css
.rail h4 { padding: 0 16px 8px; }
.rail a {
  display: block; padding: 6px 16px; font-size: 13px;
  color: var(--text); text-decoration: none; border-left: 3px solid transparent;
}
.rail a:hover { background: var(--command-soft); }
.rail a.on { border-left-color: var(--command); background: var(--command-soft); font-weight: 600; }
.rail a.cmd { padding-left: 32px; cursor: grab; }
.rail a.ent:hover { background: var(--entity-soft); }
.rail a.ent.on { border-left-color: var(--entity); background: var(--entity-soft); }
.group {
  display: flex; align-items: baseline; gap: 6px;
  padding: 9px 16px 3px; font-size: 12px; font-weight: 600;
}
.group .gcount {
  font-weight: 400; font-size: 10px; color: var(--muted);
  background: var(--bg); border-radius: 999px; padding: 0 6px;
}
.group.drop-into { background: var(--command-soft); border-radius: 6px; }
.gempty { padding: 2px 16px 4px 32px; font-size: 11px; color: var(--muted); font-style: italic; }
```

Selection color coding: command rows highlight in command blue, entity rows in entity green —
"the rail says which of the two lists you are in without a heading having to" (comment at 84-86).

## Main content area

`#main` gets `class="slice"` per paint — `max-width: 800px; padding: 22px 30px 70px`
(index.html:137). Overview pages (coupling / rule map / lifecycles) get `slice wide`
(`max-width: 1100px`, index.html:806). The splash clears the class entirely and renders
`.splash` (max-width 860px, centered; CSS 561-622, JS `renderSplash` index.html:1318-1445).

Command pages pin their header: `.slice > header { position: sticky; top: var(--topbar-h); … }`
(index.html:140-144).

## Modal overlay machinery

`#modal-host` — one modal at a time, priority order in `renderModals()`
(app/index.html:1535-1550): import gate > Problems > Settings > Import/Export > Models.
All wrapped by `overlayAround(modal, close)` (1583-1588) — `.overlay` fixed backdrop
(rgba(15,23,42,.22), z-index 40) with click-on-backdrop-only dismissal, `.modal` 540px panel
(CSS index.html:423-436). Quick open renders separately into `#palette-host` (`renderPalette`,
index.html:2117-2200) with its own tighter `.palette` panel (z-index via overlay, CSS 508-533).

Escape / ⌘K / arrow keys etc. are global listeners registered near the bottom of the inline
script (search `addEventListener('keydown'` around index.html:10020+).

## Responsive / mobile

Single breakpoint at **760px** (plus 720px for `.drift` two-column → one, 560px for splash
example grid):

```css
/* app/index.html:18-37 — the rail becomes an off-canvas drawer */
@media (max-width: 760px) {
  .layout { grid-template-columns: 1fr; }
  .rail {
    position: fixed; top: var(--topbar-h); bottom: 0; left: 0; z-index: 25;
    width: 82vw; max-width: 300px; overflow-y: auto;
    box-shadow: 2px 0 20px rgba(15, 23, 42, .2);
    transform: translateX(-100%); transition: transform .18s ease;
  }
  .rail.open { transform: translateX(0); }
  .rail-backdrop.open {
    display: block; position: fixed; inset: var(--topbar-h) 0 0 0;
    background: rgba(15, 23, 42, .35); z-index: 24;
  }
}
```

```css
/* app/shared.css:181-198 — the bar compacts, touch targets grow to 40px */
@media (max-width: 760px) {
  .app-bar .menu-btn { display: inline-flex; }
  .app-bar { gap: 6px; padding: 8px 10px; }
  .brand-link h1 { display: none; }
  .app-bar .model-name { max-width: clamp(40px, calc(100vw - 266px), 220px); }
  .app-bar .icon-btn, .app-bar .trigger { width: 40px; height: 40px; }
  .app-bar .trigger .label, .app-bar .trigger .kbd { display: none; }
}
```

Drawer state is `state.railOpen`; `renderRail` toggles `.open` on `#rail` and
`#rail-backdrop` (index.html:3151-3154); backdrop click and any rail link close it.

## Footer

`.site-footer` (CSS index.html:627-630) — centered muted license line, sits after `.layout`
so it closes both the splash and model views; year filled by `setFooterYear()`
(index.html:10016).
