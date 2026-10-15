# A DCB Model as an executable

2026-10-15. Background for the read port in `app/evaluate.js` and for
the separate `dcb-runtime` experiment.

## Question

Can a DCB Model run outside the playground – on many platforms, with
ports to connect it to a DCB-compatible event store and to send it
commands? Should that be a compiler of the notation, or something the
website could do, and is WebAssembly a target?

## Decision

- **Interpret, don't generate.** The runtime ships `model.js` and
  `evaluate.js` as they are and takes the model as data (the JSON
  envelope). Generated code per target would be a further copy of the
  semantics, the one `evaluate.js` already declines to emit. One
  generic runtime serves every model, so there is no per-model compile
  step and the website needs nothing new: its export is the input.
- **A WebAssembly component** built with ComponentizeJS
  (StarlingMonkey), described by a WIT world:
  - exports `init(modelJson)` – refusing a major outside
    `READABLE_MAJORS` and what fails the structural gate, never an
    advisory – and `handle(commandName, argsJson)` returning
    `published { events, position } | rejected { rejection, ruleIndex }
    | conflict | error { message }`;
  - imports `store { head, read(query), append(events, condition) }`,
    synchronous. Payloads cross as JSON strings; only the envelope
    (event, query, position) is typed.
- **The store is the host's.** A component has no sockets and gRPC
  over wasi:http is unreliable, so the host implements `store` with a
  native client. First host: Rust + wasmtime + the UmaDB sync client.
  Second host, for conformance: Node via `jco transpile` over an
  in-memory store, running every command scenario against
  `runScenario`.
- **The decision cycle.**
  - One read round: `read(query)` → evaluate → `pos` = last position
    read → `append(events, failIfEventsMatch: query, after: pos)`.
  - Chained rounds: `head` → `pos` → reads 1…n → evaluate →
    `append(events, failIfEventsMatch: all reads ORed, after: pos)`.
    An event landing after `head` that a read sees fails the append
    and retries – safe, no capping needed.
  - An empty store has no position; `after` is left out.
  - A conflict reruns the whole cycle, up to N times (default 3), no
    backoff; scripted handlers re-run, which the schema's purity
    contract allows.
- **Event mapping.** `type` is the event name, `data` the payload as
  JSON, `tags` what `tagsOfEvent` derives. No metadata.
- **Out of scope for now.** A query port for projections,
  idempotency through the event `uuid`, debug detail in results,
  splitting `model.js`, embedding the model at build time.

## Findings

- **The DCB specification** defines `read(query)` and
  `append(events, { failIfEventsMatch, after? })`; it has no head
  position for a read that matches nothing.
  <https://dcb.events/specification/>
- **UmaDB** speaks gRPC only (`umadb.v1.DCB`: `Append`, `Read`,
  `Subscribe`, `Head`). `Head` returns an optional position, absent on
  an empty store; `ReadResponse` carries `head` too. A failed
  condition is `FAILED_PRECONDITION` / `INTEGRITY`. Clients: Rust
  (sync and async), Python, .NET, Java, PHP, Elixir – no JavaScript.
  <https://umadb.io/grpc-api.html>,
  <https://github.com/umadb-io/umadb/blob/main/umadb-proto/proto/v1/umadb.proto>
- **ComponentizeJS** produces a real component from a WIT world;
  imports are synchronous only; `fetch` via wasi:http, no sockets;
  self-described as experimental (0.23.0, 2026-09). Checked here:
  `new Function` at call time works, a synchronous host import works,
  a syntax error in a script surfaces as an ordinary error, and the
  component is about 12 MB.
  <https://github.com/bytecodealliance/ComponentizeJS>
- **Javy** (QuickJS) has `eval` on by default and is small (~0.9 MB,
  or a few KB dynamically linked), but emits a WASI preview-1 core
  module, not a component: no typed contract, and every host would
  hand-roll the import ABI. The fallback had `new Function` failed.
  <https://github.com/bytecodealliance/javy>

## What changed in the playground

`evaluateCommand` and the folds accept a read port wherever they took
a log – see _The read port_ in `docs/design-notes.md`.
