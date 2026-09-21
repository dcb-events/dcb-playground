# Routes — DCB Playground

There is **no router and no URL-based navigation**. The app is one page; "where you are" is
plain mutable state in the module-level `state` object (app/index.html:1022-1096), and every
navigation is `state.view = …; render()`. The URL is only touched for two things:
`?safe` (disables scripted handlers on load, see evaluate.js `setScriptsDisabled`) and the
`#…` fragment used by share links / import (`decodeShareLink`, app/shared.js:649).

## Views (`state.view`) and their renderers

Dispatch lives in `paintPage()` (app/index.html:3695-3950), which falls through to the
command page when no other view matches.

| View key | What it is | Renderer | Extra state |
|---|---|---|---|
| `'slice'` (default) | Command definition page — the slice: trigger / reads / rules / emits / changes / consistency steps, or the Scenarios tab | inline in `paintPage` (3863-3950) via `stepTrigger`, `stepReads`, `stepRules`, `stepEmits`, `stepChanges`, `stepConsistency`, `scenarioPanel` | `state.slice` (command name), `state.tab` (`'definition'|'scenarios'`), `state.wizard` (new-command progressive reveal) |
| `'entity'` | One entity's page: identity block, properties-as-projections ledger, checks | `renderEntity` (5626) | `state.entity` |
| `'types'` | Custom types page (Advanced only) | `renderCustomTypes` (6190) | — |
| `'projections'` | Unbound projections ledger + index | `renderProjections` (7301) | `state.projDraft`, `state.projTab` |
| `'events'` | All events, as expandable cards | `renderEvents` (7396) | `state.openEvent` |
| `'coupling'` | Command × event matrix (Advanced) | `renderCoupling` (7540) | — |
| `'rulemap'` | Every command → rules → events (Advanced) | `renderRuleMap` (7685) | — |
| `'lifecycles'` | Entity status state machines (Advanced) | `renderLifecycles` (7848) | — |
| `'sandbox'` | Drive commands against a session log | `renderSandbox` (9839) | module-level `session` object (9282-9294) |

Not a `state.view`: the **splash** (landing page) shows when no model is loaded or
`state.splash` is true — `renderSplash` (1318) replaces `#main` entirely and the rail is
removed (`.layout.no-rail`).

## Overlays (own state flags, not views)

Rendered by `renderModals()` (1535-1550), priority-ordered, one at a time:
`state.pendingImport` → import gate (1594); `state.problems` → Problems panel (1997);
`state.settings` → Settings (1552); `state.importExport` → Import & Export (1623);
`state.models` → Models modal (1186). Quick open is `state.palette` → `renderPalette`
(2117) in its own `#palette-host`.

## Navigation helpers (the "links")

Every cross-reference goes through one of these (app/index.html:2849-2967), all of which
`closeForms()`, set state, and `render()`:
`openEntity(name)`, `goToEvent(name)`, `goToCustomType(name)`, `goToCommand(name)`,
`goToProjection(name)` / `openProjection(model, name, {tab})`, `goToScenario(model, key)`,
`goToProjectionScenario(model, key)`. `state.land` holds a CSS selector to scroll to and
flash (`landOn`, 2223; `.landed` animation) after the repaint.

Guards in `paintPage` (3779-3801) redirect invalid state: a removed command/entity falls to
the first remaining one; Advanced-only views fall back to `'slice'` when Advanced is off.

Quick open (⌘K) enumerates every navigable thing via `paletteEntries` (2031-2083) with a
fuzzy scorer (2084). The rail (`renderRail`, 3148) is the persistent navigation surface.

Nothing about the current view is persisted; a reload always lands on the default view of
the active model (`activeModelId`, app/shared.js:575, is stored in localStorage).
