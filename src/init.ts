import { dirname, join } from "node:path";
import { ensureDir, pathExists, writeText } from "./util";

type InitOptions = {
  force: boolean;
  skipSkills: boolean;
};

type InitResult = {
  created: string[];
  skipped: string[];
};

const configTemplate = `defaults:
  implement_skill: implement
  verify_skill: qa
  max_iterations: 3

# Uncomment and point this at your wrapper once you have one.
# defaults:
#   adapter: local-agent
#
# adapters:
#   local-agent:
#     kind: shell
#     shell: ./scripts/devteam-agent-wrapper.sh
#     timeout_sec: 900
`;

const implementSkillTemplate = `---
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
- \`passed\` when you believe the implementation is complete.
- \`failed\` when the request is infeasible or contradictory.
- \`blocked\` when required context, credentials, or tooling are missing.
- \`error\` only for wrapper/runtime failures you cannot recover from.

Include changed file paths in \`metadata.changed_files\` when possible.
`;

const qaSkillTemplate = `---
name: qa
description: Verify the current implementation and return proof-backed findings.
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
  allow_code_changes: false
capabilities:
  artifact_types:
    - screenshot
    - command_output
    - log
---

Verify the current implementation against the goal and acceptance criteria.

Rules:
- Do not modify code.
- Prefer direct proof over summary: screenshots, command output, logs.
- Focus findings on concrete regressions, missing behavior, or blockers.
- If the environment is unhealthy, return \`blocked\` with the exact missing prerequisite.

Return a structured result:
- \`passed\` when the implementation satisfies the acceptance criteria.
- \`failed\` when behavior is incorrect or incomplete.
- \`blocked\` when verification cannot proceed due to environment or access issues.
- \`error\` only for wrapper/runtime failures you cannot recover from.

Each finding should describe expected behavior, actual behavior, and reproducible steps when available.
`;

export async function initWorkspace(workspace: string, options: InitOptions): Promise<InitResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  const files = [
    {
      path: join(workspace, ".devteam", "config.yaml"),
      content: configTemplate,
    },
    ...(
      options.skipSkills
        ? []
        : [
            {
              path: join(workspace, ".devteam", "skills", "implement", "SKILL.md"),
              content: implementSkillTemplate,
            },
            {
              path: join(workspace, ".devteam", "skills", "qa", "SKILL.md"),
              content: qaSkillTemplate,
            },
          ]
    ),
  ];

  for (const file of files) {
    if (!options.force && (await pathExists(file.path))) {
      skipped.push(file.path);
      continue;
    }

    await ensureDir(dirname(file.path));
    await writeText(file.path, file.content);
    created.push(file.path);
  }

  return {
    created,
    skipped,
  };
}
