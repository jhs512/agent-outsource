---
name: agent-outsource-setup
disable-model-invocation: true
description: Set up or diagnose agent-outsource after installation, initializing the current project’s SQLite DB and checking Node.js, worker CLIs, Codex queue, authentication visibility, and SQLite WAL mode.
---

# Set up CLI worker bridge

Use this skill only when the user explicitly invokes it. In Codex, use `$agent-outsource-setup`.

Run the bundled `scripts/setup.mjs` with Node.js using its absolute path and the current project as the command's working directory. It expects `agent-outsource` installed beside this skill and requires Node.js 24 or newer. If Node is missing, direct the user to install it.

## Generated project instructions

Setup creates or updates a marked block in the current project's `AGENTS.md`: delegate nearly all substantive work through agent-outsource; Codex coordinates and verifies. Explicit user instructions take precedence, trivial work may be done directly, and workers complete assignments without recursive delegation. Preserve instructions outside the marked block. Report malformed markers rather than overwriting the file.

Setup adds `/AGENTS.md` and `/.agent-outsource/` to the project's `.gitignore`. These generated files stay local; the source templates and scripts remain versioned. If already tracked, report that ignore rules do not untrack files; do not discard their content or alter the index automatically. Repeated setup must not duplicate the policy block or ignore rules.

## Project storage

The current project folder is the database root. Setup creates `<project>/.agent-outsource/agent-outsource.sqlite` and the adjacent `agent-outsource.sqlite.logs/` directory. Use the current project without asking the user to choose a shared parent folder. When the user explicitly targets another project, run there or pass `--project-dir <absolute project folder>`.

Only the target project's database is opened. Databases and logs elsewhere remain untouched. Setup records `project_root`, enables WAL, and verifies integrity, a write transaction and log-directory writes. Report the absolute database path and actual check results separately from CLI and login readiness.

The current workspace's write permission normally covers this storage. If a write check is denied, report the exact path and request only the project access needed under the active permission policy. Do not add parent folders to the user's Codex configuration. Preserve existing configuration; a saved permission setting is not proof of effective access.

## Check prerequisites

The checker locates CLI executables, inspects versions and required options, reads Claude's login status when available, and initializes/checks the project SQLite DB (WAL mode and integrity). It does not invoke an AI model, send a message, start the worker service, change global permissions, or register OS startup services.

Report ready checks separately from missing prerequisites and manual checks. The user needs only the worker CLI they intend to use; do not choose their worker or task. Antigravity login is not reliably exposed by a read-only status command here: ask the user to run `agy` and finish its login if they have not done so. Claude login is performed by the user through `claude auth login`. Never request credentials in the conversation or infer successful authentication from executable presence.

All worker executions use `--dangerously-skip-permissions`. Explain that tools execute without separate permission prompts; ordinary task questions still wait for the user's answer. Preserve this fixed setting.

After prerequisites are satisfied, the user can invoke `$agent-outsource` with their chosen CLI and a small task. The worker skill starts the background program as needed. Setup does not run a sample model call without the user's request. Offer the first-task example from [the usage guide](https://github.com/jhs512/agent-outsource#3-첫-작업-맡기기).

If the sibling worker skill is missing, install `skills/agent-outsource` from the same repository with the available skill installer. Do not overwrite an existing skill merely to pass setup; inspect local changes first. Newly installed skills are available on the next turn.
