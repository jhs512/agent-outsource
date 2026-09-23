# Provider capabilities

## Claude Code

Every launch uses `--dangerously-skip-permissions`, print mode, stream-json input/output, verbose events, and stdio controls. No conflicting `--permission-mode manual` is added. `AskUserQuestion` remains a general human question. If another can_use_tool request still arrives, the bridge durably records and automatically allows its original input, without creating a user approval event. Earlier manual allow/deny tests are historical evidence, not the current execution policy.

After a final result the bridge closes stdin. Later work uses `--resume` with the exact saved session ID. A live question uses a control response while the process is paused, which is different from launching a resumed process.

## Antigravity CLI

The executable is `agy`, not `agy-cli` or `agy-ide`. Every launch and conversation resume includes `--dangerously-skip-permissions`. Its stream uses an `event` discriminator, unlike Claude's `type`. User messages carry `event: user`. The bridge sends no command-line prompt with stream input. It uses `--conversation` for a later process and explicitly sets the print timeout to zero.

The [official headless documentation](https://antigravity.google/docs/cli/headless/) states that control_request/control_response input is unsupported and ends the streaming session. Mandatory bypass avoids ordinary permission prompts. A denial that still occurs is reported as needs_review for provider policy or hook inspection, rather than creating an additional approval prompt. The bridge does not pretend to support live control responses.

Ordinary human questions can be returned as a structured `waiting_user` result and answered by resuming the same conversation. This, ordinary completion, exact-session follow-up, and cancellation passed local real-CLI tests with agy 1.2.8. Native question-tool and live approval support must be reported separately. An actual control_response input produced an explicit unsupported error and exit code 2.

A failed JSON hook can precede a secondary invalid UTF-8 provider error. The bridge preserves the first named hook failure in the job summary, even when the CLI exits nonzero. Inspect the hook configuration, target existence, and encoding before resuming. Never suppress all hooks or replace a missing security hook with a no-op. Back up configuration before a targeted repair; a confirmed orphaned integration may be disabled using the provider's supported per-hook setting. Check existing artifacts and explicitly resume only after repair; notification retries never rerun the task.

On this Windows installation, the orca-status handlers referenced five missing scripts belonging to an absent Orca installation. The config was backed up and only that orphaned integration disabled; handler definitions were retained. This is a local repair, not a setting distributed by this skill. Other installations need their own diagnosis.

## Output contract

The CLI's final structured outcome contains `status` (completed, waiting_user, failed), `summary`, and `question`. Native provider errors override a claimed task success. Missing or malformed outcomes become needs_review. Summaries are not independent artifact verification.

Raw stdout/stderr stay on disk. A bounded streaming parser detects oversized events, retains their raw logs, and prevents silently interpreting a partial result as completion.
