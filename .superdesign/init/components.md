# Components — DCB Playground

No framework, no JSX, no components in the class sense. The UI is plain functions that
return DOM nodes built with one hyperscript helper, `h(...)`. Every "component" below is a
function `(...) => HTMLElement` plus the CSS classes it emits. The whole page is rebuilt on
every `render()`; state lives in a single module-level `state` object (`app/index.html:1022-1096`).

All paths absolute: `app/` = `/Users/bwaidelich/Projekte/dynamic_consistency_boundary/dcb-playground/app/`.

---

## 1. Core primitives

### `h()` — the DOM helper (app/shared.js:18-34)

```js
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el[k.toLowerCase()] = v;
    else if (k === 'value') el.value = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return el;
}
```

Conventions: `null`/`false` children skipped (so `cond ? node : null` is the conditional idiom);
arrays flattened 4 deep; `html:` attr for inline SVG icons.

### `toast()` (app/shared.js:36-43) + CSS (app/shared.css:278-284)

```js
let toastTimer = null;
function toast(message, isError) {
  document.querySelectorAll('#toast').forEach((n) => n.remove());
  const el = h('div', { id: 'toast', class: isError ? 'err' : '' }, message);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}
```

```css
#toast {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  background: var(--text); color: #fff; padding: 9px 16px;
  border-radius: 6px; font-size: 12px; z-index: 100;
  box-shadow: 0 6px 20px rgba(15,23,42,.25);
}
#toast.err { background: var(--danger); }
```

### `run()` — command + repaint wrapper (app/shared.js:47-56)

```js
function run(fn) {
  try {
    const out = fn();
    if (typeof render === 'function') render();
    return out;
  } catch (err) {
    if (err instanceof DomainError) toast(err.message, true);
    else { console.error(err); toast('Unexpected error: ' + err.message, true); }
  }
}
```

---

## 2. Buttons

One `.btn` class with modifiers, defined once in `app/shared.css:202-218`:

```css
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
.btn:disabled:hover { border-color: transparent; color: var(--muted); }
```

Icon-only bar buttons: `.app-bar .icon-btn` (app/shared.css:144-151, 30×30, transparent until
hover) — distinct from the larger emoji `.icon-btn` used for entity/command marks
(app/index.html:395-401, 34×34, 20px emoji).

---

## 3. The "add" buttons (adders)

Two registers, deliberately distinct:

- **Definition-level adders** — always-visible `.btn` / `.btn primary` with capitalized label:
  `'+ Command'`, `'+ Feature'` (rail, index.html:3249-3253), `'+ Entity'` (rail, 3413-3417),
  `'+ First entity'` / `'+ First command'` (blank page, 3842-3859), `'+ New event'` (events page,
  7440-7447), `'+ new projection'` (7313), `'+ New record' / '+ New enum' / '+ New single value'`
  (types page, 6394-6402).
- **Part-level adders** — folded behind a quiet ghost button with a lowercase label:
  `'+ input'`, `'+ read something'`, `'+ rule'`, `'+ record something'`, `'+ change'`,
  `'+ property'`, `'+ field'`, `'+ member'`, `'+ only while'` (guards), `'+ ask for a value'`.
  All go through `adderSlot`.

### `adderSlot()` — the folded adder (app/index.html:2334-2358)

```js
// "Add another one", folded into a single button until it is wanted.
// `flow-adder` marks that button as a stop of its own — see `navFlow`
// — so the row above it and the step below it are both one arrow key
// away, exactly the way an unfolded row would be.
function adderSlot(key, stepKey, label, build) {
  if (state.adder === key) return build();
  return h('div', { class: 'adder' }, h('button', {
    class: 'btn ghost tiny flow-adder',
    onclick: () => { closeForms(); state.adder = key; render(); focusOpenedAdder(stepKey); },
    onkeydown: (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') navFlow(e); },
  }, label));
}

function focusOpenedAdder(stepKey) {
  if (!stepKey) return;
  const section = document.querySelector('.step.' + stepKey);
  const last = section && section.lastElementChild;
  const el = last && last.querySelector('select, input, textarea, button');
  if (el) el.focus();
}
```

