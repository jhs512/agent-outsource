---
name: agent-outsource-setup
disable-model-invocation: true
description: Set up or diagnose agent-outsource after installation, configuring Codex shared-directory write access and checking Node.js, worker CLIs, Codex queue, authentication visibility, and SQLite.
---

# Set up CLI worker bridge

Use this skill only when the user explicitly invokes it. In Codex, use `$agent-outsource-setup`.

Before running the checker, prepare Codex write access as described below. Then run the bundled `scripts/setup.mjs` with Node.js using its absolute path. It expects `agent-outsource` installed beside this skill and requires Node.js 24 or newer. If Node is missing, direct the user to install Node.js before running it.

## Prepare Codex shared-directory write access

An explicit setup request includes checking and adding this skill's dedicated data directory to the user's Codex configuration. For a diagnosis-only or check-only request, inspect and report without changing configuration.

1. Resolve the data directory as `path.join(os.homedir(), '.agent-outsource')` on the host running the worker. Resolve the user configuration as `$CODEX_HOME/config.toml`, falling back to `~/.codex/config.toml`. Use that user's actual absolute paths, not a developer username or the repository's `.codex/config.toml`.
2. Read the existing configuration. Under `[sandbox_workspace_write]`, check whether `writable_roots` already includes the data directory (or an ancestor that covers it). If covered, leave the file unchanged. Otherwise merge only the dedicated data directory into the existing array, preserving other roots, keys, tables, and comments. Create the file/table/array if absent; keep TOML valid and avoid duplicate tables or keys. If the file is malformed, report the problem without replacing it. If `default_permissions` or `[permissions]` selects a permissions profile, report that profile for reconciliation instead of mixing permission configuration schemes.
3. Re-read the configuration to confirm the entry and report `already configured`, `added`, or `not configured`, with the config path and data directory. Preserve the current sandbox mode and approval policy. If runtime permissions prevent reading or updating the config, report that specific failure and the exact TOML addition; do not retry the same denied write repeatedly.
4. Run the checker to test the SQLite transaction and log-directory write. Report saved configuration separately from actual write-check results: changing config does not retroactively grant this task access. If writing is still denied, direct the user to start a new workspace-write task and rerun setup. Never report effective access based only on the saved setting.

The directory grant covers the SQLite file, its WAL/SHM sidecars, and logs. Keep the DB at `~/.agent-outsource/agent-outsource.sqlite`; adding it under `CODEX_HOME` is unnecessary. These configuration edits are performed by the agent invoking this skill; running `scripts/setup.mjs` directly only runs the checker.

## Check prerequisites

The checker locates CLI executables, inspects versions and required options, reads Claude's login status when available, and initializes/checks the shared home SQLite DB. It does not invoke an AI model, send a message, start the worker service, change global permissions, or register OS startup services.

Report ready checks separately from missing prerequisites and manual checks. The user needs only the worker CLI they intend to use; do not choose their worker or task. Antigravity login is not reliably exposed by a read-only status command here: ask the user to run `agy` and finish its login if they have not done so. Claude login is performed by the user through `claude auth login`. Never request credentials in the conversation or infer successful authentication from executable presence.

All worker executions use `--dangerously-skip-permissions`. Explain that tools execute without separate permission prompts; ordinary task questions still wait for the user's answer. Preserve this fixed setting.

After prerequisites are satisfied, the user can invoke `$agent-outsource` with their chosen CLI and a small task. The worker skill starts the background program as needed. Setup does not run a sample model call without the user's request. Offer the first-task example from [the usage guide](https://github.com/jhs512/agent-outsource#3-첫-작업-맡기기).

If the sibling worker skill is missing, install `skills/agent-outsource` from the same repository with the available skill installer. Do not overwrite an existing skill merely to pass setup; inspect local changes first. Newly installed skills are available on the next turn.
