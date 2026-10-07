# AI Workforce — the asynchronous execution contract (Step 4)

## Why this exists

`AgentRuntime.submitJob` was written in Phase 2A for a runtime that decides an
outcome synchronously. The real Hermes run does not work that way: the bridge
mints a run, exposes its own `status` / `stream` / `cancel` routes, and ends the
run on its own schedule. Step 3 proved both halves of that seam:

- the run **is** addressable while it is alive (`GET /v1/runs/<runId>`), and
- `submitJob` returns only after the terminal frame, so an in-flight cancel was
  reachable only by calling the transport by hand.

Step 4 closes that gap at the port, not in a provider adapter.

## The contract

Provider-neutral, in `src/modules/workforce/runtimes/agent-runtime.ts`. No
Hermes word appears in any of it.

```
startJob(submission)            → handle (ACCEPTED/RUNNING, usable immediately)
getExecutionStatus(handleId)    → handle (during AND after the execution)
getExecution(handleId)          → AgentExecutionRecord | null (full, structured)
executionEvents(handleId)       → AgentExecutionEvent[] (ordered, per execution)
waitForExecution(handleId, o?)  → AgentExecutionRecord (terminal)
cancelJob(handleId, reason?)    → handle (CANCELLED; reachable in flight)
submitJob(request)              → handle (fused: start + wait; kept for callers
                                  that cannot hold a handle)
```

`AsyncAgentRuntime extends AgentRuntime` with the four new methods, and
`isAsyncAgentRuntime()` is the runtime-checked way to ask for them — so a
runtime that only implements the blocking port keeps compiling and keeps
working, and no caller has to `instanceof` a provider class.

### The handle is the runtime's execution reference

`handleId` is the id **the runtime's own control routes accept**. On the bridge
that is the bridge's `run_…` id. The provider's private session reference
travels separately as `AgentExecutionRecord.providerExecutionId` — reported for
audit, never used as a handle. (Step 3 measured the cost of getting this
backwards: `GET /v1/runs/<session>` → 404 `RUN_NOT_FOUND`.)

### Idempotency

`AgentJobSubmission` adds an optional `idempotencyKey`. Semantics:

1. The key is scoped to one runtime instance.
2. A second `startJob` with a key this runtime has already accepted returns the
   **same handle** and creates **no second real run**; the record is marked
   `replayed: true`.
3. When no key is given, the runtime derives one from `jobId` when present
   (`job:<jobId>`), because a retried dispatch of the same job is by definition
   the same execution. With neither field, each submission is a new run.
4. A replay is deliberately NOT "retryable": the key is kept for the runtime's
   lifetime, so a retried submit after a failure returns the SAME record with
   `replayed: true` rather than starting a second real run — the safe reading,
   because a timed-out run may still be alive on the provider. To attempt a
   genuinely NEW execution, pass a new `idempotencyKey` (or none plus no
   `jobId`); that intent is then explicit in the audit trail instead of implied
   by a retry.

### Terminal states and the first-terminal-wins rule

`SUCCEEDED | FAILED | CANCELLED` are terminal. A background completion never
overwrites a handle that is already terminal: a run that was cancelled must not
be reported SUCCEEDED moments later because the provider's stream finished at
the same time. `UNKNOWN` is not terminal — an adapter says "I do not recognise
this state" and keeps observing.

### Timeout semantics — two different timeouts, never conflated

| Timeout | Where | Outcome |
|---|---|---|
| transport/provider timeout | inside the transport | terminal `FAILED`, category `TIMEOUT`, `retryable: true` |
| wait timeout (`waitForExecution`) | at the caller | throws `RUNTIME_TIMEOUT`; the execution is **not** cancelled and can still be observed or cancelled |

### Cancellation semantics

`cancelJob` asks the provider and reports what the provider answers. Cancelling
an already-terminal handle is idempotent (it returns the handle, it does not
throw). Cancelling an unknown handle is `RUN_NOT_FOUND`. A runtime that cannot
cancel at all throws `NOT_IMPLEMENTED` rather than pretending — `supports()`
tells a caller beforehand.

### Error vocabulary

`AgentExecutionErrorCategory` is neutral: `NONE | INVALID_REQUEST | TRANSPORT |
TIMEOUT | BLOCKED | UNSUPPORTED | MALFORMED_OUTPUT | RUNTIME_ERROR`. The Hermes
adapter's richer category (`HTTP`) maps into it, so the generic record never
grows a provider field.

## Coverage map — what each existing piece covers, and what was missing

| Piece | Covered | Missing before Step 4 |
|---|---|---|
| `AgentRuntime.submitJob` | submit → terminal result | returns only after completion; the caller never holds a live handle |
| `AgentRuntime.getExecutionStatus` | a status read after completion | no in-flight answer; `NOT_IMPLEMENTED` when the capability is off even if the runtime already knows the state |
| `AgentRuntime.cancelJob` | a cancel request (with the bridge's real run id, after Step 3) | unreachable in flight through the port, because the handle only existed once the run had ended |
| `HermesRuntimeAdapter.records/handles` | local memory of an execution | written once, at terminal; no background lifecycle, no per-execution events, no idempotency |
| `HermesRuntimeAdapter.emit*` | a push-only event sink | nothing to read per execution |
| `HermesBridgeTransport.consumeRun` | stream → terminal raw result | it *is* the blocking wait; the run id is only attached at the terminal frame |
| `DeterministicHermesTransport` | canned submit/status/cancel | no non-blocking start, no per-run state (so an in-flight cancel is unrepresentable offline) |
| `DeterministicRuntimeAdapter` | the blocking port | no async lifecycle, no idempotency, no events |
| `RuntimeRegistry` | provider-neutral lookup; `null` for humans | complete for its role |
| `AgentRuntimeDispatcher` | actor/registry resolution → submit | it awaited the terminal result and had no way to observe, wait or cancel; it did not check that the capability was **assigned** to the actor, or that the runtime is the actor's binding |
| `HermesExecutionRecord` | provider metadata incl. `providerExecutionId` | Hermes-named, not a core type |

## What Step 4 adds, in one line each

- `agent-runtime.ts` — the async port above, `AgentExecutionRecord`,
  `AgentExecutionEvent`, idempotency-key derivation, `RUNTIME_TIMEOUT`.
- `deterministic-runtime-adapter.ts` — satisfies the async port (immediate
  completion is the degenerate case), with idempotency + events.
- `hermes-transport.ts` / `hermes-transports.ts` / `hermes-bridge-transport.ts` —
  an optional non-blocking `startRun` on the transport port; the bridge starts a
  run, returns its id immediately, and consumes the stream in the background.
- `hermes-runtime-adapter.ts` — in-flight handle from `startRun`, background
  completion with first-terminal-wins, per-execution events, `waitForExecution`,
  in-flight `cancelJob`, submit idempotency.
- `agent-runtime-dispatcher.ts` — refuses an unassigned capability and a runtime
  that is not the actor's binding, and forwards `start/wait/status/cancel`.