Only one adder can be open at a time (`state.adder` holds a single key).

### Adder CSS (app/index.html:179-182, 254)

```css
/* The collapsed adder: one quiet button where a row of empty controls used to sit. */
.adder .btn.ghost { color: var(--muted); }
.adder .btn.ghost:hover { color: var(--command); }
.adder { display: flex; gap: 9px; align-items: center; margin-top: 7px; flex-wrap: wrap; }
```

Rail adders wrap in `.rail .add { padding: 10px 16px 0; display: flex; gap: 6px; }`
(app/index.html:45). The per-feature `+` sits in the group heading, hidden until hover:
`.group .gadd { visibility: hidden; padding: 0 5px; } .group:hover .gadd { visibility: visible; }`
(app/index.html:50-51).

### `propertyAdder()` — the name/type/many/optional row (app/index.html:2444-2532)

The one field-creation form, shared by command inputs, event fields, entity properties, and
custom-type fields. Draft survives repaints in `state.fieldDraft`; committing happens on
Enter, on the Add button, or implicitly on leaving the row (`commitPendingField`,
index.html:2407-2419). Backspace in the empty name pops the last-added row; Escape discards.

```js
function propertyAdder(model, {
  placeholder = 'course id', label = '+ Add', type = 'string',
  onAdd, onRemoveLast, onEmptyEnter, draftKey = 'field',
  types = typeOptions, offerOptional = true,
}) {
  const draft = state.fieldDraft && state.fieldDraft.key === draftKey
    ? state.fieldDraft
    : (state.fieldDraft = {
        key: draftKey, name: '', propertyType: type, isList: false, isOptional: false,
      });
  draft.ready = () => !!draft.name.trim();
  draft.commit = () => {
    onAdd({
      name: toCamel(draft.name), propertyType: draft.propertyType,
      isOptional: draft.isOptional, isList: draft.isList,
    });
  };
  const add = () => {
    if (!draft.name.trim()) return toast('Give the field a name.', true);
    state.fieldDraft = null;
    draft.commit();
  };
  const input = h('input', {
    type: 'text', placeholder, class: 'flow-entry', value: draft.name,
    oninput: (e) => { draft.name = e.target.value; },
    onkeydown: (e) => {
      if (e.key === 'Backspace' && !draft.name && onRemoveLast) { e.preventDefault(); onRemoveLast(); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        state.fieldDraft = null;
        e.target.value = '';
        e.target.blur();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') navFlow(e);
    },
  });
  setTimeout(() => {
    const active = document.activeElement;
    if (!active || active === document.body) input.focus();
  }, 0);
  const root = h('div', {
    class: 'adder',
    onkeydown: (e) => {
      if (e.key === 'Escape') { state.fieldDraft = null; return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!draft.name.trim() && onEmptyEnter) { onEmptyEnter(); return; }
      add();
    },
  },
    input,
    pick(types(model), draft.propertyType, (v) => { draft.propertyType = v; }),
    h('label', { class: 'tiny muted' },
      h('input', {
        type: 'checkbox', checked: draft.isList,
        onchange: (e) => { draft.isList = e.target.checked; },
      }), ' many'),
    offerOptional ? h('label', { class: 'tiny muted' },
      h('input', {
        type: 'checkbox', checked: draft.isOptional,
        onchange: (e) => { draft.isOptional = e.target.checked; },
      }), ' optional') : null,
    h('button', { class: 'btn', onclick: add }, label));
  root.onfocusout = () => setTimeout(() => {
    if (state.fieldDraft !== draft) return;
    if (root.isConnected && root.contains(document.activeElement)) return;
    commitPendingField();
  }, 100);
  return root;
}
```

Example use — the command-input adder (`'+ input'`, app/index.html:4009-4023):

