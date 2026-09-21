# Theme — DCB Playground

No Tailwind, no preprocessor. Two stylesheets: `app/shared.css` (tokens, chrome, generic
bits — 308 lines) and the `<style>` block in `app/index.html:10-964` (everything
page-specific). Every color is a CSS custom property on `:root`; dark mode is a class
(`body.f-dark`) that redefines the same tokens, driven by JS (`isDark()`,
app/shared.js:554, honoring a stored choice or `prefers-color-scheme`).

## Part 1 — Token digest

### Colors (semantic, kind-coded — the core of the design language)

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--command` | `#2563eb` (blue) | `#60a5fa` | commands, primary actions, focus, links |
| `--command-soft` | `#eff6ff` | `#16243d` | command tint / hover / selection bg |
| `--event` | `#f97316` (orange) | `#fb923c` | events, "recorded" |
| `--event-soft` | `#fff7ed` | `#2d1c0d` | |
| `--entity` | `#16a34a` (green) | `#4ade80` | entities AND projections (deliberately shared) |
| `--entity-soft` | `#f0fdf4` | `#0f2a1c` | |
| `--projection` / `--projection-soft` | alias of entity tokens | — | |
| `--rule` | `#c026d3` (fuchsia) | `#e879f9` | constraints/rules — a gate, not a thing |
| `--rule-soft` | `#fdf4ff` | `#2a1130` | |
| `--type` | `#6b7280` | `#94a3b8` | type names |
| `--type-soft` | `#f9fafb` | `#172030` | neutral chip bg, ledger head |
| `--bg` | `#f8fafc` | `#0b1220` | page background |
| `--surface` | `#ffffff` | `#131c2e` | cards, rail, bar, modals |
| `--border` | `#e2e8f0` | `#22304a` | |
| `--border-strong` | `#cbd5e1` | `#3a4b69` | |
| `--text` | `#0f172a` | `#e2e8f0` | |
| `--muted` | `#64748b` | `#93a3b8` | |
| `--danger` | `#dc2626` | `#f87171` | advisories, remove, rejected |
| `--danger-soft` | `#fef2f2` | `#2d1414` | |

Hardcoded exceptions (not tokens): chip border/text colors per kind (e.g. `.chip.event`
border `#fed7aa` text `#9a3412`, re-stated for dark at shared.css:66-69), `.btn.primary:hover`
`#1d4ed8`, disclaimer amber `#fef3c7`/`#92400e`, shadow rgba(15,23,42,…) slate.

### Typography

