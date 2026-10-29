// ============================================================
// DCB Playground – WebMCP smoke test.
//
// `webmcp.js` registers tools on `document.modelContext` when one
// exists; here one is a stub that only records what was registered,
// and the test drives the recorded `execute` handlers directly. What
// is being checked is the seam: that every tool answers in the WebMCP
// result shape, that reads answer from the open model, that edits
// land in the app's own event log, and that a domain refusal comes
// back as an `isError` answer rather than a broken call.
//
// The page's script is loaded too – `list_problems` and the repaint
// after an edit reach into it – behind the same inert DOM stub as
// `ui.test.js`, and nothing runs at load because no `DOMContentLoaded`
// is ever fired.
//
// Run with `node app/webmcp.test.js`.
// ============================================================
const { createSandbox, loadApp, makeChecker, swap } = require('./test-harness.js');

const { sandbox, store } = createSandbox();

// What `webmcp.js` registered, by name – the surface under test.
const registered = new Map();
sandbox.document.modelContext = {
  registerTool: (tool) => { registered.set(tool.name, tool); },
};

// Same order as the <script> tags in index.html – webmcp.js *before*
// the page script – so a load-time dependency that would break in the
// browser breaks here too.
loadApp(sandbox, ['model.js', 'evaluate.js', 'dsl.js', 'shared.js', 'webmcp-schemas.js', 'webmcp.js'], {
  withPage: true,
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS;',
});

const { loadPredefinedModel, projectState } = sandbox;
const { check, eq, finish } = makeChecker();

// A tool's answer, unwrapped: asserts the WebMCP result shape on the
// way through, and hands back the text (parsed when it is JSON).
async function call(name, args) {
  const tool = registered.get(name);
  if (!tool) throw new Error(`no tool "${name}" was registered`);
  const result = await tool.execute(args || {});
  eq(Array.isArray(result.content) && result.content[0].type, 'text', `${name}: result shape`);
  const text = result.content[0].text;
  let value = text;
  try { value = JSON.parse(text); } catch { /* a summary sentence, not JSON */ }
  return { value, text, isError: result.isError === true };
}