```js
adderSlot('in', 'trigger', '+ input', () => propertyAdder(model, {
  label: '+ Add input', draftKey: 'in:' + slice.name,
  onAdd: (property) => patchSlice((b) => b.properties.push(property)),
  onRemoveLast: slice.payload.length ? () => dropProperty(slice.payload.length - 1) : undefined,
  onEmptyEnter: () => {
    if (state.wizard && state.wizard.slice === slice.name) {
      closeForms();
      return advanceWizard(model, slice);
    }
    beginReadAdder();
  },
}))
```

The read adder (`'+ read something'`, app/index.html:4489-4516) and emit adder
(`'+ record something'`, app/index.html:4907-4926) instead unfold a `.card` holding a row of
`pick()` selects plus a submit `.btn` — same `adderSlot` frame, different body:

```js
body.push(adderSlot('emit', 'emits', '+ record something', () =>
  h('div', { class: 'card' }, h('div', {
    class: 'adder',
    onkeydown: existing.length ? (e) => {
      if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      patchSlice((b) => b.publishes.push({ name: chosen, parameters: {} }));
    } : null,
  },
    existing.length ? pick(existing.map((n) => [n, readable(n)]), chosen, (v) => { chosen = v; }) : null,
    existing.length ? h('button', {
      class: 'btn',
      onclick: () => patchSlice((b) => b.publishes.push({ name: chosen, parameters: {} })),
    }, '+ Record something already known') : null,
    h('button', {
      class: 'btn primary',
      onclick: () => { closeForms(); state.newEntityAt = 'event'; render(); },
    }, '+ New event')))));
```

---

## 4. Quiet rows and reveal (`qrow`)

The page-wide row idiom: a row shows the thing itself; type labels, stored identifiers and the
remove button hide inside a `.reveal` span until the row is clicked (or Enter/Space). One row
open at a time (`state.sel`). Backspace removes when `onRemove` is given.

### `qrow()` / `reveal()` (app/index.html:2238-2328)

```js
function revealed(key) { return state.sel === key; }
function reveal(...children) { return h('span', { class: 'reveal' }, ...children); }

function qrow(tag, { cls = '', key, src, onRemove }, ...children) {
  const open = revealed(key);
  const toggle = () => { state.sel = state.sel === key ? null : key; render(); };
  return h(tag, {
    class: (cls ? cls + ' ' : '') + 'qrow' + (open ? ' open' : ''),
    'data-src': src || null,
    'data-key': key || null,
    tabindex: 0,
    onclick: (e) => {
      if (e.target.closest('button, select, input, label, a, .chip.entity, .chip.linkable, .op.ent')) return;
      toggle();
    },
    onkeydown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { navFlow(e); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && onRemove) {
        e.preventDefault();
        const at = flowStops().indexOf(e.currentTarget);
        onRemove();
        if (at >= 0) focusFlowStopNear(Math.max(0, at - 1));
      }
    },
  }, ...children);
}
```

```css
/* app/index.html:170-178 */
.qrow > .reveal { display: none; align-items: center; gap: 8px; }
.qrow.open > .reveal { display: inline-flex; }
.qrow:focus { outline: 1px solid var(--command); outline-offset: 1px; }
.qrow { cursor: pointer; }
.qrow:hover, .qrow.open { background: var(--command-soft); }
```

Arrow-key flow: `flowStops()`/`navFlow()` (app/index.html:2544-2555) walk every
`.qrow[tabindex], .flow-adder, .flow-entry` in `#main` top to bottom.

---

## 5. Field / property rows

### Command inputs — `stepTrigger` (app/index.html:3969-4023)

Each payload property is a `.field` qrow: readable name on the left, everything else in
`reveal(...)` — the **type is shown only when the row is opened**, as an editable chip; the
raw camelCase identifier appears only in Advanced mode (`.tech`).

