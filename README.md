# DCB Playground

An in-browser modeling tool for designing and testing event-sourced systems
built on [Dynamic Consistency Boundaries](https://dcb.events) (DCB).

You build a _DCB Model_ — custom types, events, entities, projections and
commands — drive commands against a hypothetical event log, and see which
consistency boundary each command derives: which events it has to read, and
which append condition protects its decision.

The playground is hosted at [dcb.events/playground](https://dcb.events/playground/).

## Features

- **Pages and code**: edit a model through forms, or as text in the
  playground's own language in the Code view — both are spellings of the
  same model.
- **Derived boundaries**: every command shows the queries it issues and the
  append condition that results from its rules.
- **Scenarios**: Given / When / Then for commands and projections; a saved
  scenario is flagged when a model change makes its outcome drift.
- **Problems**: dangling references, uncovered tags and other modeling
  issues are reported as advisories — a defective model still loads and runs.
- **Examples** live on [dcb.events](https://dcb.events/examples/), each
  opening its model here through a share link.
- **Import / export** as JSON, validated by
  [`dcb-model.schema.json`](dcb-model.schema.json), or share a model as a
  link — either carrying the model itself (`#model=…`) or pointing to the
  JSON hosted elsewhere, e.g. in a gist (`#url=<address>`; a gist's page
  address works as is).
- **Sandbox logs**: a sandbox run's events export and import on their own,
  as newline-delimited JSON (one `{"type", "data"}` per line).
- **WebMCP**: an in-browser agent can inspect and edit the open model
  through the same commands the UI uses.

## Running locally

There is no build step and nothing to install. Serve the `app/` directory
with any static server, for example:

```
npx serve app
```

Everything runs in the browser; the model and its history are kept in
`localStorage`. WebMCP needs a real origin, so it does not work from
`file:`.

If a scripted handler in a model hangs the page, append `?safe` to the URL
to load the model with scripts disabled.

## Tests

Plain Node, no test runner:

```
node app/evaluate.test.js
node app/ui.test.js
node app/webmcp.test.js
node app/dsl.test.js
```

## Repository layout

- [`app/`](app/) — the application: plain classic scripts, one HTML page,
  one stylesheet. Each file's header comment documents its role.
- [`dcb-model.schema.json`](dcb-model.schema.json) — JSON Schema of the
  model interchange format (`https://dcb.events/schemas/model/v10.json`).
- [`dcb-sandbox.schema.json`](dcb-sandbox.schema.json) — JSON Schema of one
  line of a sandbox log (`*.sandbox.jsonl`, `https://dcb.events/schemas/sandbox/v1.json`).
- [`fixtures/`](fixtures/) — models with authored scenarios, read by the
  tests only.
- [`docs/research/`](docs/research/) — dated notes behind design decisions.
- [`design/`](design/) — artboards from UI explorations; not used by the app.
- [`AGENTS.md`](AGENTS.md) — architecture, conventions and pitfalls in
  depth, written for coding agents and contributors alike.

## Dependencies

None at runtime besides [Monaco](https://microsoft.github.io/monaco-editor/)
(0.52.2), which is vendored under `app/vendor/monaco/` and loaded only when a
scripted handler's editor is shown. A plain textarea is the fallback.

## Contributing

Feedback is welcome — reach us through [dcb.events/about](https://dcb.events/about/).

Bugs and suggestions are tracked in the website's repository: please
[open an issue in dcb-events/dcb-events.github.io](https://github.com/dcb-events/dcb-events.github.io/issues/new?labels=playground&title=%5BPlayground%5D%20)
with the `playground` label.

Pull requests for the playground itself are welcome here, in
[dcb-events/dcb-playground](https://github.com/dcb-events/dcb-playground). Before opening one:

- enable the pre-commit hook once per clone: `git config core.hooksPath .githooks`
- run the four test suites (see [Tests](#tests))
- read the section of [`docs/design-notes.md`](docs/design-notes.md) for the area you are changing

## License

[MIT](LICENSE)
