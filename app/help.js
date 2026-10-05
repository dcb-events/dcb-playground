// ============================================================
// DCB Playground — the help: what each concept is, and how it is
// written in DCB notation (the code view's language, dsl.js).
//
// The short version, in place: the notation is explained in full on
// dcb.events, and every topic and syntax row links there.
//
// Data, no DOM. The modal in index.html renders it; a page that wants
// to say "this is explained over there" opens it at a topic
// (`openHelp(id)`), which is why every topic has a stable id and
// `helpTopicFor` maps a definition to its topic.
//
// **One example model, cut into excerpts.** Every snippet the help
// shows is a slice of `HELP_MODEL_SOURCE`, taken by declaration
// (`helpExcerpt`, through the parser's spans), never a second copy of
// it. So the snippets cannot contradict each other, and the tests hold
// the whole model to what a shipped one is held to: it parses, prints
// back exactly as written (so every snippet is the canonical spelling),
// applies with no advisory, and its scenarios hold. A help text whose
// example the parser rejects would teach the wrong language — that is
// the drift this arrangement rules out.
//
// The consistency-boundary topic has no snippet of its own on purpose:
// a boundary is never written. It shows what the example's commands
// derive, computed from the same text when the modal opens.
//
// Prose is technical, like the interface: `code` in backticks, and
// [[topic]] or [[topic|words]] for a link to another topic.
// ============================================================

const HELP_MODEL_SOURCE = `model "Course Example"

// Types
tag type CourseId = string { pattern: "^c[0-9]+$" }
tag type StudentId = string
type Capacity = integer { minimum: 1 }
type TimeSlot = string { pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$" }
enum CourseStatus { NonExistent, Existent, Archived }
record PersonName { given: string, family: string }

// Events
event CourseDefined { courseId: CourseId, capacity: Capacity }
event CourseCapacityChanged { courseId: CourseId, newCapacity: Capacity }
event CourseArchived { courseId: CourseId }
event CourseRescheduled { courseId: CourseId, slots: TimeSlot[] }
event StudentRegistered { studentId: StudentId, name: PersonName, email?: string }
event StudentSubscribedToCourse { courseId: CourseId, studentId: StudentId }
event StudentWaitlistedForCourse { courseId: CourseId, studentId: StudentId }

// Entities
@icon("📚")
entity Course {
  lifecycle status
  status = CourseStatus
  capacity = CourseCapacity
  subscriptionCount = CourseSubscriptionCount
  subscribedStudentIds = CourseSubscribedStudentIds
  slots = CourseSlots
  isFull = CourseIsFull
}

@icon("🧑‍🎓")
entity Student {
  lifecycle exists
  exists = StudentExists
  subscribedCourseIds = StudentSubscribedCourseIds
}

// Projections
projection CourseStatus(courseId: CourseId): CourseStatus = NonExistent {
  on CourseDefined => set Existent
  on CourseArchived => set Archived

  scenario "a defined course exists" {
    given CourseDefined { courseId: "c1", capacity: 10 }
    then CourseStatus("c1") == Existent
  }
}

projection StudentExists(studentId: StudentId): boolean = false {
  on StudentRegistered => set true
}

projection CourseCapacity(courseId: CourseId): integer = 0 {
  on CourseDefined => set event.data.capacity
  on CourseCapacityChanged => set event.data.newCapacity
}

projection CourseSubscriptionCount(courseId: CourseId): integer = 0 {
  on StudentSubscribedToCourse => increment 1
}

projection CourseSubscribedStudentIds(courseId: CourseId): StudentId[] = [] {
  on StudentSubscribedToCourse => append event.data.studentId
}

projection StudentSubscribedCourseIds(studentId: StudentId): CourseId[] = [] {
  on StudentSubscribedToCourse => append event.data.courseId
}

projection CourseSlots(courseId: CourseId): TimeSlot[] = [] {
  on CourseRescheduled => set event.data.slots
}

projection CourseNumbering: CourseId = "c1" {
  on CourseDefined => set successor(event.data.courseId)
}

projection CourseIsFull(courseId: CourseId): boolean
  derived CourseSubscriptionCount(courseId) >= CourseCapacity(courseId)

projection CoursePeakSubscriptions: integer {
  script(courseId: CourseId)
  tagFilter ["CourseId:{courseId}"]
  initialState { current: 0, peak: 0 }
  exposes peak
  on StudentSubscribedToCourse => \`\`\`({ current: state.current + 1, peak: Math.max(state.peak, state.current + 1) })\`\`\`
}

// Commands
@feature("Course management")
command DefineCourse(capacity: Capacity) {
  read numbering = CourseNumbering()

  emit CourseDefined { courseId: numbering, capacity }
}

@feature("Course management")
command ChangeCourseCapacity(courseId: CourseId, newCapacity: Capacity) {
  read course = Course[courseId]

  require course.status == Existent
  require course.subscriptionCount <= newCapacity

  emit CourseCapacityChanged { courseId, newCapacity }
}

@feature("Course management")
command ArchiveCourse(courseId: CourseId) {
  read course = Course[courseId]

  require course.status == Existent

  emit CourseArchived { courseId }

  scenario "an archived course cannot be archived again" {
    given CourseDefined { courseId: "c1", capacity: 10 }
    given CourseArchived { courseId: "c1" }
    when ArchiveCourse { courseId: "c1" }
    then rejected by course.status == Existent saw Archived, Existent
  }

  scenario "an existing course is archived" {
    given CourseDefined { courseId: "c1", capacity: 10 }
    when ArchiveCourse { courseId: "c1" }
    then CourseArchived { courseId: "c1" }
  }
}

@feature("Course management")
command RescheduleCourse(courseId: CourseId, slots: TimeSlot[]) {
  read course = Course[courseId]
  read students = Student[course.subscribedStudentIds]
  read theirs = Course[students.subscribedCourseIds] excluding courseId

  require course.status == Existent
  require theirs.slots not containsAny slots

  emit CourseRescheduled { courseId, slots }
}

@feature("Students")
command RegisterStudent(studentId: StudentId, name: PersonName, email?: string) {
  read student = Student[studentId]

  require student.exists is false

  emit StudentRegistered { studentId, name, email }
}

@feature("Enrolment")
command SubscribeStudentToCourse(courseId: CourseId, studentId: StudentId) {
  read course = Course[courseId]
  read student = Student[studentId]

  require course.status == Existent
  require student.exists is true
  require course.subscribedStudentIds not contains studentId
  require count(student.subscribedCourseIds) < 10

  emit StudentSubscribedToCourse { courseId, studentId }
    when course.isFull is false
  emit StudentWaitlistedForCourse { courseId, studentId }
    when course.isFull is true
}
`;