```js
const rows = slice.payload.map((p, i) => {
  if (editingMember(where, p.name)) {
    return memberEditor(model, {
      member: p, where,
      onReplace: (next) => patchSlice((b) => { b.properties[i] = next; }),
      onRename: (name) => renameMember('command-definition', model.id, slice.name, 'property', p.name, name),
    });
  }
  const enumType = isStringEnumType(model, p.propertyType) ? p.propertyType : null;
  return [
    qrow('div', {
      cls: 'field', key: 'in:' + p.name, src: 'param:' + p.name,
      onRemove: () => dropProperty(i),
    },
      h('span', { class: 'nm' }, propertyWords(p.name)),
      h('span', { class: 'grow', style: 'flex:1' }),
      reveal(
        h('span', {
          class: 'chip editable', title: 'Rename or retype this input',
          onclick: () => openMember(where, p.name),
        }, readable(typeLabel(p))),
        advanced() ? h('span', { class: 'tech' }, p.name) : null,
        h('button', { class: 'btn tiny danger', onclick: () => dropProperty(i) }, '×'))),
    enumType ? h('div', { class: 'use' },
      h('span', { class: 'muted' }, 'can be '), ...enumMemberChips(model, enumType)) : null,
  ];
});
if (!rows.length) rows.push(h('div', { class: 'empty' }, 'Takes no input.'));

return step('trigger', 'Someone asks for this, providing',
  h('div', { class: 'card command' }, rows,
    adderSlot('in', 'trigger', '+ input', () => propertyAdder(model, { /* … */ }))));
```

```css
/* app/index.html:251-253 */
.fields { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.field { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 2px 0; }
.field .nm { min-width: 170px; }
/* app/index.html:92-95 — the stored identifier, Advanced mode only */
.tech {
  font-family: var(--mono); font-size: 10px; color: var(--muted);
  margin-left: 6px; font-weight: 400;
}
```

### Event fields on a command page — `eventFields` (app/index.html:4998-5097)

Rows here are **always-visible mappings**: name, type (muted tiny, always shown here), `←`,
then a `pick()` select choosing which command value fills the field. Plus the `.chip.suggest`
copy-from-command offers.

```js
function eventFields(model, emission, event) {
  if (!event) return h('div', { class: 'fields empty' }, 'This event no longer exists.');
  const command = activeModel()['command-definitions'][state.slice];
  const boundary = command.boundary || [];
  const commandProperties = command.properties || [];
  const options = [
    ...commandProperties.map((q) =>
      [JSON.stringify({ parameterName: q.name }), 'given · ' + propertyWords(q.name)]),
    ...boundary.flatMap((b) => {
      if (b.projection) {
        return [[JSON.stringify({ alias: b.alias }), propertyWords(b.alias)]];
      }
      const entity = model['entity-definitions'][b.entity];
      const icon = entityIcon(model, b.entity);
      const props = (entity ? entity.properties : []).map((q) =>
        [JSON.stringify({ alias: b.alias, property: q.name }), memberWords(b.alias, q.name), icon]);
      const ownId = b.id !== undefined && operandSource(b.id) !== 'parameter'
        ? [[JSON.stringify(b.id), memberWords(b.alias, 'id'), icon]]
        : [];
      return [...props, ...ownId];
    }),
  ];

  const rows = (event.properties || []).map((p) => {
    const bound = (emission.parameters || {})[p.name];
    const fieldOptions = options.filter(([v]) => {
      const resolved = resolveOperandType(JSON.parse(v), { boundary, commandProperties, model });
      return resolved && resolved.propertyType === p.propertyType && resolved.isList === !!p.isList;
    });
    return h('div', { class: 'field', 'data-src': 'evprop:' + emission.name + '.' + p.name },
      h('span', { class: 'nm' }, propertyWords(p.name)),
      h('span', { class: 'muted tiny' }, readable(typeLabel(p))),
      h('span', { class: 'muted tiny' }, '←'),
      pick(fieldOptions, bound === undefined ? '' : JSON.stringify(bound),
        (v) => patchSlice((b) => {
          const e = b.publishes.find((x) => x.name === emission.name);
          e.parameters = e.parameters || {};
          if (v === '') delete e.parameters[p.name];
          else e.parameters[p.name] = JSON.parse(v);
        }), '— unset —'));
  });

  const missing = commandProperties.filter((q) => !(event.properties || []).some((p) => p.name === q.name));
  const copyFromCommand = (properties) => { /* declares the field on the event AND wires it, see 5059-5073 */ };

  return h('div', { class: 'fields' },
    rows.length ? rows : h('div', { class: 'empty' }, 'Carries nothing yet.'),
    missing.length ? h('div', { class: 'copy-missing' },
      h('span', { class: 'muted tiny' }, 'Given but not recorded: '),
      missing.map((p) => h('button', {
        class: 'chip suggest',
        title: 'Add ' + propertyWords(p.name) + ' to this event, carried through unchanged',
        onclick: () => copyFromCommand([p]),
      }, '+ ' + propertyWords(p.name))),
      missing.length > 1 ? h('button', {
        class: 'chip suggest flow-adder',
        title: `Add all ${missing.length} of these at once, each carried through unchanged`,
        onkeydown: (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') navFlow(e); },
        onclick: () => copyFromCommand(missing),
      }, `+ all ${missing.length}, same as the command`) : null) : null,
    h('div', { class: 'adder', style: 'margin-top:6px' },
      h('button', {
        class: 'btn ghost tiny',
        onclick: () => goToEvent(emission.name),
      }, 'Rename, retype or add fields on ' + readable(emission.name) + ' →')));
}
```

