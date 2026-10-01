// ============================================================
// WebMCP — the playground's tools for an in-browser agent.
//
// Registers the model on `document.modelContext` (the WebMCP browser
// API) so an agent in the browser can inspect the open model, drive
// commands against a hypothetical event log, and edit definitions —
// through the same command functions the buttons call, so every edit
// lands in the app's own event log and is undoable like any other.
//
// Loaded as a classic script like everything else here, and inert in
// two directions: without the API (no flag, no extension) nothing is
// registered, and without an open model every tool answers with that
// instead of an error trace. Tool execution never works from a
// `file:` origin — WebMCP needs a real one, e.g. `npx serve` over
// this directory.
//
// Every call is announced with a toast, and a tool that changed the
// model repaints the page, so what the agent does is watchable.
// ============================================================

(() => {
  const context = document.modelContext
    || (typeof navigator !== 'undefined' && navigator.modelContext);
  if (!context || typeof context.registerTool !== 'function') return;

  const asText = (value) => ({
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  });
  const refusal = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

  // What a mutation left the model saying about itself: the advisories
  // this edit introduced, spelled out so the agent can fix them in the
  // same session, plus the standing count so twenty of them cannot
  // pile up unnoticed. Empty when the model is as clean as before.
  const advisoryNote = (before, after) => {
    const keyOf = (a) => `${a.kind}:${a.name}:${a.message}`;
    const seen = new Set(before.map(keyOf));
    const fresh = after.filter((a) => !seen.has(keyOf(a)));
    if (!fresh.length && !after.length) return '';
    const lines = fresh.map((a) => `- ${humanize(a.kind)} "${a.name}": ${a.message}`);
    const standing = `${after.length} advisor${after.length === 1 ? 'y' : 'ies'} standing on the model`;
    return fresh.length
      ? `\n\nAdvisories introduced by this change:\n${lines.join('\n')}\n(${standing}.)`
      : `\n\n(${standing}; none introduced by this change.)`;
  };

  // The shared wrapper: resolve the open model, run the tool, announce
  // what happened. A domain refusal or an evaluation error is a normal
  // answer for an agent — it comes back as an `isError` result with the
  // message the interface would have shown, not as a broken call. A
  // mutation that *succeeded* may still have left the model with
  // something to say — the demoted validations — and that rides along
  // in the result rather than blocking it.
  // `mutates` marks a tool that edits the model — it repaints and
  // echoes advisories. `mutatesSandbox` marks one that only moves the
  // page's sandbox session: it repaints too, but the model is exactly
  // as it was, so there is nothing advisory to say about it.
  const register = ({ name, description, inputSchema, mutates, mutatesSandbox, needsModel = true, run }) => {
    context.registerTool({
      name,
      description,
      inputSchema,
      annotations: mutates || mutatesSandbox ? undefined : { readOnlyHint: true },
      async execute(args) {
        try {
          const model = activeModel();
          if (needsModel && !model) {
            return refusal('No model is open in the playground — open or create one first.');
          }
          const before = mutates && model ? modelAdvisories(model) : [];
          const { summary, payload } = run(model, args || {});
          if ((mutates || mutatesSandbox) && typeof render === 'function') render();
          toast('Agent · ' + summary);
          const value = payload === undefined ? summary : payload;
          if (mutates) {
            const current = activeModel();
            const note = advisoryNote(before, current ? modelAdvisories(current) : []);
            if (note) {
              const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
              return asText(text + note);
            }
          }
          return asText(value);
        } catch (err) {
          toast('Agent · ' + name + ': ' + err.message, true);
          return refusal(err.message);
        }
      },
    });
  };

  const commandBodyOf = (model, commandName) => {
    const body = model['command-definitions'][commandName];
    if (!body) throw new Error(`This model has no command "${commandName}".`);
    return body;
  };

  const kindSchema = (kinds) => ({
    type: 'string',
    enum: kinds,
    description: 'Which kind of definition.',
  });

  // The full shape of one definition, straight from the model schema
  // (see webmcp-schemas.js and the generator that writes it). The
  // definition's key — `name`, or `id` for the id-keyed scenario
  // kinds — is part of the object; `withKey` says whether a call must
  // supply it, and an add of an id-keyed kind must not have to.
  const definitionSchema = (kind, withKey) => {
    const base = WEBMCP_DEFINITION_SCHEMAS[kind];
    const key = isIdKeyed(kind) ? 'id' : 'name';
    const required = new Set(base.required || []);
    if (withKey) required.add(key); else required.delete(key);
    return { ...base, required: [...required] };
  };

  // ---------- reading ----------

  register({
    name: 'get_model',
    description: 'The DCB model currently open in the playground, in full: its events, '
      + 'entities, projections, custom types and the commands that guard them. '
      + 'Start here — every other tool speaks in this model\'s names.',
    inputSchema: { type: 'object', properties: {} },
    run: (model) => ({
      summary: `read model "${model.name}"`,
      payload: model,
    }),
  });

  register({
    name: 'derive_boundary',
    description: 'The consistency boundary derived for one command: what it reads '
      + '(per binding: the tags queried, the event types consulted, the properties '
      + 'the decision depends on) and the tags its published events write.',
    inputSchema: {
      type: 'object',
      properties: {
        commandName: { type: 'string', description: 'A command defined in the open model.' },
      },
      required: ['commandName'],
    },
    run: (model, { commandName }) => ({
      summary: `derived the boundary of ${commandName}`,
      payload: deriveDcb(model, commandBodyOf(model, commandName)),
    }),
  });

  register({
    name: 'evaluate_command',
    description: 'Run a command of the open model against a hypothetical event log and '
      + 'report the outcome: `published` with the events it would record, or `rejected` '
      + 'with the rule that refused it. Pure — nothing in the playground changes; to '
      + 'stage a run the person can see and scrub through, use drive_command instead. '
      + '`reads` shows what the boundary resolved to when it decided.',
    inputSchema: {
      type: 'object',
      properties: {
        commandName: { type: 'string', description: 'A command defined in the open model.' },
        arguments: {
          type: 'object',
          description: 'A value for each of the command\'s properties, keyed by name.',
        },
        givenEvents: {
          type: 'array',
          description: 'The events already in the log, oldest first. Defaults to an empty log. '
            + 'Each is {type, data} — the shape evaluate_command itself publishes, so outcomes chain.',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, data: { type: 'object' } },
            required: ['type', 'data'],
          },
        },
      },
      required: ['commandName'],
    },
    run: (model, { commandName, arguments: args, givenEvents }) => {
      const outcome = evaluateCommand(model, givenEvents || [], commandName, args || {});
      return {
        summary: `evaluated ${commandName} — ${outcome.outcome === 'published'
          ? 'published ' + outcome.events.map((e) => e.type).join(', ')
          : 'rejected: ' + outcome.failedRule.text}`,
        payload: outcome,
      };
    },
  });

  register({
    name: 'list_problems',
    description: 'Everything findably wrong with the open model, without judging it: '
      + 'loose ends (events nothing records, entities nothing reads, commands that '
      + 'record nothing), advisories (what a definition got wrong without being '
      + 'refused — dangling references, boundary gaps, mistyped values) and '
      + 'scenarios the model no longer agrees with.',
    inputSchema: { type: 'object', properties: {} },
    run: (model) => {
      const found = problems(model).map(({ what, why }) => ({ what, why }));
      return {
        summary: found.length
          ? `listed ${found.length} problem${found.length === 1 ? '' : 's'}`
          : 'listed problems — none found',
        payload: found,
      };
    },
  });

  // ---------- editing ----------
  //
  // These go through the same command functions the interface calls, so
  // an agent's edit is an event in the app's own log: visible on the
  // next repaint, undoable, and refused by the same domain rules — a
  // refusal comes back verbatim as the tool's error text.

  register({
    name: 'start_model',
    description: 'Start a fresh, empty model — no events, no entities, no commands — and '
      + 'open it, so every other tool speaks about it from here on. The model that was '
      + 'open before stays stored and can be reopened from the Models modal.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'What the new model is called.' } },
      required: ['name'],
    },
    mutates: true,
    needsModel: false,
    run: (_, { name }) => {
      // `openNewModel` is `createNamedModel` unwrapped from its `run`
      // wrapper — the refusal has to reach the agent, not only the
      // toast — so both paths open a model the same one way.
      const id = openNewModel(name);
      if (typeof state === 'object' && state) state.splash = false;
      return {
        summary: `started model "${name.trim()}"`,
        payload: { id, name: name.trim() },
      };
    },
  });

  // One add and one update per kind, so each tool's inputSchema is the
  // full shape of that one definition — an agent discovers what a
  // command body looks like from the tool itself, not by fishing an
  // example out of get_model.
  for (const kind of DEF_KINDS) {
    const label = humanize(kind);
    const suffix = kind.replace(/-/g, '_');
    const idKeyed = isIdKeyed(kind);
    const keyOf = (args) => (idKeyed ? args.id : args.name);
    const bodyOf = (args) => {
      const { name, id, ...body } = args;
      return idKeyed && args.name !== undefined ? { name: args.name, ...body } : body;
    };

    register({
      name: 'add_' + suffix,
      description: `Add a ${label.toLowerCase()} to the open model. The input is the `
        + 'definition itself, in the shape this schema describes.'
        + (kind === 'entity-definition'
          ? ' Adding an entity also creates its derived identifier type.' : '')
        + (idKeyed ? ' The id is generated when omitted.' : '')
        + ' Refused only when the name is taken or the body is structurally not a '
        + 'definition; anything semantically wrong — a dangling reference, a boundary '
        + 'gap — is accepted and comes back as an advisory in the result. Fix what it '
        + 'reports before moving on.',
      inputSchema: definitionSchema(kind, !idKeyed),
      mutates: true,
      run: (model, args) => {
        const key = idKeyed ? (args.id || generateId()) : args.name;
        addDefinition(kind, model.id, key, bodyOf(args));
        return { summary: `added ${label} "${idKeyed ? args.name || key : key}"` };
      },
    });

    register({
      name: 'update_' + suffix,
      description: `Replace the ${label.toLowerCase()} the ${idKeyed ? 'id' : 'name'} `
        + 'points at, wholesale. A body that strands a reference elsewhere is accepted '
        + 'and the stranding comes back as an advisory in the result — renames still '
        + 'belong in rename_definition and rename_member, which move the references '
        + 'along instead of stranding them.',
      inputSchema: definitionSchema(kind, true),
      mutates: true,
      run: (model, args) => {
        updateDefinition(kind, model.id, keyOf(args), bodyOf(args));
        return { summary: `updated ${label} "${idKeyed ? args.name || args.id : args.name}"` };
      },
    });
  }

  register({
    name: 'remove_definition',
    description: 'Remove a definition of any kind from the open model. Whatever still '
      + 'references it is left dangling, and each dangling reference comes back as an '
      + 'advisory in the result. For the id-keyed scenario kinds, `name` is the id.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: kindSchema(DEF_KINDS),
        name: {
          type: 'string',
          description: 'The name of the definition to remove — or its id, for the '
            + 'id-keyed scenario kinds.',
        },
      },
      required: ['kind', 'name'],
    },
    mutates: true,
    run: (model, { kind, name }) => {
      removeDefinition(kind, model.id, name);
      return { summary: `removed ${humanize(kind)} "${name}"` };
    },
  });

  register({
    name: 'rename_definition',
    description: 'Rename a definition and rewrite every reference to it across the model '
      + 'in the same change — never rename by editing bodies one at a time. The id-keyed '
      + 'scenario kinds have no name to rename, so they are not offered here.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: kindSchema(DEF_KINDS.filter((k) => !isIdKeyed(k))),
        previousName: { type: 'string', description: 'The definition\'s current name.' },
        newName: {
          type: 'string',
          description: 'The name to give it — PascalCase, and not already taken by '
            + 'another definition of the same kind.',
        },
      },
      required: ['kind', 'previousName', 'newName'],
    },
    mutates: true,
    run: (model, { kind, previousName, newName }) => {
      renameDefinition(kind, model.id, previousName, newName);
      return { summary: `renamed ${humanize(kind)} "${previousName}" to "${newName}"` };
    },
  });

  // The combinations that exist are exactly the keys of MEMBER_REWRITES
  // ('<kind>:<memberKind>'), so the schema is derived from them rather
  // than restated here.
  const memberCombos = Object.keys(MEMBER_REWRITES).map((k) => k.split(':'));
  register({
    name: 'rename_member',
    description: 'Rename one member of a definition — a property, an enum member, a '
      + 'composite type\'s field, a projection\'s parameter — and rewrite everything '
      + 'that referred to it by that name. The valid kind/memberKind pairs: '
      + memberCombos.map(([k, m]) => `${k} + ${m}`).join('; ') + '.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: kindSchema([...new Set(memberCombos.map(([k]) => k))]),
        definitionName: {
          type: 'string',
          description: 'The name of the definition the member belongs to.',
        },
        memberKind: {
          type: 'string',
          enum: [...new Set(memberCombos.map(([, m]) => m))],
          description: 'What is being renamed; only the pairs listed in the tool '
            + 'description are valid.',
        },
        previousName: { type: 'string', description: 'The member\'s current name.' },
        newName: {
          type: 'string',
          description: 'The name to give it — not already taken by another member of '
            + 'the same definition.',
        },
      },
      required: ['kind', 'definitionName', 'memberKind', 'previousName', 'newName'],
    },
    mutates: true,
    run: (model, { kind, definitionName, memberKind, previousName, newName }) => {
      renameMember(kind, model.id, definitionName, memberKind, previousName, newName);
      return {
        summary: `renamed ${memberKind} "${previousName}" of ${humanize(kind)} `
          + `"${definitionName}" to "${newName}"`,
      };
    },
  });

  // ---------- the sandbox ----------
  //
  // The page's other way to try a model: commands driven against each
  // other, events piling up on a timeline the person can scrub (see
  // section D of the page script). These tools drive that same
  // session, so an agent can stage a worked example to look at
  // together — the model and its stored log are untouched throughout,
  // and a reload clears it, like anything else in the sandbox.

  register({
    name: 'drive_command',
    description: 'Drive a command in the sandbox: evaluate it against the events already '
      + 'recorded there and, when it publishes, append its events to the sandbox timeline '
      + 'the person sees (the Sandbox page in the playground). A rejection is an ordinary '
      + 'outcome — reported, nothing recorded. The model itself never changes. Drive '
      + 'commands in sequence to stage a worked example; for a what-if that should leave '
      + 'no trace, use evaluate_command instead.',
    inputSchema: {
      type: 'object',
      properties: {
        commandName: { type: 'string', description: 'A command defined in the open model.' },
        arguments: {
          type: 'object',
          description: 'A value for each of the command\'s properties, keyed by name.',
        },
      },
      required: ['commandName'],
    },
    mutatesSandbox: true,
    run: (model, { commandName, arguments: args }) => {
      const outcome = sessionDrive(model, commandName, args || {});
      return {
        summary: `drove ${commandName} in the sandbox — ${outcome.outcome === 'published'
          ? 'published ' + outcome.events.map((e) => e.type).join(', ')
          : 'rejected: ' + outcome.failedRule.text}`,
        payload: outcome,
      };
    },
  });

  register({
    name: 'get_sandbox',
    description: 'The sandbox as it stands: every command driven so far — with its '
      + 'arguments and the range of events it appended — and the full event log those '
      + 'runs have built up, oldest first. Empty when nothing has been driven.',
    inputSchema: { type: 'object', properties: {} },
    run: () => ({
      summary: `read the sandbox — ${session.steps.length} step${session.steps.length === 1 ? '' : 's'}, `
        + `${session.log.length} event${session.log.length === 1 ? '' : 's'}`,
      payload: { steps: session.steps, events: session.log },
    }),
  });

  register({
    name: 'reset_sandbox',
    description: 'Clear the sandbox: every driven command, its events and whatever was '
      + 'being watched. The model is untouched — this only empties the timeline, ready '
      + 'for a fresh example.',
    inputSchema: { type: 'object', properties: {} },
    mutatesSandbox: true,
    run: () => {
      sessionReset();
      if (typeof state === 'object' && state) state.sandboxDraft = null;
      return { summary: 'reset the sandbox' };
    },
  });
})();
