# Extractable components — DCB Playground

Catalog only; full source lives in components.md / the files themselves. "Props" = what
varies between uses (would become parameters); "Hardcoded" = what the current code fixes.
Files: `index.html` = app/index.html, `shared.js`/`shared.css` = app/shared.js|css.

## Layout

### App shell / topbar
- Source: index.html:968-997 (HTML), shared.css:92-198 (CSS), index.html:3695-3777 (slot filling)
- Category: layout
- Sticky two-strip header (disclaimer + app bar) over a 250px-rail/main grid.
- Props: brand title/logo, model name, slot contents (tools, jump, actions), disclaimer text.
- Hardcoded: slot ids (#model-switch, #tools, #jump, #actions), 250px rail width, ⌘K hint,
  live-measured `--topbar-h`.

### Sidebar rail
- Source: `renderRail` index.html:3148-3375, `renderEntityRail` 3380-3420, CSS index.html:16-89
- Category: layout
- Sectioned nav (Features / Model / Overview / Try it / Nothing uses these) with collapsible
  groups, count pills, drag-to-regroup, inline creation forms, active-row left-border accent.
- Props: sections, items (icon, label, active, onClick), group collapse state, adders, drag targets.
- Hardcoded: section names and order, Advanced-mode gating, command-blue vs entity-green
  hover coding, 760px drawer behavior.

### Modal + overlay
- Source: `overlayAround` index.html:1583-1588, `renderModals` 1535-1550, CSS 423-436
- Category: layout
- 540px surface panel on a thin click-to-dismiss backdrop; one modal at a time, priority list.
- Props: header title, body, close handler, width (palette variant is 520px/tighter).
- Hardcoded: single-host stacking rule, top-aligned 64px padding, `×` ghost close button.

### Slice step (timeline section)
- Source: `step()` index.html:3962-3967, CSS 147-168
- Category: layout
- Vertical-line-connected section with a kind-colored 16px dot and uppercase h4 title.
- Props: kind (`trigger|reads|rules|emits|changes|now`), title, body.
- Hardcoded: dot-color-per-kind map lives in CSS, 26px indent, connector geometry.

### Sticky command header
- Source: paintPage index.html:3864-3915, CSS 140-144 + 632-639
- Category: layout
- Page-pinned header (icon button, name, reveal actions, summary line) that condenses on scroll.
- Props: icon, name, summary, actions, rename form swap-in.
- Hardcoded: `body.scrolled` trigger at 60px, hides `.summary`/`.feature-of` only.

## Basic

### Button (`.btn`)
- Source: shared.css:202-218
- Category: basic
- One button class with primary/ghost/tiny/danger modifiers; blue hover accent.
- Props: variant, size (tiny), disabled, label.
- Hardcoded: hover color `#1d4ed8` for primary, 6px radius.

### Chip / pill (`.chip`)
- Source: shared.css:220-236 (+ index.html 227-236, 330-331; dark restatements shared.css:66-69)
- Category: basic
- Rounded-999px mono pill, kind-tinted (command/event/entity/projection/rule/tag),
  variants: `unset` (dashed italic), `editable`, `suggest` (dashed offer), `linkable`, `.x` remover.
- Props: kind, label, icon (`.ic` emoji), onOpen, variant.
- Hardcoded: per-kind border/text hexes (not tokens), 12px mono font.

### Reference chip (`refChip` + entityRef/eventRef/commandRef/projectionRef)
- Source: index.html:2861-2916
- Category: basic
- Chip that navigates to the named definition's page; mark + readable name.
- Props: name, kind (drives class/icon/target), text override.
- Hardcoded: `title: 'Open …'`, navigation via global `state`.

### Add-button / folded adder (`adderSlot`)
- Source: index.html:2334-2358, CSS 179-182 + 254
- Category: basic
- Ghost tiny '+ lowercase-label' button that swaps itself for a build() form; one open at a time.
- Props: key, step to focus, label, form builder.
- Hardcoded: `state.adder` singleton, `.flow-adder` keyboard-flow participation.

### Property adder row (`propertyAdder`)
- Source: index.html:2444-2532
- Category: basic
- name-input + type-select + "many"/"optional" checkboxes + add button; commit-on-leave,
  Backspace-pops-last, Escape-discards draft semantics.
- Props: placeholder, label, default type, type options fn, offerOptional, onAdd/onRemoveLast/onEmptyEnter, draftKey.
- Hardcoded: `state.fieldDraft` slot, `toCamel` naming, toast on empty name.

### Quiet row (`qrow` + `reveal`)
- Source: index.html:2238-2328, CSS 170-178
- Category: basic
- Click-to-reveal row: content always visible, machinery (type chip, `.tech` id, remove)
  hidden in `.reveal` until selected; Enter/Space toggles, Backspace removes, arrows navigate.
- Props: tag, class, key, `data-src` link key, onRemove, children.
- Hardcoded: `state.sel` singleton, interactive-element click exclusion list.

### Field row (`.field`)
- Source: CSS index.html:251-253; producers stepTrigger 3978-4004, eventFields 5029-5048
- Category: basic
- Flex row: fixed-width readable name (min-width 170px) + type/value machinery.
- Props: name, type label, editor control (chip vs `←` select), src key.
- Hardcoded: whether type shows always (event fields) or only on reveal (command inputs).

### Remove button with inline confirm (`removeButton`)
- Source: index.html:2374-2387
- Category: basic
- `×` danger button that becomes its own "Really remove?" confirmation on first click.
- Props: key, label, title, confirm text, onRemove.
- Hardcoded: `state.confirmRemove` singleton; parts-vs-definitions one-click rule is caller convention.

### Inline form (`inlineForm`)
- Source: index.html:3053-3079, CSS 97-109
- Category: basic
- The prompt() replacement: question, text field, live `→ PascalCase` preview, Add/Cancel.
- Props: question, placeholder, initial value, showsIdentifier, submitLabel, onSubmit/onCancel.
- Hardcoded: dashed command-blue dressing (entity/event recolors via `.icons` variants), 280px input.

### Select builder (`pick`)
- Source: index.html:3000-3049, CSS 794-800
- Category: basic
- Native select from [value,label,icon?] tuples; auto-optgroups on `" · "` prefix;
  icon-in-trailing-span for type-ahead correctness.
- Props: options, value, onchange, placeholder.
- Hardcoded: `GROUP_SEP`, `.icon-select` progressive enhancement.

### Problems banner (`advisoryBanner`)
- Source: index.html:1976-1984, CSS 550-559
- Category: basic
- Red-left-border card listing advisories for one definition (or a whole kind); null when clean.
- Props: kind, name (optional → kind-wide with bold names).
- Hardcoded: reads `modelAdvisories(model)` directly.

### Problems button + badge
- Source: index.html:1988-1995, CSS 544-548
- Category: basic
- Ghost topbar button with red count pill; absent when clean. `.badge.clear` = green variant.
- Props: count, onClick.
- Hardcoded: label 'Problems', danger background.

### Problems panel / issue row
- Source: index.html:1997-2019 (`.issue` CSS 535-543)
- Category: basic
- Modal listing full-width clickable what+why rows, each navigating to its subject.
- Props: items {what, why, go}.
- Hardcoded: intro copy, Done button.

### Toast
- Source: shared.js:36-43, shared.css:278-284
- Category: basic
- Bottom-center dark snackbar, 3.2s, `err` red variant; singleton.
- Props: message, isError.
- Hardcoded: timing, position.

### Tabs
- Source: CSS index.html:653-660; builders `scenarioTabs` 8897-8914, `.pdetail > .tabs` 340-342, `.ie-tab` 462-469
- Category: basic
- Underline tabs (blue when page-level, entity-green inside a projection row); optional badge.
- Props: tabs (key,label,extra), active, onSelect.
- Hardcoded: three parallel CSS implementations (.tab, .pdetail .tab, .ie-tab).

### Scenario card
- Source: `scenarioRow` index.html:8643-8718, CSS 662-718
- Category: basic
- Collapsible card: status circle (`.sc-mark` current/drifted/broken), name button, drag grip,
  Given/When/Then mono body, drift diff two-up with "Accept this".
- Props: entry {key, body}, run result, open state, drop handlers.
- Hardcoded: STATUS_WORDS mapping, mono `.sc-line` coloring (y/c/k).

### Outcome card
- Source: `outcomeCard` index.html:8579-8600, CSS 686-687
- Category: basic
- Published (orange tint, event list) vs rejected (red tint, refusing rule + read values).
- Props: outcome object, title.
- Hardcoded: refusal sentence format, `payloadText` rendering.

### Ledger (projection table)
- Source: CSS index.html:297-347; `projectionLedger` 5746-5781, row 5782, detail 5843
- Category: layout
- Grid table with uppercase head, clickable rows (green left border when open), inline
  expanding `.pdetail` editor with tabs and autosave.
- Props: columns template, entries, owner (entity vs standalone), add row.
- Hardcoded: green accent, per-page column templates.

### Query popover (`queryPopover`)
- Source: index.html:4031-4046, CSS 260-276
- Category: basic
- Magnifier glyph; hover/focus peek + click-to-pin panel showing the DCB query in `.dcb` mono coloring.
- Props: key, title, lines.
- Hardcoded: `state.queryPop` singleton, panel geometry.

### Sandbox timeline scrubber
- Source: `sandboxTimeline` index.html:9462-9534, CSS 742-776
- Category: basic
- Run of 28px emoji tiles (played/current/upcoming opacity states), drag-scrub, playhead bar,
  per-command spacing.
- Props: steps/events, position, onSeek.
- Hardcoded: event-orange accents, replay-from-zero model.

### Settings option card (`.opt`)
- Source: CSS index.html:440-454, builder 1561-1572
- Category: basic
- Radio-card: dot mark, bold label, muted description; blue when selected.
- Props: options [value,label,desc], current, onSet.
- Hardcoded: applies instantly (no OK), driven by UI_SETTINGS table.

### Advanced disclosure
- Source: shared.css:260-274
- Category: basic
- `<details class="advanced">` dashed box with uppercase ▸/▾ summary.
- Props: summary text, body.
- Hardcoded: off-token light bg `#fbfcfe` (dark override in shared.css:72).

### Icon (mark) picker
- Source: `iconForm`/`iconPicker`/`eventIconPicker`/`commandIconPicker` index.html:6116-6189, CSS 392-415
- Category: basic
- Emoji grid (auto-fill 32px cells) tinted per kind, current selection outlined.
- Props: kind (entity/event/command), current mark, onPick.
- Hardcoded: mark vocabularies (defaultMark tables in shared.js:1486-1573).

### Quick-open palette
- Source: index.html:2031-2200, CSS 504-533
- Category: layout
- ⌘K palette: borderless input, fuzzy-scored hits with kind label + location, footer hints;
  updates list only (no full repaint) to keep the caret.
- Props: entries {what,label,where,go}, scorer.
- Hardcoded: entry enumeration is model-shaped; own host `#palette-host`.
