# By the way

Ask a side question without interrupting the main task or adding messages to its context.

```text
/btw Why did you choose that approach?
/btw What does the error above mean?
/btw
```

With no argument, `/btw` opens a question input. The answer streams in an overlay using the currently selected model and configured authentication.

- **Up/Down, PgUp/PgDn, Home/End:** scroll the answer.
- **Esc or Ctrl+C:** close the overlay and cancel only the side request.
- **Enter:** close after the request finishes.

## Isolation and context

Each invocation takes a detached snapshot of the active branch when the command starts, including recorded system instructions, conversation messages, completed tool results, and the latest compaction summary. The main agent can continue running underneath the overlay. The snapshot does not include unfinished assistant streaming text or tool results that arrive afterward. Pending tool calls are marked as unavailable in the copy only.

The side request exposes no tools and runs no tool loop. It never sends a user/assistant message, appends a session entry, waits for idle, switches branches, changes the selected model, or aborts the main task. Closing the overlay discards the side question and answer; subsequent `/btw` questions take fresh snapshots rather than retaining side-chat history.

This keeps the **main conversation's context window unchanged**, not the provider bill: the side request still sends the snapshot and consumes tokens. Provider-side retention policies still apply. Pi's main-session usage totals do not include this independent request.

The snapshot uses Pi's recorded, compaction-aware context. Other extensions' request-time context transformations and not-yet-recorded prompt changes are not replayed. The side request explicitly applies the shared `../responses-logprobs.ts` gateway compatibility patch via `onPayload`: missing/null `output_text.logprobs` becomes `[]` for `bifrost` and `my-provider` using the Responses API. This changes only the outgoing payload, not saved history.

## Installation

This directory is auto-discovered as `~/.pi/agent/extensions/by-the-way/index.ts`. Run `/reload` or restart Pi to load it. Interactive terminal mode is required.

## Tests

The Bun tests mock the model request, so they need no credentials and make no paid calls. With the Pi packages available in local `node_modules`, run:

```sh
bun test extensions/by-the-way
```

Coverage includes snapshot immutability, system/tool handling, pending results, compaction, execution while the main chain is busy, cancellation isolation, shutdown cleanup, narrow/wide terminal rendering, and logprobs patching through both the main hook and the side request. A real Responses wire-conversion test uses a mocked fetch (no network request).
