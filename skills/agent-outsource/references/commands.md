# Command payloads

All commands use `node <skill>/scripts/bridge.mjs <command> <request.json>`; request files are UTF-8 JSON. Quote filesystem paths normally for the shell. Prompts go in files, not interpolated shell commands.

## Submit and follow up

`submit`: `caller`, `key`, `name`, `provider`, absolute `cwd`, `prompt`.

Optional `options`:

- `timeoutMs`: explicit execution deadline. Omit to allow long silent work.
- `delayMs`: up to 60000; useful for an authorized post-response notification test.

Permission bypass is mandatory for both providers and every launch. There is no permission-mode choice. For compatibility, old `options.permission: manual` or `bypass` input is accepted and normalized to bypass; old DB records remain unchanged and cannot disable the launch flag. Retry keys from the earlier manual default remain idempotent.

`followup` uses the same shape plus `jobId`. Keep provider and cwd unchanged. It starts a new CLI process with the stored provider session ID. The original run and result remain in the DB. Active runs require `answer` or `cancel`, not another simultaneous follow-up.

The `(caller,key)` pair makes submission idempotent. Repeating identical input returns the existing job/run. Different content with the same key is rejected.

## Answer

`answer`: `caller`, `questionId`, `response`.

- A plain question: `response: {"text":"the actual human answer"}`.
- A multi-question Claude tool: `response: {"answers":{"exact question text":"actual answer"}}`.
- Historical permission records retain the legacy decision shape for data compatibility. New Claude permission requests are automatically allowed with the original tool input and do not generate a human approval prompt.

Inspect `mode`: `live` writes the actual general-question answer to the paused Claude stdin; `resume` starts a new CLI process in the recorded conversation after the old process ended. Both launch paths always bypass permissions. Duplicate identical answers are idempotent; stale or conflicting answers are rejected. Antigravity still has no live control-response protocol. An old stored permission request may resume a new process; that is not a live control response.

## Inspect and control

| Command | Request fields | Result |
|---|---|---|
| `status` | caller, jobId | Latest state, recent attempts, pending questions, separate delivery state |
| `question` | caller, questionId, optional offset/limit | Read the original question/permission payload in bounded chunks when status reports payloadTruncated |
| `result` | caller, runId, optional limit | Bounded saved result, max 8192 characters |
| `log` | caller, runId, optional file/offset/limit | Max 8192 bytes, explicit nextOffset; files stdout.jsonl, stderr.log, result.json |
| `cancel` | caller, jobId | Durable cancellation request; terminal status follows process exit |
| `events` | caller | Latest 20 events with bounded payloads |
| `ack` | caller, eventId | Mark receipt; duplicate ack is safe |
| `retry` | caller, eventId | Requeue same event ID; does not rerun the task |
| `service` | no request file | Start/recover the background service |
| `stop` | no request file | Stop service; active runs become interrupted on orderly shutdown/recovery |

## Delivery and recovery

Outbox transitions: pending → sending → sent → acked. Failed commands retry with capped exponential backoff. A timed-out queue command or crash during sending becomes uncertain: the same event ID may be received twice. This is at-least-once delivery, not exactly-once. `sent` means the CLI accepted the request; use `ack` to record receipt. App-closed delivery is not verified.

The daemon uses a SQLite ownership token and the OS process creation identity. A second daemon yields to the same live process even if its heartbeat is old. On restart it verifies and cleans up known orphan workers and marks their runs interrupted; it preserves results and never automatically repeats possibly side-effecting work. Failed orphan cleanup produces `recovery_blocked` and rejects a new run until a subsequent service recovery confirms cleanup. If a crash occurs in the short spawn-to-PID-recording window, the run is interrupted and requires inspection; automatic replay remains disabled.

When an answer was being written during a crash, its exact delivery is uncertain. The run becomes interrupted; inspect before explicitly continuing. Logs and each run's saved result remain available. General questions remain distinct from the automatic permission decision.

Environment overrides for local executable discovery: `AI_OC_CLAUDE`, `AI_OC_AGY`, `AI_OC_CODEX`. These name executable files, not shell command strings. Discovery checks PATH first, then the current user's standard installation locations for Claude and agy. Windows requires native `.exe` files; Codex is resolved from PATH. The companion setup skill checks the resolved executables without calling a model.

## Model list cache

`models` reads only SQLite. `models-refresh` queries synchronously only after the user explicitly asks to refresh. Payload: `caller`, optional `provider` (`claude` or `antigravity`); omission handles both independently. No model execution or background refresh occurs. Results include provider, models (`id`, `name`), `cached`, and `lastSuccess` (Unix milliseconds, null before success). No cache is different from an empty available-model list.

Antigravity uses `agy models` and validates its tab-separated output before atomically replacing that provider's rows and success timestamp. Failed/empty/malformed queries preserve both. Refresh returns `refreshed:false` and a nonzero command exit if any requested provider fails; successful providers remain updated.

Claude uses the official Agent SDK `supportedModels()` against the installed Claude executable, current authentication environment and user settings. It initializes a control session without yielding a user prompt, invoking a model, or persisting a conversation. The cache contains CLI selector values (including aliases such as default/sonnet), not a full API model catalog or proof each model is entitled or currently callable. Each response labels its source and scope. Project-specific settings are excluded from this global user-level cache.

Install its pinned SDK dependency once with `npm install --ignore-scripts` inside the installed agent-outsource skill folder. Missing dependency/authentication/timeout/invalid data preserves existing cache and success time. Refresh does not auto-install packages. `GET /v1/models` with a separate API key is a different provider/API catalog and is not substituted for this selector list. Sources: https://code.claude.com/docs/en/agent-sdk/typescript and https://code.claude.com/docs/en/model-config . Prices, rankings, model selection and worker model arguments remain outside this cache.