- Body: `font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- Mono: `--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace` — used for
  identifiers, chips, DCB queries, scenario lines, payloads.
- Headings all `margin: 0; font-weight: 600`: h1 16px, h2 15px, h3 13px;
  **h4 is the label style**: `11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted)`.
- Utility sizes: `.small` 12px, `.tiny` 11px, `.tech` 10px mono; UI text commonly 12–13.5px.
- No web fonts — system stacks only.

### Spacing, radii, shadows, misc

- `--radius: 8px` (cards, ledgers); smaller radii hardcoded: 5px (inputs, script areas),
  6px (buttons, toasts, inline-forms, scenarios), 7px (advisories, issues, opts),
  9-10px (modals, icon-btn), `999px` (chips, pills, lc-nodes).
- `--topbar-h: 86px` — live-measured topbar height (JS `syncTopbarHeight`).
- Spacing is ad hoc (no scale): common values 6/8/9/12/14/16/22px; rail rows pad `6px 16px`;
  slice pads `22px 30px 70px`.
- Shadows: modal `0 18px 50px rgba(15,23,42,.28)`; palette `0 22px 60px rgba(15,23,42,.34)`;
  popovers `0 8px 24px rgba(0,0,0,.18)`; toast `0 6px 20px rgba(15,23,42,.25)`.
- Colored 3px left borders = kind identity on cards, rail selection, ledger rows, advisories.
- Breakpoints: 760px (rail drawer + bar compaction), 720px (`.drift` stacks), 560px (splash grid).
- Animation: minimal — `.landed` 1.1s background fade, rail drawer `.18s ease` transform,
  FAQ chevron `.15s`.

## Part 2 — Raw token blocks

### `:root` + dark theme (app/shared.css:4-73, verbatim)

```css
:root {
  --topbar-h: 86px;
  --command: #2563eb;
  --command-soft: #eff6ff;
  --event: #f97316;
  --event-soft: #fff7ed;
  --entity: #16a34a;
  --entity-soft: #f0fdf4;
  /* Projections share the entity green: a standalone projection and an
     entity property are the same thing — folded state — and a second
     colour would suggest a distinction the model does not make. */
  --projection: var(--entity);
  --projection-soft: var(--entity-soft);
  /* Constraints. Fuchsia rather than a shade of the entity green: a
     rule is not a kind of thing in the model, it is the gate in front
     of one, and it should not read as belonging to whatever it guards. */
  --rule: #c026d3;
  --rule-soft: #fdf4ff;
  --type: #6b7280;
  --type-soft: #f9fafb;
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --border-strong: #cbd5e1;
  --text: #0f172a;
  --muted: #64748b;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --radius: 8px;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}

/* The same palette after dark. Every colour above is a token and every
   rule below this line reads one, so the theme is this block and
   nothing else — except the handful of places where a chip needed a
   border and a text colour of its own, which are re-stated here. */
body.f-dark {
  color-scheme: dark;
  --command: #60a5fa;
  --command-soft: #16243d;
  --event: #fb923c;
  --event-soft: #2d1c0d;
  --entity: #4ade80;
  --entity-soft: #0f2a1c;
  --rule: #e879f9;
  --rule-soft: #2a1130;
  --type: #94a3b8;
  --type-soft: #172030;
  --bg: #0b1220;
  --surface: #131c2e;
  --border: #22304a;
  --border-strong: #3a4b69;
  --text: #e2e8f0;
  --muted: #93a3b8;
  --danger: #f87171;
  --danger-soft: #2d1414;
}
body.f-dark .chip.command { border-color: #1e40af; color: #bfdbfe; }
body.f-dark .chip.event { border-color: #9a3412; color: #fed7aa; }
body.f-dark .chip.entity, body.f-dark .chip.projection { border-color: #166534; color: #bbf7d0; }
body.f-dark .chip.rule { border-color: #86198f; color: #f5d0fe; }
body.f-dark .btn.primary { color: #06121f; }
body.f-dark .btn.primary:hover { background: #93c5fd; color: #06121f; }
body.f-dark .advanced { background: #101827; }
body.f-dark #toast { background: #1e293b; color: var(--text); }
```

Theme switching: `theme()` / `setTheme()` / `isDark()` (app/shared.js:541-565); `paintPage`
sets `document.body.className` to `f-dark` (+ `scrolled`) each repaint
(app/index.html:3703-3705). Also `body.f-dark .chip.tag { border-color:#166534; color:#bbf7d0; }`
and readonly-field bg overrides live in index.html (331, 500).

### Base + generic styles (app/shared.css:75-256, verbatim highlights)

```css
* { box-sizing: border-box; }

body {
  margin: 0;
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
}

h1, h2, h3, h4 { margin: 0; font-weight: 600; }
h1 { font-size: 16px; }
h2 { font-size: 15px; }
h3 { font-size: 13px; }
h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
p { margin: 0 0 10px; }
code, .mono { font-family: var(--mono); font-size: 12px; }

.btn {
  font: inherit; font-size: 13px;
  padding: 7px 14px; border-radius: 6px;
  border: 1px solid var(--border-strong); background: var(--surface);
  color: var(--text); cursor: pointer;
}
.btn:hover { border-color: var(--command); color: var(--command); }
.btn.primary { background: var(--command); border-color: var(--command); color: #fff; }
.btn.primary:hover { background: #1d4ed8; color: #fff; }
.btn.ghost { border-color: transparent; color: var(--muted); }
.btn.ghost:hover { border-color: var(--border-strong); }
.btn.tiny { padding: 4px 10px; font-size: 12px; }
.btn.danger:hover { border-color: var(--danger); color: var(--danger); }
.btn:disabled { opacity: .35; cursor: default; }

.chip {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  font-size: 12px; font-family: var(--mono);
  background: var(--type-soft); border: 1px solid var(--border);
}
.chip.command { background: var(--command-soft); border-color: #bfdbfe; color: #1e40af; }
.chip.event { background: var(--event-soft); border-color: #fed7aa; color: #9a3412; }
.chip.entity, .chip.projection { background: var(--entity-soft); border-color: #bbf7d0; color: #166534; }
.chip.rule { background: var(--rule-soft); border-color: #f5d0fe; color: #86198f; }
.chip.unset {
  background: transparent; border-style: dashed; color: var(--muted);
  font-style: italic; font-family: inherit;
}

.muted { color: var(--muted); }
.small { font-size: 12px; }
.tiny { font-size: 11px; }
.empty { color: var(--muted); font-size: 12px; font-style: italic; }

input[type=text], select, textarea {
  font: inherit; font-size: 14px;
  padding: 8px 11px; border: 1px solid var(--border-strong);
  border-radius: 5px; background: var(--surface); color: var(--text);
}
input[type=text]:focus, select:focus, textarea:focus {
  outline: none; border-color: var(--command);
}
input.inline {
  border: 0; border-bottom: 1px dashed var(--border-strong);
  border-radius: 0; padding: 3px 4px; background: transparent;
  font-family: var(--mono);
}
input.inline:focus { border-bottom-color: var(--command); }
```

Remaining shared.css sections: app chrome `.topbar/.disclaimer/.app-bar/.brand-link/
.icon-btn/.trigger` (92-173), the 760px bar media query (175-198), `.advanced` disclosure
(258-274), `#toast` (276-284), `.script-editor` Monaco frame (286-294), `.chooser/.alt`
legacy chooser page (296-308).

## The index.html `<style>` block — section map (app/index.html:10-964)

Dump not repeated here; the token story above plus components.md/layouts.md carry the
verbatim rules that matter. By line range:

- 11-37 — `.layout` grid, `.rail` column, 760px drawer + backdrop
- 38-95 — rail internals: links, `.group` feature headings, drag targets, `.gcount`, `.tech`
- 97-115 — `.inline-form` (dashed command-blue form), `.feature-of`, `.blank` empty page
- 117-135 — `.ecard/.ehead/.erow` definition cards, `.chip .x`
- 137-168 — `.slice` + sticky header, `.step` timeline (dots colored per kind), `.wizard-bar`
- 170-182 — `.qrow`/`.reveal` quiet rows, `.adder .btn.ghost`
- 184-253 — `.card` (+ kind left borders), `.script` dashed code block, `.round-head`,
  `.member-editor`, `.chip.editable/.suggest`, `.row`, `.sentence .op`, `.op.ref`, `.lit`,
  `.fields/.field`, `.adder`
- 255-276 — `.dcb` query coloring (`.k/.t/.y/.al`), `.qpop/.qbtn/.qpanel` popover
- 278-347 — linkable chips; the `.ledger/.lhead/.lrow/.lcell` projection table; `.chip.tag`;
  `.pdetail` opened row + its tabs; `.pfoot`
- 349-390 — `.index` projection index, `.lnk`; `.ident` identity block (green)
- 392-415 — `.ic` marks, `.icon-btn`, icon picker grid
- 417-454 — `.overlay/.modal`, `.setting/.opt` radio-cards
- 456-502 — import/export `.ie-*` tabs, pills, fields
- 504-533 — `.palette` quick open
- 535-548 — `.issue` problem rows, `.badge`
- 550-559 — `.advisory` banner
- 561-630 — `.splash*` landing page, `.site-footer`
- 632-647 — `body.scrolled` header condensation, `.landed` flash
- 649-740 — `.tabs/.tab`, `.scenario*` cards, `.sc-mark` status circles, outcome cards,
  drag-reorder edges, `.drift` two-up, `.v*` value editors
- 742-800 — sandbox `.timeline/.escrub/.estep` icon scrubber, `.pin`, `.icon-select`
- 802-871 — `.slice.wide`, coupling matrix, rule map rows
- 873-963 — lifecycles: `.lc-node` bubbles, wires, badges, popovers