```css
/* app/index.html:229-237 — the "offered, not authored" suggestion chip */
.chip.suggest {
  font: inherit; font-size: 11px; cursor: pointer; color: var(--muted);
  border-style: dashed; background: transparent;
}
.chip.suggest:hover { border-color: var(--command); color: var(--command); background: var(--command-soft); }
.copy-missing { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
```

Event card in the emits step (app/index.html:4842-4872): a `.card.event` whose header qrow
shows the event chip + field count, with "Fields" / "×" behind `reveal(...)`; `eventFields`
renders below when `state.openEvent === emission.name`.

Related editors: `memberEditor` (rename/retype one member, index.html:2610-2650),
`eventFieldsEditor` (an event's own page, 8040-8090), `entityPropertyAdder` (5610-5625,
uses `propertyAdder` with `label: '+ Property'`).

---

## 6. Chips / pills

### CSS (app/shared.css:220-236)

```css
.chip {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  font-size: 12px; font-family: var(--mono);
  background: var(--type-soft); border: 1px solid var(--border);
}
.chip.command { background: var(--command-soft); border-color: #bfdbfe; color: #1e40af; }
.chip.event { background: var(--event-soft); border-color: #fed7aa; color: #9a3412; }
.chip.entity, .chip.projection { background: var(--entity-soft); border-color: #bbf7d0; color: #166534; }
.chip.rule { background: var(--rule-soft); border-color: #f5d0fe; color: #86198f; }
/* No value yet: dashed, unfilled, italic, so it never reads as a typed value. */
.chip.unset {
  background: transparent; border-style: dashed; color: var(--muted);
  font-style: italic; font-family: inherit;
}
```

Dark-mode chip overrides re-stated in `app/shared.css:66-69`. Extra chip flavors in
index.html: `.chip.tag` (330-331), `.chip.editable` (227-228), `.chip.suggest` (232-236),
`.chip .x` remove button inside a chip (131-135), `.chip.linkable` hover outline (287-288).

### Reference chips — `refChip` and the four kinds (app/index.html:2861-2916)

```js
// Every mention of a thing, anywhere: its mark, its name, and the way in.
function refChip(name, { cls, icon, onOpen, text }) {
  return h('span', {
    class: cls, title: 'Open ' + readable(name),
    onclick: onOpen,
  }, icon ? h('i', { class: 'ic' }, icon) : null,
    text === undefined ? readable(name) : text);
}

function entityRef(model, name, { cls = 'chip entity', text } = {}) {
  return refChip(name, { cls, icon: entityIcon(model, name), onOpen: () => openEntity(name), text });
}
function eventRef(model, name, { cls = 'chip event linkable', text } = {}) {
  return refChip(name, { cls, icon: eventIcon(model, name), onOpen: () => goToEvent(name), text });
}
function commandRef(model, name, { cls = 'chip command linkable', text } = {}) {
  return refChip(name, { cls, icon: commandIcon(model, name), onOpen: () => goToCommand(name), text });
}
function projectionRef(model, name, { cls = 'chip projection linkable', text } = {}) {
  return refChip(name, { cls, onOpen: () => goToProjection(name), text });
}
```

