// ============================================================
// DCB Playground — the help: what each concept is, and how it is
// written in DCB notation (the code view's language, dsl.js).
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

// `example` names declarations of HELP_MODEL_SOURCE as `keyword:Name`
// (the keyword of their kind, since `type:CourseStatus` and
// `projection:CourseStatus` are two things); `text` is a snippet of its
// own, for the one topic about the text rather than the model.
// `syntax` rows are [spelling, meaning]. `boundaryOf` lists commands
// whose derived queries the topic shows.
const HELP_TOPICS = [
  {
    id: 'notation',
    group: 'The text',
    title: 'DCB notation',
    prose: [
      'The model as text — what the Code view shows and applies. It spells the wire format: '
        + 'every construct is one stored shape, so printing and parsing are each other\'s inverse '
        + 'and nothing is inferred. Applying writes only the difference, as one undo step.',
      'Declarations may come in any order. The printer groups them as types, events, entities, '
        + 'projections and commands, and scenarios sit inside the block of what they exercise. '
        + 'A definition the grammar cannot say exactly is printed as its stored JSON instead, so the '
        + 'text never drops anything.',
    ],
    text: `model "Course Example"

// Comments are for the editor only: the model has nowhere to keep them.
/* Block comments too. */
tag type CourseId = string
`,
    syntax: [
      ['model "Name"', 'The model\'s name. Once per text.'],
      ['// …   /* … */', 'Comments. Not stored.'],
      ['"text"  42  true  null  [ … ]  { key: … }', 'Literals are JSON; object keys may go unquoted.'],
      ['@icon("📚")', 'The mark an entity, event or command is shown with.'],
      ['@feature("Enrolment")', 'The feature a command is listed under.'],
      ['command Foo json { … }', 'Any definition, as its stored JSON.'],
    ],
  },
  {
    id: 'custom-type',
    group: 'Data',
    title: 'Custom types',
    href: 'https://dcb.events/topics/tags/',
    prose: [
      'Named value types. A scalar type marked `tag` is an identifier: every event carrying a value of '
        + 'it is tagged `CourseId:c1`, and those tags are what a read queries by.',
      'Everything else is plain data — a constrained scalar, an enum, or a record of fields. A record '
        + 'has no identity and no tag of its own.',
    ],
    example: ['type:CourseId', 'type:StudentId', 'type:Capacity', 'type:TimeSlot', 'type:CourseStatus',
      'type:PersonName'],
    syntax: [
      ['tag type CourseId = string', 'An identifier, written to events as the tag `CourseId:<value>`.'],
      ['type Capacity = integer { minimum: 1 }', 'A base type, with JSON Schema keywords after it.'],
      ['enum CourseStatus { NonExistent, Existent }', 'String members, written bare wherever the type is known.'],
      ['record PersonName { given: string, … }', 'Fields, each typed with a base or custom type.'],
      ['@tagSchema("{type}={value}")', 'How a tag type spells its tag. The default is `{type}:{value}`.'],
      ['type Point = { …schema… }', 'Any other JSON Schema, whole.'],
    ],
  },
  {
    id: 'event',
    group: 'Data',
    title: 'Events',
    href: 'https://dcb.events/topics/tags/',
    prose: [
      'A fact, named in the past tense, with a payload. Its tags are not declared: they are the values of '
        + 'its `tag`-typed properties, so `StudentSubscribedToCourse` is tagged with its course and its '
        + 'student alike.',
      'Any number of commands may append an event, and any number of projections fold it.',
    ],
    example: ['event:CourseDefined', 'event:CourseCapacityChanged', 'event:CourseArchived',
      'event:CourseRescheduled', 'event:StudentRegistered', 'event:StudentSubscribedToCourse',
      'event:StudentWaitlistedForCourse'],
    syntax: [
      ['courseId: CourseId', 'A property, typed with a base or custom type.'],
      ['email?: string', 'Optional: `null` when unset.'],
      ['slots: TimeSlot[]', 'A list.'],
    ],
  },
  {
    id: 'projection',
    group: 'State',
    title: 'Projections',
    href: 'https://dcb.events/topics/projections/',
    prose: [
      'A fold over the event log: an initial value and, per event type, one operation. Its parameters are '
        + 'its partition — each one a `tag` type — so its query is the events it handles, tagged with the '
        + 'values it is read at.',
      'Without parameters there is one instance, over the whole log: a numbering, say.',
      'The operations are a closed vocabulary because they are analysed, not only run. For a fold they '
        + 'cannot say, [[scripted-projection|script the projection]]; for a value computed from other '
        + 'projections, [[derived-projection|derive it]].',
    ],
    example: ['projection:CourseCapacity', 'projection:CourseSubscriptionCount',
      'projection:CourseSubscribedStudentIds', 'projection:CourseNumbering'],
    syntax: [
      ['projection P(courseId: CourseId): integer = 0', 'Parameters, value type, initial value.'],
      ['…: StudentId[] = []', 'A list value.'],
      ['on E => set v', 'Replace the value.'],
      ['on E => increment 1   decrement 1', 'Integers.'],
      ['on E => append v   remove v', 'Lists.'],
      ['event.data.capacity', 'A value the event carried.'],
      ['successor(event.data.courseId)', 'The value after it: `7` → `8`, `c1` → `c2`, `inv-009` → `inv-010`.'],
    ],
  },
  {
    id: 'entity',
    group: 'State',
    title: 'Entities',
    prose: [
      'A name for the projections kept per one identifier. An entity is not stored, and it is not a '
        + 'consistency boundary: it is what its properties say, read together for one id. Its identifier '
        + 'type is `<Name>Id`, implied when the text does not declare it.',
      'A command [[read|reads]] one instance, `Course[courseId]`, but only the properties its rules, guards '
        + 'and emissions use put events into its query.',
    ],
    example: ['entity:Course'],
    syntax: [
      ['capacity = CourseCapacity', 'A property: a projection partitioned by the identifier.'],
      ['lifecycle status', 'The property holding the instance\'s state: its [[lifecycle]]'],
      ['entity Course[CourseKey] { … }', 'An identifier type not named `<Name>Id`.'],
    ],
  },
  {
    id: 'lifecycle',
    group: 'State',
    title: 'Lifecycles',
    prose: [
      'The property that says which state an instance is in, designated with `lifecycle`. The playground '
        + 'draws the machine from that projection\'s handlers — which event moves it to which state — and '
        + 'from the rules that guard each move.',
      'Two states are a `boolean`: `require student.exists is true` reads as "student exists". Three or '
        + 'more are an enum, like `Course`\'s `status`. An entity needs no lifecycle at all.',
    ],
    example: ['entity:Student', 'projection:StudentExists'],
    syntax: [
      ['lifecycle exists', 'Designates a boolean or enum property of this entity.'],
      ['require student.exists is true', 'An existence rule: "student exists".'],
      ['require course.status in [Draft, Published]', 'A state rule over an enum lifecycle.'],
    ],
  },
  {
    id: 'derived-projection',
    group: 'State',
    title: 'Derived projections',
    prose: [
      'A boolean declared as one predicate over other projections, with no handlers and no initial value. '
        + 'Its query is the union of its operands\' queries.',
      'So reading it reads them: every command that tests `course.isFull` has `CourseCapacityChanged` in '
        + 'its [[consistency-boundary|boundary]], through `CourseCapacity`.',
    ],
    example: ['projection:CourseIsFull'],
    syntax: [
      ['derived A(x) >= B(x)', 'A predicate, spelled as in [[rule|rules]]; its operands are projections at arguments, parameters or literals.'],
    ],
  },
  {
    id: 'scripted-projection',
    group: 'State',
    title: 'Scripted projections',
    prose: [
      'A fold written in JavaScript, for what the operations cannot say. Each handler is an expression over '
        + '`state`, `event` and `args` giving the next state. The query is declared rather than derived: '
        + '`tagFilter` names its tags.',
      'Scripts run unsandboxed in this page. Importing a model that carries one asks first, and `?safe` on '
        + 'the URL loads with every script disabled.',
    ],
    example: ['projection:CoursePeakSubscriptions'],
    syntax: [
      ['script(courseId: CourseId)', 'Arguments the reading command supplies, as `args`. Not tags.'],
      ['tagFilter ["CourseId:{courseId}"]', 'The query\'s tags, ANDed; `{name}` is an argument. `[]` is the whole log.'],
      ['initialState { … }', 'The state before the first event.'],
      ['exposes peak', 'The field of the state rules read. Without it, the state is the value.'],
      ['on E => ```expr```', 'A handler: an expression giving the next state.'],
    ],
  },
  {
    id: 'command',
    group: 'Behaviour',
    title: 'Commands',
    prose: [
      'What someone can do: a payload, the [[read|reads]] it decides on, the [[rule|rules]] that must hold, '
        + 'and the [[emit|events it appends]] — always in that order. Its reads, together, derive the '
        + '[[consistency-boundary|append condition]].',
    ],
    example: ['command:ChangeCourseCapacity', 'command:RegisterStudent'],
    syntax: [
      ['command C(courseId: CourseId, email?: string)', 'The payload: `?` optional, `[]` a list.'],
      ['@feature("Course management")', 'The feature it is listed under.'],
    ],
  },
  {
    id: 'read',
    group: 'Behaviour',
    title: 'Reads',
    prose: [
      'What a command consults, under an alias its rules, guards and emissions refer to. A read names an '
        + 'instance, not what is queried of it: only the properties something uses contribute events.',
      'Reads chain. An identifier may come from an earlier read, and the boundary is then as many queries '
        + 'deep as the chain — `RescheduleCourse` reads the course, then each of its students, then each of '
        + 'their other courses.',
      'On the pages a read is never added by hand: a rule brings the read it needs. In the text it is '
        + 'written out, because the model stores it.',
    ],
    example: ['command:RescheduleCourse', 'command:DefineCourse'],
    syntax: [
      ['read course = Course[courseId]', 'One entity instance, by identifier.'],
      ['read others = Course[student.subscribedCourseIds]', 'Fan-out: one instance per element of a list.'],
      ['… excluding courseId', 'One identifier dropped from a fan-out.'],
      ['read tutor? = Student[tutorId]', 'May be absent: a null identifier binds nothing, and rules over it hold.'],
      ['read numbering = CourseNumbering()', 'A projection, with an argument per parameter.'],
      ['… with (key: value)', 'Arguments for scripted projections read through an entity.'],
    ],
  },
  {
    id: 'rule',
    group: 'Behaviour',
    title: 'Rules',
    prose: [
      'A condition that must hold, or the command is rejected — an ordinary outcome, reported with the '
        + 'rule that refused. Over a fan-out read, a rule must hold for every instance.',
      'Operands are payload properties (`studentId`), read properties (`course.status`), literals and enum '
        + 'members.',
    ],
    example: ['command:SubscribeStudentToCourse'],
    syntax: [
      ['a == b   a != b   <   <=   >   >=', 'Comparison.'],
      ['x in [Draft, Published]   x not in […]', 'One of a list of literals.'],
      ['xs contains x   x in xs   xs containsAny ys', 'List membership; `x in xs` is read as `xs contains x`.'],
      ['s startsWith "c"   s endsWith "1"', 'Strings.'],
      ['count(xs) < 10   ==   >', 'A list\'s length.'],
      ['x is empty   x is not empty', 'An empty string or list, or `null`.'],
      ['b is true   b is false', 'Booleans, and existence for a two-state [[lifecycle]]'],
      ['not a < b   xs not contains x', 'Negation.'],
    ],
  },
  {
    id: 'emit',
    group: 'Behaviour',
    title: 'Append',
    prose: [
      'The events a command appends when its rules hold, each field taken from the payload or a read. A field '
        + 'with the name of the payload property it takes is written once.',
      'An emission may be guarded. A failing `when` skips that event instead of rejecting the command; if '
        + 'every guard fails, nothing is appended and the command still succeeds. Guards read like rules and '
        + 'count toward the boundary like rules.',
    ],
    example: ['command:SubscribeStudentToCourse'],
    syntax: [
      ['emit E { courseId, capacity }', 'Fields taken from the payload properties of the same name.'],
      ['emit E { courseId: numbering }', 'A field taken from a read, or any other operand.'],
      ['  when a and b', 'A guard: the event is appended only if all of these hold.'],
    ],
  },
  {
    id: 'consistency-boundary',
    group: 'Behaviour',
    title: 'Consistency boundary',
    prose: [
      'Never written: derived from a command\'s reads. Each read contributes one query — the event types its '
        + 'used properties\' projections handle, under its tag — and the append succeeds only if no event '
        + 'matching any of them was appended since the command read.',
      'So two commands conflict exactly when one appends what the other\'s query matches. Here, '
        + '`ChangeCourseCapacity` fails if a course is archived under it, since it reads `course.status`; '
        + '`ArchiveCourse` does not mind a capacity change, since it reads nothing a capacity changes.',
      'The Code view says this beside each command, and the Consistency boundary step of a command page '
        + 'lists the queries.',
    ],
    boundaryOf: ['ArchiveCourse', 'ChangeCourseCapacity', 'SubscribeStudentToCourse', 'RescheduleCourse'],
  },
  {
    id: 'scenario',
    group: 'Behaviour',
    title: 'Scenarios',
    prose: [
      'Examples that pin behaviour down, inside the block of the command or projection they exercise. A '
        + 'command scenario has Given events, a When, and a Then: the events appended, `nothing`, or the '
        + 'rule that rejected it and the values it saw. A projection scenario has Given events and the value '
        + 'the projection folds them to.',
      'A written Then is an assertion. Leave it out and applying records what the model does. A Then the '
        + 'model no longer agrees with is reported, with a fix that accepts the new outcome — applying never '
        + 'accepts it for you.',
    ],
    example: ['command:ArchiveCourse', 'projection:CourseStatus'],
    syntax: [
      ['scenario "name" { … }', 'The name is optional.'],
      ['given E { courseId: "c1" }', 'An event already in the log. Values are JSON, enum members bare.'],
      ['when C { … }', 'The command, with every payload property.'],
      ['then E { … }   then nothing', 'What was appended.'],
      ['then rejected by <rule> saw L, R', 'The refusal; `saw` is optional, `at "c2"` names a fan-out\'s instance.'],
      ['then P("c1") == Existent', 'A projection\'s value at arguments, in declared order.'],
    ],
  },
  {
    id: 'example',
    group: 'Example',
    title: 'The whole example',
    prose: [
      'Every snippet above is cut from this one model. It applies cleanly: no problems, and every scenario '
        + 'holds.',
    ],
    whole: true,
  },
];

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
  if (topic.whole) return HELP_MODEL_SOURCE.replace(/\n$/, '');
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
