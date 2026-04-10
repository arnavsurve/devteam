# devteam

`devteam` is a generic broker CLI for delegating work between agents with pluggable skills.

It is intentionally repo-agnostic:

- the broker owns run state, prompts, artifacts, and loop control
- adapters decide how to invoke Codex, Claude Code, or any other agent runner
- skills are pluggable directories, with `SKILL.md` as the primary format

## Status

This repo contains a working v1 local broker:

- run store in `.devteam/runs/<run-id>/`
- pluggable skill discovery
- configurable adapters
- `init`, `delegate`, `status`, `wait`, `list-skills`, `list-adapters`, and `loop` commands
- built-in `implement` and `qa` skills
- built-in mock adapters for smoke testing

## Install

```bash
bun install -g .
```

Confirm the install:

```bash
devteam help
```

## Skills

A skill is usually a directory containing:

```text
skills/<skill-id>/
  SKILL.md
```

Example `SKILL.md`:

```md
---
name: qa
description: Verify the current implementation and return proof-backed findings.
policy:
  allow_code_changes: false
---

Verify the current implementation and return proof-backed findings.
```

`SKILL.md` uses YAML frontmatter plus markdown body. The frontmatter carries metadata, and the markdown body is the delegated instruction payload.

For compatibility, `devteam` also accepts the older layout:

```text
skills/<skill-id>/
  skill.yaml
  prompt.md
```

Example `skill.yaml`:

```yaml
name: qa
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

## Agent Binary

The normal config path is to point `devteam` at an agent binary in `.devteam/config.yaml`:

```yaml
agent:
  bin: codex
```

You can also use an absolute path:

```yaml
agent:
  bin: /absolute/path/to/codex
```

`devteam` infers the backend internally from that binary name/path. Right now the built-in native path supports `codex`.

## Adapters

Adapters still exist internally. V1 ships with:

- `codex`
- `mock-pass`
- `mock-fail`
- `mock-blocked`
- inline shell wrappers via `--command`
- configured shell adapters in `.devteam/config.yaml`

If you want to override the native binary path with your own wrapper:

```yaml
defaults:
  adapter: qa-wrapper

adapters:
  qa-wrapper:
    kind: shell
    shell: ./scripts/qa-wrapper.sh
    timeout_sec: 900
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

Scaffold `.devteam/` in the current repo:

```bash
devteam init
```

This creates:

```text
.devteam/
  config.yaml
  skills/
    implement/SKILL.md
    qa/SKILL.md
```

List built-in and discovered skills:

```bash
devteam list-skills
```

Delegate a QA task with the built-in mock adapter:

```bash
devteam delegate qa \
  --goal "verify login flow" \
  --adapter mock-pass \
  --wait
```

If `agent.bin` is configured, or `codex` is installed on `PATH`, the normal path is just:

```bash
devteam delegate qa \
  --goal "verify login flow" \
  --wait
```

Delegate through your own wrapper:

```bash
devteam delegate qa \
  --goal "verify login flow" \
  --command "./scripts/qa-wrapper.sh" \
  --wait
```

Run an implementation/verification loop:

```bash
devteam loop \
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
