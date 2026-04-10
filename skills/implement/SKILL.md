---
name: implement
description: Implement the requested change in the workspace and report what you changed.
version: 1
inputs:
  required:
    - workspace
    - goal
    - artifacts_dir
  optional:
    - acceptance_criteria
    - context
policy:
  result_format: structured_v1
  allow_code_changes: true
---

Implement the requested change directly in the workspace.

Rules:
- Prefer the smallest coherent change that satisfies the goal.
- Use acceptance criteria as the primary definition of done.
- If prior verification feedback is present in context, address it explicitly.
- Save any useful evidence in the artifacts directory.

Return a structured result:
- `passed` when you believe the implementation is complete.
- `failed` when the request is infeasible or contradictory.
- `blocked` when required context, credentials, or tooling are missing.
- `error` only for wrapper/runtime failures you cannot recover from.

Include changed file paths in `metadata.changed_files` when possible.
