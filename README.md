# devteam

`devteam` is a generic broker CLI for delegating work between agents with pluggable skills.

It is intentionally repo-agnostic:

- the broker owns run state, prompts, artifacts, and loop control
- adapters decide how to invoke Codex, Claude Code, or any other agent runner
- skills are pluggable directories with a manifest plus prompt

## Status

This repo contains a working v1 local broker:

- run store in `.devteam/runs/<run-id>/`
- pluggable skill discovery
- configurable adapters
- `delegate`, `status`, `wait`, `list-skills`, `list-adapters`, and `loop` commands
- built-in `implement` and `qa` skills
- built-in mock adapters for smoke testing

## Install

```bash
bun install
```

Run the CLI locally:

```bash
bun run src/cli.ts help
```

## Skills

A skill is a directory containing:

```text
skills/<skill-id>/
  skill.yaml
  prompt.md
```

Example `skill.yaml`:

```yaml
id: qa
version: 1
description: Verify the current implementation and return proof-backed findings.
instructions:
  prompt_file: prompt.md
policy:
  allow_code_changes: false
```

Skill resolution order:

1. `--skill-path`
2. workspace config mapping in `.devteam/config.yaml`
3. workspace local `.devteam/skills/<id>`
4. user global `~/.config/devteam/skills/<id>`
5. built-in `skills/<id>`

## Adapters

Adapters are pluggable. V1 ships with:

- `mock-pass`
- `mock-fail`
- `mock-blocked`
- inline shell wrappers via `--command`
- configured shell adapters in `.devteam/config.yaml`

Example config:

```yaml
defaults:
  adapter: qa-wrapper

adapters:
  qa-wrapper:
    kind: shell
    shell: ./scripts/qa-wrapper.sh
    timeout_sec: 900

skills:
  qa: ~/.agents/skills/qa
```

### Shell adapter contract

Shell adapters receive paths and metadata through environment variables:

- `DEVTEAM_REQUEST_FILE`
- `DEVTEAM_PROMPT_FILE`
- `DEVTEAM_RESULT_FILE`
- `DEVTEAM_ARTIFACTS_DIR`
- `DEVTEAM_WORKSPACE`
- `DEVTEAM_RUN_DIR`
- `DEVTEAM_RUN_ID`
- `DEVTEAM_TASK_TYPE`
- `DEVTEAM_SKILL_ID`
- `DEVTEAM_GOAL`
- `DEVTEAM_REF`

Your wrapper script can talk to Codex, Claude Code, or another local/A2A agent, then must write a JSON result to `DEVTEAM_RESULT_FILE`.

Expected result shape:

```json
{
  "status": "passed",
  "summary": "short summary",
  "findings": [],
  "artifacts": [],
  "proof": [],
  "next_action": null,
  "metadata": {}
}
```

## Commands

List built-in and discovered skills:

```bash
bun run src/cli.ts list-skills
```

Delegate a QA task with the built-in mock adapter:

```bash
bun run src/cli.ts delegate qa \
  --goal "verify login flow" \
  --adapter mock-pass \
  --wait
```

Delegate through your own wrapper:

```bash
bun run src/cli.ts delegate qa \
  --goal "verify login flow" \
  --command "./scripts/qa-wrapper.sh" \
  --wait
```

Run an implementation/verification loop:

```bash
bun run src/cli.ts loop \
  --goal "implement feature X" \
  --impl-adapter mock-pass \
  --verify-adapter mock-pass
```

## Run layout

Each delegated run writes to:

```text
.devteam/runs/<run-id>/
  run-spec.json
  task-request.json
  task-prompt.md
  task-result.json
  status.json
  stdout.log
  stderr.log
  artifacts/
```

## Notes

This v1 uses a local process transport. The broker model is compatible with adding an A2A transport later without changing the run store, skill contract, or loop semantics.
