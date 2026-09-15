// ============================================================
// DCB Playground — WebMCP smoke test.
//
// `webmcp.js` registers tools on `document.modelContext` when one
// exists; here one is a stub that only records what was registered,
// and the test drives the recorded `execute` handlers directly. What
// is being checked is the seam: that every tool answers in the WebMCP
// result shape, that reads answer from the open model, that edits
// land in the app's own event log, and that a domain refusal comes
// back as an `isError` answer rather than a broken call.
//
// The page's script is loaded too — `list_problems` and the repaint
// after an edit reach into it — behind the same inert DOM stub as
// `ui.test.js`, and nothing runs at load because no `DOMContentLoaded`
// is ever fired.
//
// Run with `node app/webmcp.test.js`.
// ============================================================
const { createSandbox, loadApp, makeChecker } = require('./test-harness.js');

const { sandbox, store } = createSandbox();

// What `webmcp.js` registered, by name — the surface under test.
const registered = new Map();
sandbox.document.modelContext = {
  registerTool: (tool) => { registered.set(tool.name, tool); },
};

// Same order as the <script> tags in index.html — webmcp.js *before*
// the page script — so a load-time dependency that would break in the
// browser breaks here too.
loadApp(sandbox, ['model.js', 'evaluate.js', 'shared.js', 'webmcp-schemas.js', 'webmcp.js'], {
  withPage: true,
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
      'entity_definition', 'event_definition', 'projection_definition',
      'command_definition', 'custom_type_definition', 'scenario_definition',
      'projection_scenario_definition',
    ];
    const names = [
      'get_model', 'derive_boundary', 'evaluate_command', 'list_problems',
      'start_model', 'remove_definition', 'rename_definition', 'rename_member',
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

  await check('each add/update tool carries its kind\'s full schema, inlined', () => {
    const add = registered.get('add_command_definition').inputSchema;
    eq(Object.keys(add.properties).includes('boundary'), true, 'the real shape, not a free body');
    eq(typeof add.properties.conditions.items, 'object', 'nested shapes spelled out in place');
    const flat = JSON.stringify(add);
    eq(flat.includes('"$ref"') || flat.includes('"$defs"'), false,
      'nothing referencing anything — the consumers cannot resolve references');
    eq(add.required.includes('name'), true, 'named kinds require the name');
    const scenarioAdd = registered.get('add_scenario_definition').inputSchema;
    eq(scenarioAdd.required.includes('id'), false, 'an added scenario may omit its id');
    const scenarioUpdate = registered.get('update_scenario_definition').inputSchema;
    eq(scenarioUpdate.required.includes('id'), true, 'an updated one must say which');
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
  // the page opens one — stored, not held.
  store.clear();
  const id = loadPredefinedModel(0);
  store.set('dcb-playground:model', id);
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
    eq(value.items.map((i) => i.alias), ['course'], 'the one binding');
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

  await check('start_model opens a fresh, empty model', async () => {
    const { value, isError } = await call('start_model', { name: 'Agent Scratch Model' });
    eq(isError, false, 'not an error');
    eq(store.get('dcb-playground:model'), value.id, 'and it is the open one now');
    const { value: fresh } = await call('get_model');
    eq(fresh.name, 'Agent Scratch Model', 'get_model answers from it');
    eq(Object.keys(fresh['command-definitions']).length, 0, 'and it is empty');
  });

  await check('start_model works with nothing open at all', async () => {
    store.delete('dcb-playground:model');
    const { isError } = await call('start_model', { name: 'From Nothing' });
    eq(isError, false, 'the one tool that needs no open model');
    eq(typeof store.get('dcb-playground:model'), 'string', 'and opens what it made');
  });

  await check('start_model refuses an empty name', async () => {
    const { isError, text } = await call('start_model', { name: '   ' });
    eq(isError, true, 'refused');
    eq(text.includes('must not be empty'), true, 'with the domain\'s words');
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
    const modelId = store.get('dcb-playground:model');
    eq('ProbeHappened' in sandbox.projectState()[modelId]['event-definitions'], false, 'gone again');
    sandbox.redo();
    eq('ProbeHappened' in sandbox.projectState()[modelId]['event-definitions'], true, 'redo puts it back');
  });

  finish();
  // Toast timers set by the tools keep the event loop alive; the tally
  // is printed, so leaving is honest.
  process.exit(0);
})();