// The notation is explained on dcb.events: a guide that introduces it
// and a reference with one entry per keyword. The help is the short
// version of the reference, in place — every topic links its entry and
// every syntax row the entry that spells it out. The anchors are the
// reference's explicit ids, and the site's build fails on a link to one
// it does not define (`helpReferenceLinks`).
const NOTATION_GUIDE_URL = 'https://dcb.events/notation/';
const NOTATION_REFERENCE_URL = 'https://dcb.events/notation/reference/';
const notationReference = (anchor) => NOTATION_REFERENCE_URL + '#' + anchor;

// `example` names declarations of HELP_MODEL_SOURCE as `keyword:Name`
// (the keyword of their kind, since `type:CourseStatus` and
// `projection:CourseStatus` are two things); `text` is a snippet of its
// own, for the one topic about the text rather than the model.
// `syntax` rows are [spelling, meaning, reference anchor]. `href` is
// where the topic is explained in full. `boundaryOf` lists commands
// whose derived queries the topic shows.
const HELP_TOPICS = [
  {
    id: 'notation',
    group: 'The text',
    title: 'DCB notation',
    href: NOTATION_GUIDE_URL,
    hrefLabel: 'Guide ↗',
    prose: [
      'The model as text — what the Code view shows and applies. Every construct is one stored shape, '
        + 'so nothing is inferred; declarations may come in any order, and scenarios sit in the block of '
        + 'what they exercise.',
    ],
    text: `model "Course Example"

// Comments are for the editor only: the model has nowhere to keep them.
tag type CourseId = string
`,
    syntax: [
      ['model "Name"', 'The model\'s name. Once per text.', 'model'],
      ['// …   /* … */', 'Comments. Not stored.', 'comments'],
      ['"text"  42  true  null  [ … ]  { key: … }', 'Literals are JSON; object keys may go unquoted.', 'literals'],
      ['@icon("📚")   @feature("Enrolment")', 'How the pages show an entity, event or command.', 'annotations'],
      ['command Foo json { … }', 'A definition the grammar cannot say, as its stored JSON.', 'json'],
    ],
  },
  {
    id: 'custom-type',
    group: 'Data',
    title: 'Custom types',
    href: notationReference('tag-type'),
    prose: [
      'Named value types. A `tag` type is an identifier: every event carrying a value of it is tagged '
        + '`CourseId:c1`, and those tags are what a read queries by.',
    ],
    example: ['type:CourseId', 'type:Capacity', 'type:CourseStatus', 'type:PersonName'],
    syntax: [
      ['tag type CourseId = string', 'An identifier, written to events as the tag `CourseId:<value>`.', 'tag-type'],
      ['type Capacity = integer { minimum: 1 }', 'A base type, with JSON Schema keywords after it.', 'type'],
      ['enum CourseStatus { NonExistent, Existent }', 'String members, written bare wherever the type is known.', 'enum'],
      ['record PersonName { given: string, … }', 'Fields, each typed with a base or custom type.', 'record'],
      ['@tagSchema("{type}={value}")', 'How a tag type spells its tag. The default is `{type}:{value}`.', 'tag-type'],
      ['type Point = { …schema… }', 'Any other JSON Schema, whole.', 'type'],
    ],
  },
  {
    id: 'event',
    group: 'Data',
    title: 'Events',
    href: notationReference('event'),
    prose: [
      'A fact, named in the past tense, with a payload. Its tags are not declared: they are the values of '
        + 'its `tag`-typed properties.',
    ],
    example: ['event:CourseDefined', 'event:StudentRegistered'],
    syntax: [
      ['courseId: CourseId', 'A property, typed with a base or custom type.', 'event'],
      ['email?: string', 'Optional: `null` when unset.', 'event'],
      ['slots: TimeSlot[]', 'A list.', 'event'],
    ],
  },
  {
    id: 'projection',
    group: 'State',
    title: 'Projections',
    href: notationReference('projection'),
    prose: [
      'A fold over the event log: an initial value and, per event type, one operation. Its parameters are '
        + 'tag types — its partition — and without any there is one instance over the whole log.',
    ],
    example: ['projection:CourseCapacity'],
    syntax: [
      ['projection P(courseId: CourseId): integer = 0', 'Parameters, value type, initial value.', 'projection'],
      ['on E => set v', 'Replace the value.', 'on'],
      ['on E => increment 1   decrement 1', 'Integers.', 'on'],
      ['on E => append v   remove v', 'Lists.', 'on'],
      ['event.data.capacity', 'A value the event carried.', 'event-data'],
      ['successor(event.data.courseId)', 'The value after it: `7` → `8`, `c1` → `c2`, `inv-009` → `inv-010`.', 'successor'],
      ['currentValue', 'The projection\'s own value before the event.', 'current-value'],
    ],
  },
  {
    id: 'entity',
    group: 'State',
    title: 'Entities',
    href: notationReference('entity'),
    prose: [
      'A name for projections that share an identity. Not stored, and not a consistency boundary: only '
        + 'the properties a command uses put events into its query.',
    ],
    example: ['entity:Course'],
    syntax: [
      ['capacity = CourseCapacity', 'A property: a projection partitioned by the identifier.', 'entity'],
      ['lifecycle status', 'The property holding the instance\'s state: its [[lifecycle]]', 'lifecycle'],
      ['entity Course[CourseKey] { … }', 'An identifier type not named `<Name>Id`.', 'entity'],
    ],
  },
  {
    id: 'lifecycle',
    group: 'State',
    title: 'Lifecycles',
    href: notationReference('lifecycle'),
    prose: [
      'The property that says which state an instance is in: a `boolean` for two states, an enum for '
        + 'more. The playground draws the machine from its handlers and the rules that guard each move.',
    ],
    example: ['entity:Student', 'projection:StudentExists'],
    syntax: [
      ['lifecycle exists', 'Designates a boolean or enum property of this entity.', 'lifecycle'],
      ['require student.exists is true', 'An existence rule: "student exists".', 'lifecycle'],
      ['require course.status in [Draft, Published]', 'A state rule over an enum lifecycle.', 'require'],
    ],
  },
  {
    id: 'derived-projection',
    group: 'State',
    title: 'Derived projections',
    href: notationReference('derived'),
    prose: [
      'A boolean declared as one predicate over other projections. Its query is the union of its operands\' '
        + 'queries, so reading it reads them.',
    ],
    example: ['projection:CourseIsFull'],
    syntax: [
      ['derived A(x) >= B(x)', 'A predicate, spelled as in [[rule|rules]].', 'derived'],
    ],
  },
  {
    id: 'scripted-projection',
    group: 'State',
    title: 'Scripted projections',
    href: notationReference('script'),
    prose: [
      'A fold written in JavaScript, for what the operations cannot say; its query is declared, not derived. '
        + 'Scripts run unsandboxed: importing one asks first, and `?safe` on the URL disables them.',
    ],
    example: ['projection:CoursePeakSubscriptions'],
    syntax: [
      ['script(courseId: CourseId)', 'Arguments the reading command supplies, as `args`. Not tags.', 'script'],
      ['tagFilter ["CourseId:{courseId}"]', 'The query\'s tags, ANDed; `{name}` is an argument. `[]` is the whole log.', 'script'],
      ['initialState { … }', 'The state before the first event.', 'script'],
      ['exposes peak', 'The field of the state rules read. Without it, the state is the value.', 'script'],
      ['on E => ```expr```', 'A handler: an expression over `state`, `event` and `args` giving the next state.', 'script'],
    ],
  },
  {
    id: 'command',
    group: 'Behaviour',
    title: 'Commands',
    href: notationReference('command'),
    prose: [
      'What someone can do: a payload, then its [[read|reads]], [[rule|rules]] and [[emit|appends]], in '
        + 'that order. Its reads derive its [[consistency-boundary|append condition]].',
    ],
    example: ['command:ChangeCourseCapacity'],
    syntax: [
      ['command C(courseId: CourseId, email?: string)', 'The payload: `?` optional, `[]` a list.', 'command'],
      ['@feature("Course management")', 'The feature it is listed under.', 'annotations'],
    ],
  },
  {
    id: 'read',
    group: 'Behaviour',
    title: 'Reads',
    href: notationReference('read'),
    prose: [
      'What a command consults, under an alias. Only the properties something uses contribute events, and '
        + 'reads chain: the boundary is then as many queries deep as the chain.',
    ],
    example: ['command:RescheduleCourse'],
    syntax: [
      ['read numbering = CourseNumbering()', 'A projection, with an argument per parameter.', 'read'],
      ['read course = Course[courseId]', 'One entity instance, by identifier.', 'read-entity'],
      ['read others = Course[student.subscribedCourseIds]', 'Fan-out: one instance per element of a list.', 'fan-out'],
      ['… excluding courseId', 'One identifier dropped from a fan-out.', 'fan-out'],
      ['read tutor? = Student[tutorId]', 'May be absent: a null identifier binds nothing, and rules over it hold.', 'optional-read'],
      ['… with (key: value)', 'Arguments for scripted projections read through an entity.', 'with'],
    ],
  },
  {
    id: 'rule',
    group: 'Behaviour',
    title: 'Rules',
    href: notationReference('require'),
    prose: [
      'A condition that must hold, or the command is rejected. Over a fan-out read, it must hold for every '
        + 'instance.',
    ],
    example: ['command:SubscribeStudentToCourse'],
    syntax: [
      ['a == b   a != b   <   <=   >   >=', 'Comparison.', 'require'],
      ['x in [Draft, Published]   x not in […]', 'One of a list of literals.', 'require'],
      ['xs contains x   xs containsAny ys', 'List membership.', 'require'],
      ['s startsWith "c"   s endsWith "1"', 'Strings.', 'require'],
      ['count(xs) < 10   ==   >', 'A list\'s length.', 'require'],
      ['x is empty   x is not empty', 'An empty string or list, or `null`.', 'require'],
      ['b is true   b is false', 'Booleans, and existence for a two-state [[lifecycle]]', 'require'],
      ['not a < b   xs not contains x', 'Negation.', 'require'],
    ],
  },
  {
    id: 'emit',
    group: 'Behaviour',
    title: 'Append',
    href: notationReference('emit'),
    prose: [
      'The events a command appends when its rules hold. A guarded one is skipped when its `when` fails, '
        + 'without rejecting the command.',
    ],
    example: ['command:DefineCourse'],
    syntax: [
      ['emit E { courseId, capacity }', 'Fields taken from the payload properties of the same name.', 'emit'],
      ['emit E { courseId: numbering }', 'A field taken from a read, or any other operand.', 'emit'],
      ['  when a and b', 'A guard: the event is appended only if all of these hold.', 'emit-when'],
    ],
  },
  {
    id: 'consistency-boundary',
    group: 'Behaviour',
    title: 'Consistency boundary',
    href: notationReference('consistency-boundary'),
    prose: [
      'Never written: derived from a command\'s reads. Each read contributes the event types its used '
        + 'properties\' projections handle, under its tag, and the append fails if a matching event was '
        + 'appended since the command read.',
      'Here, `ChangeCourseCapacity` fails if the course is archived under it, since it reads `course.status`; '
        + '`ArchiveCourse` does not mind a capacity change.',
    ],
    boundaryOf: ['ArchiveCourse', 'ChangeCourseCapacity', 'SubscribeStudentToCourse', 'RescheduleCourse'],
  },
  {
    id: 'scenario',
    group: 'Behaviour',
    title: 'Scenarios',
    href: notationReference('scenario'),
    prose: [
      'Examples that pin behaviour down, inside the block of what they exercise. Leave the Then out and '
        + 'applying records what the model does; a Then it no longer agrees with is reported, with a fix.',
    ],
    example: ['command:ArchiveCourse'],
    syntax: [
      ['scenario "name" { … }', 'The name is optional.', 'scenario'],
      ['given E { courseId: "c1" }', 'An event already in the log. Values are JSON, enum members bare.', 'scenario'],
      ['when C { … }', 'The command, with every payload property.', 'scenario'],
      ['then E { … }   then nothing', 'What was appended.', 'scenario'],
      ['then rejected by <rule> saw L, R', 'The refusal; `saw` is optional, `at 1` names a fan-out\'s instance by position.', 'saw'],
      ['then P("c1") == Existent', 'A projection\'s value at arguments, in declared order.', 'projection-scenario'],
    ],
  },
];