(async () => {
  await check('every agreed tool is registered, each with a schema', () => {
    const kinds = [
      'group_definition', 'event_definition', 'projection_definition',
      'command_definition', 'custom_type_definition', 'scenario_definition',
      'projection_scenario_definition',
    ];
    const names = [
      'get_model', 'get_model_source', 'get_model_language', 'apply_model_source',
      'derive_boundary', 'evaluate_command', 'list_problems',
      'start_model', 'remove_definition', 'rename_definition', 'rename_member',
      'drive_command', 'get_sandbox', 'reset_sandbox',
      'create_group', 'add_group_projection', 'move_projection_into_group', 'move_projection_out_of_group',
      ...kinds.map((k) => 'add_' + k), ...kinds.map((k) => 'update_' + k),
    ];
    eq([...registered.keys()].sort(), names.slice().sort(), 'tool names');
    for (const name of names) {
      const tool = registered.get(name);
      eq(typeof tool.description, 'string', `${name} describes itself`);
      eq(tool.inputSchema.type, 'object', `${name} has an object schema`);
      // The Anthropic API refuses these at the top level of a tool
      // schema; nested is fine.
      eq(['oneOf', 'anyOf', 'allOf'].filter((k) => k in tool.inputSchema), [],
        `${name} has no top-level combinator`);
    }
  });

  await check('every tool argument is described and typed the way auditors read it', () => {
    // A WebMCP schema audit reads each top-level argument's own
    // `description` and `type` – a choice spelled only through
    // `oneOf`, or no type at all, reads as unsupported.
    const supported = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'];
    for (const [name, tool] of registered) {
      for (const [arg, schema] of Object.entries(tool.inputSchema.properties)) {
        eq(typeof schema.description === 'string' && schema.description.trim() !== '', true,
          `${name}.${arg} is described`);
        const types = [].concat(schema.type);
        eq(types.length > 0 && types.every((t) => supported.includes(t)), true,
          `${name}.${arg} has a supported type`);
      }
    }
  });

  await check('each add/update tool carries its kind\'s full schema, inlined', () => {
    const add = registered.get('add_command_definition').inputSchema;
    eq(Object.keys(add.properties).includes('boundary'), true, 'the real shape, not a free body');
    eq(typeof add.properties.conditions.items, 'object', 'nested shapes spelled out in place');
    const flat = JSON.stringify(add);
    eq(flat.includes('"$ref"') || flat.includes('"$defs"'), false,
      'nothing referencing anything – the consumers cannot resolve references');
    eq(add.required.includes('name'), true, 'named kinds require the name');
    const scenarioAdd = registered.get('add_scenario_definition').inputSchema;
    eq(scenarioAdd.required.includes('id'), false, 'an added scenario may omit its id');
    const scenarioUpdate = registered.get('update_scenario_definition').inputSchema;
    eq(scenarioUpdate.required.includes('id'), true, 'an updated one must say which');
  });

  await check('nothing experimental is offered in any tool\'s schema', () => {
    const offered = (name) => registered.get(name).inputSchema.properties;
    for (const name of ['remove_definition', 'rename_definition']) {
      eq(offered(name).kind.enum.includes('group-definition'), true, `${name} offers groups – they are not experimental`);
    }
    const group = offered('add_group_definition');
    eq('script' in group.projections.items.properties, false, 'no scripted grouped projections');
    eq('script' in offered('add_group_projection'), false, 'nor through add_group_projection');
    const command = offered('add_command_definition');
    eq('feature' in command, true, 'feature groups are not experimental');
    eq('icon' in command, true, 'a command\'s icon is not experimental');
    eq(JSON.stringify(command.boundary).includes('"isOptional"'), false, 'no optional reads');
    eq('when' in command.publishes.items.properties, false, 'no guarded emissions');
    const projection = offered('add_projection_definition');
    eq('derived' in projection, true, 'derived projections are offered');
    eq(projection.derived.properties.operator.enum, ['add', 'subtract', 'multiply', 'min', 'max'],
      'computing ones too');
    eq('script' in projection, false, 'no scripted projections');
    eq(JSON.stringify(projection).includes('"code"'), false, 'nor code handlers');
    const bindings = offered('add_command_definition').boundary.items.oneOf;
    eq(bindings.map((b) => Object.keys(b.properties).sort()),
      [['alias', 'group', 'tags'], ['alias', 'projection', 'tags']],
      'a binding reads a group or a projection – with no optional read, nor the arguments a read passes a script');
    eq('icon' in offered('add_event_definition'), true, 'nor is an event\'s');
    eq(JSON.stringify(registered.get('add_projection_definition').inputSchema).includes('"currentValue"'), false,
      'no currentValue operand');
  });

  await check('the model language is there before any model is', async () => {
    const { text, isError } = await call('get_model_language');
    eq(isError, false, 'needs no open model');
    eq(text.includes('apply_model_source'), true, 'says how to send a text');
    eq(text.includes('untagged projection LoanNumbering'), true, 'carries the tour');
    eq(text.includes('model "Course Example (simple)"'), true, 'and the example');
  });

  await check('rename tools offer only what the domain can do', () => {
    eq(registered.get('rename_definition').inputSchema.properties.kind.enum
      .some((k) => k.includes('scenario')), false, 'id-keyed kinds have no name to rename');
    const member = registered.get('rename_member').inputSchema.properties;
    eq(member.memberKind.enum.length > 0, true, 'member kinds derived from the rewrites');
  });

  await check('without an open model, a tool answers instead of throwing', async () => {
    const { isError, text } = await call('get_model');
    eq(isError, true, 'refused');
    eq(text.includes('No model is open'), true, 'and says why');
  });

  // The rest runs against the first predefined model, opened the way
  // the page opens one – stored, not held.
  store.clear();
  const id = loadPredefinedModel(sandbox.PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-simple'));
  sandbox.setActiveModelId(id);
  const model = () => projectState()[id];

  await check('get_model answers with the open model itself', async () => {
    const { value, isError } = await call('get_model');
    eq(isError, false, 'not an error');
    eq(value.id, id, 'the stored model');
    eq('DefineCourse' in value['command-definitions'], true, 'commands included');
  });

  await check('derive_boundary reports reads and writes for a command', async () => {
    const { value, isError } = await call('derive_boundary', { commandName: 'DefineCourse' });
    eq(isError, false, 'not an error');
    eq(value.items.map((i) => i.projection), ['CourseStatus'], 'the one read');
    eq(value.writes.length > 0, true, 'and what publishing writes');
  });

  await check('derive_boundary refuses a command the model does not have', async () => {
    const { isError, text } = await call('derive_boundary', { commandName: 'NoSuchCommand' });
    eq(isError, true, 'refused');
    eq(text.includes('NoSuchCommand'), true, 'naming the command');
  });

  await check('evaluate_command publishes against an empty log', async () => {
    const { value, isError } = await call('evaluate_command', {
      commandName: 'DefineCourse',
      arguments: { courseId: 'course1', capacity: 30 },
    });
    eq(isError, false, 'not an error');
    eq(value.outcome, 'published', 'the course did not exist, so');
    eq(value.events.map((e) => e.type), ['CourseDefined'], 'one event');
  });

  await check('evaluate_command is rejected when the boundary says no', async () => {
    const first = await call('evaluate_command', {
      commandName: 'DefineCourse',
      arguments: { courseId: 'course1', capacity: 30 },
    });
    const { value, isError } = await call('evaluate_command', {
      commandName: 'DefineCourse',
      arguments: { courseId: 'course1', capacity: 30 },
      givenEvents: first.value.events,
    });
    eq(isError, false, 'a rejection is an answer, not an error');
    eq(value.outcome, 'rejected', 'defined twice');
    eq(typeof value.failedRule.text, 'string', 'with the refusing rule');
  });

  await check('evaluate_command maps a broken call to an error answer', async () => {
    const { isError } = await call('evaluate_command', {
      commandName: 'DefineCourse', arguments: {},
    });
    eq(isError, true, 'a missing argument cannot be evaluated');
  });

  await check('drive_command records a published run in the sandbox', async () => {
    const { value, isError } = await call('drive_command', {
      commandName: 'DefineCourse', arguments: { courseId: 'sandbox1', capacity: 12 },
    });
    eq(isError, false, 'not an error');
    eq(value.outcome, 'published', 'published');
    const { value: staged } = await call('get_sandbox');
    eq(staged.steps.map((s) => s.command), ['DefineCourse'], 'one step recorded');
    eq(staged.events.map((e) => e.type), ['CourseDefined'], 'and its event in the log');
  });

  await check('a rejected drive is an answer, and records nothing', async () => {
    const { value, isError } = await call('drive_command', {
      commandName: 'DefineCourse', arguments: { courseId: 'sandbox1', capacity: 12 },
    });
    eq(isError, false, 'a rejection is an answer, not an error');
    eq(value.outcome, 'rejected', 'the course already exists in the sandbox');
    const { value: staged } = await call('get_sandbox');
    eq(staged.steps.length, 1, 'still the one step');
  });

  await check('a drive that cannot run maps to an error answer, recording nothing', async () => {
    const { isError } = await call('drive_command', {
      commandName: 'DefineCourse', arguments: {},
    });
    eq(isError, true, 'a missing argument cannot be evaluated');
    const { value: staged } = await call('get_sandbox');
    eq(staged.steps.length, 1, 'still the one step');
  });

  await check('the sandbox tools read the open model\'s session, not the one last shown', async () => {
    const previous = sandbox.activeModelId();
    sandbox.setActiveModelId(loadPredefinedModel(sandbox.PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-simple')));
    try {
      const { value: other } = await call('get_sandbox');
      eq(other.steps.length, 0, 'another model has a sandbox of its own');
    } finally {
      sandbox.setActiveModelId(previous);
    }
    const { value: back } = await call('get_sandbox');
    eq(back.steps.length, 1, 'and this one still has its step');
  });

  await check('reset_sandbox empties the timeline, leaving the model alone', async () => {
    await call('reset_sandbox');
    const { value: staged } = await call('get_sandbox');
    eq(staged, { steps: [], events: [] }, 'empty again');
    eq('DefineCourse' in model()['command-definitions'], true, 'the model is untouched');
  });

  await check('an unset optional property evaluates through the seam as the explicit null', async () => {
    await call('add_event_definition', {
      name: 'ProbeNoted',
      properties: [{ name: 'note', propertyType: 'string', isOptional: true, isList: false }],
    });
    await call('add_command_definition', {
      name: 'NoteProbe',
      properties: [{ name: 'note', propertyType: 'string', isOptional: true, isList: false }],
      boundary: [], conditions: [],
      publishes: [{ name: 'ProbeNoted', parameters: { note: { parameterName: 'note' } } }],
    });
    const { value, isError } = await call('evaluate_command', { commandName: 'NoteProbe', arguments: {} });
    eq(isError, false, 'unset is a call, not a broken one');
    eq(value.events[0].data, { note: null }, 'published with the null spelled out');
    await call('remove_definition', { kind: 'command-definition', name: 'NoteProbe' });
    await call('remove_definition', { kind: 'event-definition', name: 'ProbeNoted' });
  });

  await check('list_problems answers with plain findings', async () => {
    const { value, isError } = await call('list_problems');
    eq(isError, false, 'not an error');
    eq(Array.isArray(value), true, 'a list');
    for (const item of value) eq(Object.keys(item).sort(), ['what', 'why'], 'what and why only');
  });

  await check('add_event_definition lands in the app\'s own event log', async () => {
    const { isError } = await call('add_event_definition', {
      name: 'AgentProbeRecorded',
      properties: [{ name: 'probeId', propertyType: 'string', isOptional: false, isList: false }],
    });
    eq(isError, false, 'not an error');
    eq('AgentProbeRecorded' in model()['event-definitions'], true, 'stored');
  });

  await check('adding the same definition again is refused, verbatim', async () => {
    const { isError, text } = await call('add_event_definition', {
      name: 'AgentProbeRecorded', properties: [],
    });
    eq(isError, true, 'refused');
    eq(text.includes('already exists'), true, 'with the domain\'s words');
  });

  await check('an accepted edit that strands a reference echoes the advisory', async () => {
    const { isError, text } = await call('add_command_definition', {
      name: 'ProbeCommand',
      properties: [], boundary: [], conditions: [],
      publishes: [{ name: 'NoSuchEvent', parameters: {} }],
    });
    eq(isError, false, 'accepted, not refused – the demoted validations');
    eq(text.includes('Advisories introduced by this change'), true, 'the result says so');
    eq(text.includes('NoSuchEvent'), true, 'naming the dangling reference');
    const removed = await call('remove_definition', { kind: 'command-definition', name: 'ProbeCommand' });
    eq(removed.isError, false, 'and the probe cleans up after itself');
  });

  await check('rename_member renames the property in place', async () => {
    const { isError } = await call('rename_member', {
      kind: 'event-definition', definitionName: 'AgentProbeRecorded',
      memberKind: 'property', previousName: 'probeId', newName: 'traceId',
    });
    eq(isError, false, 'not an error');
    eq(model()['event-definitions'].AgentProbeRecorded.properties.map((p) => p.name),
      ['traceId'], 'renamed');
  });

  await check('rename_definition moves the name', async () => {
    const { isError } = await call('rename_definition', {
      kind: 'event-definition', previousName: 'AgentProbeRecorded', newName: 'AgentProbeLogged',
    });
    eq(isError, false, 'not an error');
    eq('AgentProbeLogged' in model()['event-definitions'], true, 'new name stored');
    eq('AgentProbeRecorded' in model()['event-definitions'], false, 'old name gone');
  });

  await check('update_event_definition replaces the body', async () => {
    const { isError } = await call('update_event_definition', {
      name: 'AgentProbeLogged',
      properties: [{ name: 'traceId', propertyType: 'string', isOptional: false, isList: false },
                   { name: 'note', propertyType: 'string', isOptional: false, isList: false }],
    });
    eq(isError, false, 'not an error');
    eq(model()['event-definitions'].AgentProbeLogged.properties.length, 2, 'both properties stored');
  });

  await check('an added scenario gets its id generated, and keeps its name', async () => {
    const derived = await call('evaluate_command', {
      commandName: 'DefineCourse',
      arguments: { courseId: 'course9', capacity: 10 },
    });
    const { isError } = await call('add_scenario_definition', {
      name: 'defining a fresh course works',
      command: 'DefineCourse',
      given: [],
      when: { arguments: { courseId: 'course9', capacity: 10 } },
      then: { outcome: 'published', events: derived.value.events.map((e) => ({ type: e.type, data: e.data })) },
    });
    eq(isError, false, 'not an error');
    const stored = Object.entries(model()['scenario-definitions']);
    eq(stored.length, 1, 'stored under a generated id');
    eq(stored[0][1].name, 'defining a fresh course works', 'name kept in the body');
    await call('remove_definition', { kind: 'scenario-definition', name: stored[0][0] });
  });

  await check('remove_definition takes it back out', async () => {
    const { isError } = await call('remove_definition', {
      kind: 'event-definition', name: 'AgentProbeLogged',
    });
    eq(isError, false, 'not an error');
    eq('AgentProbeLogged' in model()['event-definitions'], false, 'gone');
  });

  // Groups: not experimental, so an agent makes, fills and moves them
  // through the same command functions the page's gestures call.
  const commandsSay = () => JSON.stringify(model()['command-definitions']);
  const subscribe = (events) => call('evaluate_command', {
    commandName: 'SubscribeStudentToCourse',
    arguments: { courseId: 'c1', studentId: 's1' },
    givenEvents: events,
  });
  const defined = [
    { type: 'CourseDefined', data: { courseId: 'c1', capacity: 0 } },
    { type: 'StudentRegistered', data: { studentId: 's1' } },
  ];

  await check('create_group starts an empty group, its tag type made alongside', async () => {
    const { isError, text } = await call('create_group', {
      name: 'Probe', tag: { name: 'probeId', tagType: 'ProbeId' }, icon: '🧪',
    });
    eq(isError, false, text);
    eq(model()['group-definitions'].Probe,
      { icon: '🧪', tag: { name: 'probeId', tagType: 'ProbeId' }, projections: [] }, 'stored empty');
    eq(model()['custom-type-definitions'].ProbeId, { schema: { type: 'string' }, isTag: true }, 'the tag type made');
    eq(text.includes('Advisories introduced by this change'), true, 'an empty group is said to be one');
    await call('remove_definition', { kind: 'group-definition', name: 'Probe' });
    await call('remove_definition', { kind: 'custom-type-definition', name: 'ProbeId' });
    eq('Probe' in model()['group-definitions'], false, 'and removed like any definition');
  });

  await check('create_group refuses a name a projection already reads by', async () => {
    const { isError, text } = await call('create_group', {
      name: 'CourseStatus', tag: { name: 'courseId', tagType: 'CourseId' },
    });
    eq(isError, true, 'refused');
    eq(text.includes('already exists'), true, text);
  });

  await check('move_projection_into_group renames it and rewrites every read', async () => {
    await call('create_group', { name: 'Course', tag: { name: 'courseId', tagType: 'CourseId' } });
    const before = (await subscribe(defined)).value;
    const { value, isError, text } = await call('move_projection_into_group', {
      projection: 'CourseCapacity', group: 'Course',
    });
    eq(isError, false, text);
    eq(text.split('\n')[0], 'Course.capacity', 'answers the name it has now');
    eq('CourseCapacity' in model()['projection-definitions'], false, 'no longer top-level');
    eq(model()['group-definitions'].Course.projections.map((p) => p.name), ['capacity'], 'owned by the group');
    eq('tags' in model()['group-definitions'].Course.projections[0], false, 'without a tag of its own');
    eq(commandsSay().includes('"CourseCapacity"'), false, 'no read left on the old name');
    eq(commandsSay().includes('"group":"Course"') && commandsSay().includes('"property":"capacity"'), true,
      'every read on the new one, through an alias of the group');
    const after = (await subscribe(defined)).value;
    eq([after.outcome, after.failedRule && after.failedRule.rejection],
      [before.outcome, before.failedRule && before.failedRule.rejection], 'the model decides as before');
    eq(before.failedRule.rejection, 'Course is full', '(a course of capacity 0 is full)');
    const { text: source } = await call('get_model_source');
    eq(source.includes('group Course (tag courseId: CourseId) {'), true, 'the code shows the group');
    eq(source.includes('alias course = Course(courseId)') && source.includes('course.capacity'), true,
      'and the read through it');
  });

  await check('move_projection_into_group refuses a projection the group\'s tag does not read', async () => {
    const { isError, text } = await call('move_projection_into_group', {
      projection: 'StudentSubscriptionCount', group: 'Course',
    });
    eq(isError, true, 'refused');
    eq(text.includes('tagged by studentId: StudentId'), true, text);
    eq('StudentSubscriptionCount' in model()['projection-definitions'], true, 'left where it was');
  });

  await check('a grouped projection is edited by its qualified name', async () => {
    const body = { ...model()['group-definitions'].Course.projections[0] };
    delete body.name;
    const updated = await call('update_projection_definition', { name: 'Course.capacity', ...body, initialValue: 5 });
    eq(updated.isError, false, updated.text);
    eq(model()['group-definitions'].Course.projections[0].initialValue, 5, 'stored on its group');
    eq((await subscribe([])).value.failedRule.rejection, 'Course is not active', 'read through the group');
    const renamed = await call('rename_member', {
      kind: 'group-definition', definitionName: 'Course', memberKind: 'projection',
      previousName: 'capacity', newName: 'seats',
    });
    eq(renamed.isError, false, renamed.text);
    eq(commandsSay().includes('"property":"seats"') && !commandsSay().includes('"property":"capacity"'), true,
      'reads follow a renamed local name');
    const back = await call('rename_definition', {
      kind: 'projection-definition', previousName: 'Course.seats', newName: 'capacity',
    });
    eq(back.isError, false, back.text);
    eq(model()['group-definitions'].Course.projections.map((p) => p.name), ['capacity'], 'renamed within its group');
  });

  await check('add_group_projection adds one under its local name, read by the group\'s tag', async () => {
    const { isError, text } = await call('add_group_projection', {
      group: 'Course', name: 'archived', valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'CourseArchived', operation: 'set', value: true }],
    });
    eq(isError, false, text);
    eq(model()['group-definitions'].Course.projections.map((p) => p.name), ['capacity', 'archived'], 'stored in the group');
    const viaKind = await call('add_projection_definition', {
      name: 'Course.defined', valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'CourseDefined', operation: 'set', value: true }],
    });
    eq(viaKind.isError, false, viaKind.text);
    eq(model()['group-definitions'].Course.projections.map((p) => p.name), ['capacity', 'archived', 'defined'],
      'add_projection_definition with a qualified name lands there too');
    const twice = await call('add_group_projection', {
      group: 'Course', name: 'archived', valueType: 'boolean', initialValue: false, handlers: [],
    });
    eq(twice.isError, true, 'a local name is taken once');
    const removed = await call('remove_definition', { kind: 'projection-definition', name: 'Course.defined' });
    eq(removed.isError, false, removed.text);
    eq(model()['group-definitions'].Course.projections.map((p) => p.name), ['capacity', 'archived'], 'removed from its group');
  });

  await check('a grouped projection that is scripted is refused', async () => {
    const { isError, text } = await call('add_group_projection', {
      group: 'Course', name: 'scripted', valueType: 'integer', isList: false,
      script: { initialState: 0 }, handlers: [{ event: 'CourseDefined', code: 'state + 1' }],
    });
    eq(isError, true, 'refused');
    eq(text.includes('Course.scripted uses scripted projections'), true, text);
    eq(model()['group-definitions'].Course.projections.length, 2, 'not stored');
  });

  await check('move_projection_out_of_group gives it back its tag and its reads', async () => {
    const { value, isError, text } = await call('move_projection_out_of_group', { projection: 'Course.capacity' });
    eq(isError, false, text);
    eq(text.split('\n')[0], 'CourseCapacity', 'the name it has now');
    eq(model()['projection-definitions'].CourseCapacity.tags, [{ name: 'courseId', tagType: 'CourseId' }], 'tagged again');
    eq(commandsSay().includes('"Course.capacity"'), false, 'no read left on the grouped name');
    eq((await subscribe(defined)).value.failedRule.rejection, 'Course is full', 'decides as before');
    const removed = await call('remove_definition', { kind: 'group-definition', name: 'Course' });
    eq(removed.isError, false, removed.text);
    eq('Course' in model()['group-definitions'], false, 'the group goes, with what it owned');
  });

  await check('start_model opens a fresh, empty model', async () => {
    const { value, isError } = await call('start_model', { name: 'Agent Scratch Model' });
    eq(isError, false, 'not an error');
    eq(sandbox.activeModelId(), value.id, 'and it is the open one now');
    const { value: fresh } = await call('get_model');
    eq(fresh.name, 'Agent Scratch Model', 'get_model answers from it');
    eq(Object.keys(fresh['command-definitions']).length, 0, 'and it is empty');
  });

  await check('start_model works with nothing open at all', async () => {
    sandbox.clearActiveModelId();
    const { isError } = await call('start_model', { name: 'From Nothing' });
    eq(isError, false, 'the one tool that needs no open model');
    eq(typeof sandbox.activeModelId(), 'string', 'and opens what it made');
  });

  await check('start_model refuses an empty name', async () => {
    const { isError, text } = await call('start_model', { name: '   ' });
    eq(isError, true, 'refused');
    eq(text.includes('must not be empty'), true, 'with the domain\'s words');
  });

  await check('the model as code goes out, comes back edited, and is refused whole on an error', async () => {
    await call('start_model', { name: 'Code Probe' });
    const { text: empty } = await call('get_model_source');
    eq(empty, 'model "Code Probe"\n', 'an empty model is its name');
    const source = empty + [
      'tag type ProbeId = string',
      'event ProbeHappened { tag probeId: ProbeId }',
      'projection ProbeSeen (tag probeId: ProbeId): boolean = false { on ProbeHappened => set true }',
      'command Probe2(probeId: ProbeId) {',
      '  emit ProbeHappened { probeId }',
      '}',
    ].join('\n');
    const before = sandbox.loadEvents().length;
    const applied = await call('apply_model_source', { source });
    eq(applied.isError, false, applied.text);
    eq(applied.text.startsWith('applied code: added'), true, applied.text);
    const after = sandbox.loadEvents().length;
    sandbox.undo();
    eq(sandbox.loadEvents().length, before, 'one undo takes the whole apply back');
    sandbox.redo();
    const { text: back } = await call('get_model_source');
    eq(back.includes('projection ProbeSeen (tag probeId: ProbeId): boolean = false {'), true, 'what was sent is there');
    const refused = await call('apply_model_source', { source: source + '\nevent {' });
    eq(refused.isError, true, 'refused');
    eq(refused.text.includes('- line 8, column 7: Expected an event name'), true, refused.text);
    eq(sandbox.loadEvents().length, after, 'nothing appended');
  });

  await check('a tool that overwrites or removes says so; one that only adds or reads does not', () => {
    const destructive = [...registered.values()].filter((tool) => tool.annotations && tool.annotations.destructiveHint)
      .map((tool) => tool.name).sort();
    eq(destructive, [
      'apply_model_source', 'remove_definition', 'reset_sandbox',
      ...[...registered.keys()].filter((name) => name.startsWith('update_')),
    ].sort(), 'destructive');
    for (const tool of registered.values()) {
      const { readOnlyHint, destructiveHint } = tool.annotations || {};
      eq(readOnlyHint === true || typeof destructiveHint === 'boolean', true,
        `${tool.name} says what it does – the default for a writing tool is destructive`);
    }
  });

  await check('apply_model_source removes nothing unless it is told it may', async () => {
    const previous = sandbox.activeModelId();
    sandbox.setActiveModelId(loadPredefinedModel(sandbox.PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-simple')));
    const { text: source } = await call('get_model_source');
    const before = sandbox.loadEvents().length;
    const refused = await call('apply_model_source', { source: 'model "x"' });
    eq(refused.isError, true, 'refused');
    eq(/would remove/.test(refused.text) && /allowRemovals/.test(refused.text), true, refused.text);
    eq(/CourseDefined/.test(refused.text), true, 'naming what would go');
    eq(sandbox.loadEvents().length, before, 'nothing applied');
    const additive = await call('apply_model_source', { source: source + '\nevent ExtraHappened { note: string }\n' });
    eq(additive.isError, false, 'an apply that removes nothing needs no flag: ' + additive.text);
    const allowed = await call('apply_model_source', { source: 'model "x"', allowRemovals: true });
    eq(allowed.isError, false, allowed.text);
    eq(Object.keys(sandbox.activeModel()['event-definitions']), [], 'removed when allowed');
    sandbox.setActiveModelId(previous);
  });

  // A model written whole, the way an agent should build one.
  const LIBRARY = [
    'model "Library"',
    'tag type BookId = string',
    'event BookAdded { tag bookId: BookId }',
    'projection BookKnown (tag bookId: BookId): boolean = false { on BookAdded => set true }',
    'command AddBook(bookId: BookId) {',
    '  require BookKnown(bookId) is false',
    '    else reject "Book already exists"',
    '  emit BookAdded { bookId }',
    '}',
  ].join('\n');
  const modelCount = () => Object.keys(projectState()).length;

  await check('start_model creates a whole model from code, in one call', async () => {
    const { value, isError, text } = await call('start_model', { name: 'Scratch', source: LIBRARY });
    eq(isError, false, text);
    eq(sandbox.activeModelId(), value.id, 'opened');
    const opened = projectState()[value.id];
    eq(opened.name, 'Library', 'the model line names it');
    eq(Object.keys(opened['command-definitions']), ['AddBook'], 'with its definitions');
    eq(text.includes('Advisories'), false, 'clean, and not judged against the model open before');
  });

  await check('an agent\'s scenario without a then is recorded, and the result says which', async () => {
    const source = swap(LIBRARY, /\n}$/, '') + [
      '',
      '  scenarios {',
      '    scenario "added once" {',
      '      given BookAdded { bookId: "b1" }',
      '      when AddBook { bookId: "b1" }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const { value, isError, text } = await call('start_model', { name: 'Outcomes', source });
    eq(isError, false, text);
    eq(value.applied.includes('recorded the outcome of the scenario written without a then (line 10, AddBook "added once")'), true, text);
    const [stored] = Object.values(projectState()[value.id]['scenario-definitions']);
    eq(stored.then, { outcome: 'rejected', events: [], rejection: 'Book already exists' }, 'recorded');
  });

  await check('start_model without code points the agent at the language', async () => {
    const { value } = await call('start_model', { name: 'Empty Again' });
    eq(value.next.includes('get_model_language') && value.next.includes('apply_model_source'), true, value.next);
  });

  await check('start_model refuses broken code and creates nothing', async () => {
    const before = modelCount();
    const { isError, text } = await call('start_model', { name: 'Broken', source: LIBRARY + '\nevent {' });
    eq(isError, true, 'refused');
    eq(text.includes('- line 10, column 7: Expected an event name'), true, text);
    eq(modelCount(), before, 'no empty model left behind');
  });

  await check('code adding an experimental construct is refused, naming its line', async () => {
    const before = modelCount();
    const scripted = LIBRARY + [
      '',
      'group Book (tag bookId: BookId) {',
      '  scripted projection adds: integer {',
      '    initialState 0',
      '    on BookAdded => ```state + 1```',
      '  }',
      '}',
    ].join('\n');
    const started = await call('start_model', { name: 'Scripted', source: scripted });
    eq(started.isError, true, 'refused when starting');
    eq(started.text.includes('- line 11: Book.adds uses scripted projections'), true, started.text);
    eq(modelCount(), before, 'and nothing created');
    await call('start_model', { name: 'Guards', source: LIBRARY });
    const guarded = swap(LIBRARY, '  emit BookAdded { bookId }', '  emit BookAdded { bookId } when BookKnown(bookId) is false');
    const applied = await call('apply_model_source', { source: guarded });
    eq(applied.isError, true, 'refused when applying');
    eq(applied.text.includes('- line 5: AddBook uses guarded emissions'), true, applied.text);
  });

  await check('a definition adding an experimental construct is refused', async () => {
    const { isError, text } = await call('add_command_definition', {
      name: 'ProbeGuarded',
      properties: [{ name: 'bookId', propertyType: 'BookId', isOptional: false, isList: false }],
      boundary: [], conditions: [],
      publishes: [{
        name: 'BookAdded', parameters: { bookId: { parameterName: 'bookId' } },
        when: [{ leftHandSide: { parameterName: 'bookId' }, predicate: 'isNotEmpty' }],
      }],
    });
    eq(isError, true, 'refused');
    eq(text.includes('ProbeGuarded uses guarded emissions'), true, text);
    eq('ProbeGuarded' in projectState()[sandbox.activeModelId()]['command-definitions'], false, 'not stored');
  });

  await check('a model already using experimental constructs stays editable', async () => {
    const scriptedId = loadPredefinedModel(sandbox.PREDEFINED_MODELS.findIndex((m) => m.slug === 'content-decisions-scripted'));
    sandbox.setActiveModelId(scriptedId);
    const { text: source } = await call('get_model_source');
    eq(source.includes('scripted projection'), true, 'shown as stored');
    const applied = await call('apply_model_source', { source: source + '\nevent ExtraHappened { note: string }\n' });
    eq(applied.isError, false, applied.text);
    const [name, body] = Object.entries(projectState()[scriptedId]['projection-definitions'])
      .find(([, b]) => b.script);
    const updated = await call('update_projection_definition', { name, ...body });
    eq(updated.isError, false, 'a script it already had is kept: ' + updated.text);
  });

  await check('an agent edit is one undo step of its own', async () => {
    await call('start_model', { name: 'Undo Probe' });
    const before = sandbox.loadEvents().length;
    await call('add_event_definition', {
      name: 'ProbeHappened',
      properties: [{ name: 'probeId', propertyType: 'string', isOptional: false, isList: false }],
    });
    eq(sandbox.loadEvents().length, before + 1, 'the edit appended');
    sandbox.undo();
    eq(sandbox.loadEvents().length, before, 'one undo removes exactly the agent\'s edit');
    const modelId = sandbox.activeModelId();
    eq('ProbeHappened' in sandbox.projectState()[modelId]['event-definitions'], false, 'gone again');
    sandbox.redo();
    eq('ProbeHappened' in sandbox.projectState()[modelId]['event-definitions'], true, 'redo puts it back');
  });

  finish();
  // Toast timers set by the tools keep the event loop alive; the tally
  // is printed, so leaving is honest.
  process.exit(0);
})();
