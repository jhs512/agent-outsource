---
name: agent-outsource-setup
disable-model-invocation: true
description: Set up or diagnose the local prerequisites for agent-outsource after installation, checking Node.js, worker CLIs, Codex queue, authentication visibility, and the shared SQLite database.
---

# Set up CLI worker bridge

Use this skill only when the user explicitly invokes it. In Codex, use `$agent-outsource-setup`.

Run the bundled `scripts/setup.mjs` with Node.js using its absolute path. It expects `agent-outsource` installed beside this skill and requires Node.js 24 or newer. If Node is missing, direct the user to install Node.js before running it.

The checker locates CLI executables, inspects versions and required options, reads Claude's login status when available, and initializes/checks the shared home SQLite DB. It does not invoke an AI model, send a message, start the worker service, change global permissions, or register OS startup services.

Report ready checks separately from missing prerequisites and manual checks. The user needs only the worker CLI they intend to use; do not choose their worker or task. Antigravity login is not reliably exposed by a read-only status command here: ask the user to run `agy` and finish its login if they have not done so. Claude login is performed by the user through `claude auth login`. Never request credentials in the conversation or infer successful authentication from executable presence.

All worker executions use `--dangerously-skip-permissions`. Explain that tools execute without separate permission prompts; ordinary task questions still wait for the user's answer. Preserve this fixed setting.

After prerequisites are satisfied, the user can invoke `$agent-outsource` with their chosen CLI and a small task. The worker skill starts the background program as needed. Setup does not run a sample model call without the user's request. Offer the first-task example from [the usage guide](https://github.com/jhs512/agent-outsource#3-첫-작업-맡기기).

If the sibling worker skill is missing, install `skills/agent-outsource` from the same repository with the available skill installer. Do not overwrite an existing skill merely to pass setup; inspect local changes first. Newly installed skills are available on the next turn.
