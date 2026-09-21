# DCB Playground — Design System

## Product context

An in-browser modeling tool for event-sourced systems built on Dynamic Consistency
Boundaries (dcb.events). Authors define commands, events, entities and projections,
then drive commands against a hypothetical event log. The core page is the **command
definition page** ("slice"): a vertical timeline of steps that reads as a sentence —
"someone asks for this, providing → to decide, it reads → it is only allowed if →
when it succeeds, this happened → which changes what we know".

Audience: developers and domain modelers. Register: calm, technical, prose-like —
definitions read as sentences with inline editable chips, not as forms.

Key views: command page (the main one), entity page (projection ledger), events page,
sandbox (try commands against a log), Problems modal, quick-open palette, settings.
App shell: slim topbar (brand, model name, quick open ⌘K, share, settings) over a
250px left rail (FEATURES: features/commands · MODEL: entities/projections/events ·
TRY IT: sandbox) and a scrolling content pane. At ≤760px the rail becomes a drawer.

## Semantic kind-coding (the heart of the design language — KEEP the semantics)

Every model concept has a fixed hue, used consistently for card left-borders (3px),
timeline step dots, chips/pills, rail selection, and section accents:

| Kind | Light | Dark | Soft (light/dark) |
|---|---|---|---|
| command / primary / links | `#2563eb` | `#60a5fa` | `#eff6ff` / `#16243d` |
| event ("recorded") | `#f97316` | `#fb923c` | `#fff7ed` / `#2d1c0d` |
| entity & projection (deliberately shared) | `#16a34a` | `#4ade80` | `#f0fdf4` / `#0f2a1c` |
| rule / constraint (a gate, not a thing) | `#c026d3` | `#e879f9` | `#fdf4ff` / `#2a1130` |
| type names (neutral) | `#6b7280` | `#94a3b8` | `#f9fafb` / `#172030` |
| danger / problems | `#dc2626` | `#f87171` | `#fef2f2` / `#2d1414` |

Neutrals: bg `#f8fafc`/`#0b1220`, surface `#fff`/`#131c2e`, border `#e2e8f0`/`#22304a`,
strong border `#cbd5e1`/`#3a4b69`, text `#0f172a`/`#e2e8f0`, muted `#64748b`/`#93a3b8`.
Dark mode = same tokens redefined under `body.f-dark`; both themes must work.

## Typography

- System sans only, `14px/1.55` body (`-apple-system, "Segoe UI", Roboto, sans-serif`).
- Mono for identifiers/chips/queries/payloads: `ui-monospace, SFMono-Regular, Menlo`.
- h1 16 / h2 15 / h3 13, weight 600. **h4 = section label style: 11px uppercase,
  letter-spacing .07em, muted** — labels the timeline steps.
- Utility: `.small` 12px, `.tiny` 11px, `.tech` 10px mono.

## Shape & texture

- Cards `--radius: 8px`; buttons/inline-forms 6px; inputs 5px; modals 9–10px;
  chips/pills `999px` (mono, kind-tinted bg + hardcoded kind border/text colors).
- Kind identity = 3px colored left border on white cards; page otherwise flat,
  hairline borders, shadows only on overlays (modal `0 18px 50px rgba(15,23,42,.28)`).
- Buttons: `.btn` bordered surface; `.btn.primary` command-blue; `.btn.ghost`
  borderless muted; `.btn.tiny` 12px. Inline dashed-underline inputs for renames.
- Minimal animation (drawer .18s, landed-flash 1.1s). No icon font — emoji marks.

## Current behavior of the three redesign areas (ground truth)

1. **Add-buttons, two registers, all always visible today**: rail-level `+ Command`
   `+ Feature` `+ Entity` (bordered `.btn`), and in-step quiet adders `+ input`,
   `+ read something`, `+ rule`, `+ record something`, `+ change`, `+ only while`
   (`.btn.ghost.tiny`, lowercase) that unfold into dashed blue inline-forms
   (name + type select + checkboxes, commit-on-blur).
2. **Fields**: command inputs render as quiet rows (`.qrow`) showing the name only;
   type/identifier/remove sit in a hidden `.reveal` cluster that appears on click.
   Event fields always show name · type · `←` source mapping.
3. **Problems**: never blocking. A red-left-border `.advisory` banner sits above the
   affected definition; a topbar ghost "Problems" button carries a red count `.badge`
   and opens a modal listing what/why `.issue` rows (clickable, navigate to target).
   Today both reuse the same card language as model blocks — red border on white.

## Redesign intent (this round)

- Declutter: adders appear only on hover / active context; must have a credible
  touch/mobile story (no hover there).
- Fields should always show their type (event fields already do; command inputs don't).
- Problems need a distinctive, unified look — clearly *meta/diagnostic*, not another
  model building block — consistent between the in-page banner and the Problems modal.
- Semantic kind-coding, sentence-like register, and both themes are invariants;
  composition, chrome, and surface styling are open to refresh.