`named(name, cls)` (index.html:2840-2843) renders a readable name with the raw identifier as
`.tech` in Advanced mode. Emoji marks: `.ic { font-style: normal; margin-right: 5px; }`
(index.html:393); icons resolved by `entityIcon`/`eventIcon`/`commandIcon`
(app/shared.js:1503-1573).

### Operand references — `opRef` (app/index.html:2274-2294)

Mono chips (`.sentence .op`, CSS index.html:242-250) that light up their source row via a
shared `data-src` key; hover peeks, click pins (`.lit { box-shadow: 0 0 0 2px var(--command); }`).

---

## 7. Problems & advisories

Two surfaces over the same records (`modelAdvisories` in model.js, plus loose ends and
drifted scenarios): a banner on the affected page, and the Problems modal from the topbar.

### The advisory banner (app/index.html:1976-1984)

Placed directly under a command page's header (`paintPage`, index.html:3914-3915:
`const commandAdvisories = advisoryBanner(model, 'command-definition', slice.name); if (commandAdvisories) main.appendChild(commandAdvisories);`)
and at the top of the Events/Entities/Projections/Types pages (kind-wide, no `name`).

```js
// The marker shown where a flagged definition lives — the same
// records the Problems panel folds in, filtered to one definition (or
// to one kind, for the pages that list a whole kind). Null when there
// is nothing to say, so a clean card stays a clean card.
function advisoryBanner(model, kind, name) {
  const found = modelAdvisories(model)
    .filter((a) => a.kind === kind && (name === undefined || a.name === name));
  if (!found.length) return null;
  return h('div', { class: 'advisory' },
    found.map((a) => h('div', {},
      name === undefined ? h('span', { class: 'what' }, readable(a.name)) : null,
      a.message)));
}
```

```css
/* app/index.html:550-559 */
.advisory {
  border: 1px solid var(--border); border-left: 3px solid var(--danger);
  border-radius: 7px; background: var(--surface);
  padding: 8px 11px; margin: 0 0 10px; font-size: 12px;
}
.advisory .what { font-weight: 600; margin-right: 6px; }
.advisory div + div { margin-top: 4px; }
```

### The Problems button + badge (app/index.html:1988-1995)

```js
// Shown only when there is something to show — a clean model gets no badge.
function problemsButton(model) {
  const found = problems(model);
  if (!found.length) return null;
  return h('button', {
    class: 'btn ghost', title: 'Problems in this model',
    onclick: () => { closeForms(); state.problems = true; render(); },
  }, 'Problems', h('span', { class: 'badge' }, found.length));
}
```

```css
/* app/index.html:544-548 */
.badge {
  font-size: 10px; border-radius: 999px; padding: 0 6px; margin-left: 5px;
  background: var(--danger); color: #fff;
}
.badge.clear { background: var(--entity); }
```

### The Problems panel (modal) (app/index.html:1997-2019)

Each finding is one `.issue` button — what, why, and a click that navigates to it.
The list is assembled by `problems()` (index.html:1936-1970) from `looseEnds()`
(1886-1924), `modelAdvisories(model)`, and `scenarioTrouble(model)` — memoized per log
revision.