// Every page of dcb.events the help links to, with its anchor: what the
// site's build checks against the pages it has just built.
function helpReferenceLinks() {
  const links = new Set();
  for (const topic of HELP_TOPICS) {
    if (topic.href) links.add(topic.href);
    for (const [, , anchor] of topic.syntax || []) links.add(notationReference(anchor));
  }
  return [...links];
}

// Which topic explains a definition. The body decides between the
// three kinds of projection; the rest are one topic per kind.
function helpTopicFor(kind, body) {
  if (kind === 'projection-definition' && body) {
    if (body.script) return 'scripted-projection';
    if (body.derived) return 'derived-projection';
  }
  return {
    'custom-type-definition': 'custom-type',
    'event-definition': 'event',
    'entity-definition': 'entity',
    'projection-definition': 'projection',
    'command-definition': 'command',
    'scenario-definition': 'scenario',
    'projection-scenario-definition': 'scenario',
  }[kind] || null;
}

function helpTopic(id) {
  return HELP_TOPICS.find((topic) => topic.id === id) || null;
}

let helpParsedCache = null;
function helpParsed() {
  if (!helpParsedCache) helpParsedCache = parseModelSource(HELP_MODEL_SOURCE);
  return helpParsedCache;
}

// A topic's snippet: the declarations it names, each exactly as the
// example model has it (annotations and nested scenarios included),
// spaced the way the printer spaces them — one-liners together, a
// blank line around anything longer.
function helpExcerpt(topic) {
  if (topic.text) return topic.text.replace(/\n$/, '');
  if (!topic.example) return null;
  const lines = HELP_MODEL_SOURCE.split('\n');
  const parsed = helpParsed();
  const kinds = Object.fromEntries(Object.entries(SOURCE_KEYWORD).map(([kind, word]) => [word, kind]));
  const out = [];
  let previousWasLine = false;
  for (const ref of topic.example) {
    const [word, name] = ref.split(':');
    const span = sourceSpanOf(parsed, kinds[word], name);
    if (!span) throw new Error(`The help names ${ref}, which the example model does not declare.`);
    const text = lines.slice(span.line - 1, span.endLine).join('\n');
    const oneLine = !text.includes('\n');
    if (out.length && !(oneLine && previousWasLine)) out.push('');
    out.push(text);
    previousWasLine = oneLine;
  }
  return out.join('\n');
}

// What the boundary topic shows: each named command's derived queries,
// from the example model as the text states it — the same
// `boundarySummary` the Code view and the command page speak from.
function helpBoundaries(topic) {
  const parsed = helpParsed();
  const draft = sourceDraftModel(emptyModel('help', parsed.name), parsed);
  return (topic.boundaryOf || []).map((name) => {
    const body = draft['command-definitions'][name];
    return { command: name, ...boundarySummary(draft, body) };
  });
}

// Prose as runs: plain text, `code`, and [[topic|words]] links.
function helpRuns(text) {
  const runs = [];
  const re = /`([^`]+)`|\[\[([a-z-]+)(?:\|([^\]]+))?\]\]/g;
  let at = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    if (match[1] !== undefined) runs.push({ code: match[1] });
    else {
      const target = helpTopic(match[2]);
      runs.push({ link: match[2], text: match[3] || (target ? target.title.toLowerCase() : match[2]) });
    }
    at = re.lastIndex;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}