```js
function problemsPanel() {
  const model = activeModel();
  const found = problems(model);
  const close = () => { state.problems = false; render(); };
  const modal = h('div', { class: 'modal', tabindex: '-1', role: 'dialog', 'aria-modal': 'true' },
    h('header', {},
      h('h2', {}, 'Problems'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: close, title: 'Close' }, '×')),
    h('div', { class: 'muted small', style: 'margin-bottom:14px' },
      'Loose ends this model has not tied yet, definitions that do not hold together yet, '
      + 'and scenarios it no longer agrees with. Nothing here blocked a save — '
      + 'these are ways back to what still needs attention.'),
    found.map((p) => h('button', {
      class: 'issue',
      onclick: () => { close(); p.go(); render(); },
    }, h('span', {}, p.what), h('span', { class: 'why' }, p.why))),
    h('div', { class: 'adder', style: 'margin-top:14px' },
      h('button', { class: 'btn primary', onclick: close }, 'Done')));
  const overlay = overlayAround(modal, close);
  setTimeout(() => modal.focus(), 0);
  return overlay;
}
```

```css
/* app/index.html:535-543 */
.issue {
  display: flex; align-items: baseline; gap: 9px; width: 100%; text-align: left;
  font: inherit; font-size: 12.5px; color: inherit; cursor: pointer;
  border: 1px solid var(--border); border-radius: 7px;
  background: var(--surface); padding: 8px 11px; margin-bottom: 6px;
}
.issue:hover { border-color: var(--command); }
.issue .why { font-size: 11px; color: var(--muted); }
```

---

## 8. Modal machinery

One host (`#modal-host`), one overlay, exactly one modal at a time, priority-ordered
(app/index.html:1535-1550):

```js
function renderModals() {
  const host = document.getElementById('modal-host');
  host.innerHTML = '';
  if (state.pendingImport) { host.appendChild(renderImportGate()); return; }
  if (state.problems) { host.appendChild(problemsPanel()); return; }
  if (state.settings) { renderSettingsModal(host); return; }
  if (state.importExport) { host.appendChild(renderImportExportModal()); return; }
  if (state.models) { host.appendChild(modelsModal()); return; }
}

// A modal, and the thin backdrop that closes it. (app/index.html:1583-1588)
function overlayAround(modal, close) {
  return h('div', {
    class: 'overlay',
    onclick: (e) => { if (e.target === e.currentTarget) close(); },
  }, modal);
}
```

```css
/* app/index.html:423-436 */
.overlay {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(15, 23, 42, .22);
  display: flex; justify-content: center; align-items: flex-start;
  padding: 64px 16px 24px;
}
.modal {
  width: 540px; max-width: 100%; max-height: calc(100vh - 100px); overflow: auto;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; box-shadow: 0 18px 50px rgba(15, 23, 42, .28);
  padding: 16px 20px 18px;
}
.modal > header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 2px; }
.modal > header .grow { flex: 1; }
```

Settings options use `.opt` radio-cards (CSS index.html:440-454); import/export uses
`.ie-tabs`/`.ie-pill` (462-502). Quick-open lives in a separate `#palette-host` with its own
tighter `.palette` panel (CSS 508-533; JS `openPalette`/`renderPalette` 2103-2200).

---

## 9. Cards, steps, and misc shared pieces

### `step()` — a slice step (app/index.html:3962-3967) + CSS (147-168)

```js
function step(kind, title, ...body) {
  return h('section', { class: 'step ' + kind },
    h('span', { class: 'dot' }),
    h('div', { class: 'shead' }, h('h4', {}, title)),
    ...body);
}
```

```css
.step { position: relative; padding: 0 0 4px 26px; margin-bottom: 22px; }
.step::before {
  content: ""; position: absolute; left: 7px; top: 20px; bottom: -22px;
  width: 2px; background: var(--border);
}
.step:last-of-type::before { display: none; }
.step > .dot {
  position: absolute; left: 0; top: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  border: 3px solid var(--surface); background: var(--border-strong);
}
.step.trigger > .dot { background: var(--command); }
.step.reads > .dot, .step.changes > .dot, .step.now > .dot { background: var(--entity); }
.step.rules > .dot { background: var(--rule); }
.step.emits > .dot { background: var(--event); }
```

### `.card` — kind-colored left border (app/index.html:184-193)

```css
.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); padding: 10px 13px; margin-bottom: 7px;
}
.card.event { border-left: 3px solid var(--event); }
.card.entity { border-left: 3px solid var(--entity); }
.card.command { border-left: 3px solid var(--command); }
.card.projection { border-left: 3px solid var(--projection); }
.card.rule { border-left: 3px solid var(--rule); }   /* line 166 */
/* scenario outcomes, line 686-687 */
.card.outcome-published { background: var(--event-soft); }
.card.outcome-rejected { background: var(--danger-soft); }
```

### `removeButton()` — inline two-step confirm (app/index.html:2374-2387)

```js
function removeButton(key, { label = '×', title, confirm = 'Really remove?', onRemove }) {
  if (state.confirmRemove === key) {
    return h('button', {
      class: 'btn tiny danger',
      onclick: () => { state.confirmRemove = null; onRemove(); },
    }, confirm);
  }
  return h('button', {
    class: 'btn tiny danger', title,
    onclick: () => { state.confirmRemove = key; render(); },
  }, label);
}
```

### `inlineForm()` — the prompt() replacement (app/index.html:3053-3079)

```js
function inlineForm({ question, placeholder, value = '', showsIdentifier, submitLabel, onSubmit, onCancel }) {
  let text = value;
  const preview = h('span', { class: 'becomes' }, '');
  const paint = () => {
    preview.innerHTML = '';
    if (showsIdentifier && text.trim()) preview.appendChild(document.createTextNode('→ ' + toPascal(text)));
  };
  const input = h('input', {
    type: 'text', value, placeholder, style: 'width:280px',
    oninput: (e) => { text = e.target.value; paint(); },
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    },
  });
  const submit = () => {
    if (!text.trim()) return toast('Give it a name.', true);
    onSubmit(text.trim());
  };
  paint();
  setTimeout(() => input.focus(), 0);
  return h('div', { class: 'inline-form' },
    question ? h('div', { class: 'q' }, question) : null,
    h('div', { class: 'adder' }, input, preview,
      h('button', { class: 'btn primary', onclick: submit }, submitLabel || 'Add'),
      h('button', { class: 'btn ghost', onclick: onCancel }, 'Cancel')));
}
```

```css
/* app/index.html:97-109 */
.inline-form {
  border: 1px dashed var(--command); border-radius: 6px;
  padding: 8px 10px; margin: 6px 0; background: var(--command-soft);
}
.inline-form .q { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
.becomes { font-family: var(--mono); font-size: 11px; color: var(--muted); }
```

### `pick()` — the select builder (app/index.html:3000-3049)

Builds a native `<select>` from `[value, text, icon?]` triples; auto-groups options sharing an
`"alias · property"` prefix into `<optgroup>`s; icons go in a trailing span so type-ahead
matches the name (progressive enhancement via `.icon-select` / `appearance: base-select`,
CSS index.html:794-800).

### `outcomeCard()` — published/rejected result (app/index.html:8579-8600)

Shows scenario/sandbox outcomes: rejected → `.card.outcome-rejected` naming the refusing rule
and the values it read; published → `.card.outcome-published` listing the events. See
components digest in extractable-components.md.

### `queryPopover()` — the DCB query peek (app/index.html:4031-4046, CSS 260-276)

Magnifier glyph + hover/focus/pinned popover (`.qpop`/`.qbtn`/`.qpanel`), body rendered in
`.dcb` mono coloring (`.k` muted keyword, `.t` entity tag, `.y` event type, `.al` alias —
CSS 255-259).

### Tabs (CSS app/index.html:653-660, builder `scenarioTabs` 8897-8914)

```css
.tabs { display: flex; gap: 4px; margin: 0 0 20px; border-bottom: 1px solid var(--border); }
.tab {
  background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--muted); font: inherit; font-size: 13px; cursor: pointer;
  padding: 7px 12px; margin-bottom: -1px; display: flex; align-items: center; gap: 6px;
}
.tab:hover { color: var(--text); }
.tab.on { color: var(--command); border-bottom-color: var(--command); }
```

### Advanced disclosure (app/shared.css:260-274)

`<details class="advanced">` — dashed border, uppercase summary with `▸/▾` markers.
