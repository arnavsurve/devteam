import { z } from "zod";

export const RunStateSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "blocked",
  "error",
  "canceled",
]);

export const ArtifactSchema = z.object({
  type: z.string(),
  path: z.string(),
  label: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const ProofSchema = z.object({
  type: z.string(),
  label: z.string(),
  path: z.string().optional(),
  content: z.string().optional(),
});

export const FindingSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string(),
  actual: z.string(),
  expected: z.string(),
  repro_steps: z.array(z.string()).optional(),
  artifact_refs: z.array(z.string()).optional(),
});

export const TaskRequestSchema = z.object({
  task_type: z.string(),
  run_id: z.string(),
  workspace: z.string(),
  ref: z.string().default("HEAD"),
  goal: z.string(),
  acceptance_criteria: z.array(z.string()).default([]),
  context: z.record(z.any()).default({}),
  artifacts_dir: z.string(),
  reply_format: z.literal("structured_v1").default("structured_v1"),
});

export const TaskResultSchema = z.object({
  status: z.enum(["passed", "failed", "blocked", "error"]),
  summary: z.string(),
  findings: z.array(FindingSchema).default([]),
  artifacts: z.array(ArtifactSchema).default([]),
  proof: z.array(ProofSchema).default([]),
  next_action: z.string().nullable().default(null),
  metadata: z.record(z.any()).default({}),
});

export const ShellAdapterConfigSchema = z
  .object({
    kind: z.literal("shell"),
    command: z.array(z.string()).optional(),
    shell: z.string().optional(),
    env: z.record(z.string()).optional(),
    timeout_sec: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.command && !value.shell) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shell adapters require either command or shell",
      });
    }
  });

export const MockAdapterConfigSchema = z.object({
  kind: z.literal("mock"),
  status: z.enum(["passed", "failed", "blocked", "error"]).optional(),
  summary: z.string().optional(),
});

export const AdapterConfigSchema = z.union([
  ShellAdapterConfigSchema,
  MockAdapterConfigSchema,
]);

export const DevteamConfigSchema = z.object({
  skills: z.record(z.string()).optional(),
  adapters: z.record(AdapterConfigSchema).optional(),
  defaults: z
    .object({
      adapter: z.string().optional(),
      implement_skill: z.string().optional(),
      verify_skill: z.string().optional(),
      max_iterations: z.number().int().positive().optional(),
    })
    .optional(),
});

export const SkillManifestSchema = z.object({
  id: z.string(),
  version: z.union([z.string(), z.number()]).optional(),
  description: z.string(),
  inputs: z
    .object({
      required: z.array(z.string()).optional(),
      optional: z.array(z.string()).optional(),
    })
    .optional(),
  instructions: z
    .object({
      prompt_file: z.string(),
    })
    .optional(),
  capabilities: z
    .object({
      tools: z.array(z.string()).optional(),
      artifact_types: z.array(z.string()).optional(),
    })
    .optional(),
  policy: z
    .object({
      result_format: z.string().optional(),
      allow_code_changes: z.boolean().optional(),
    })
    .optional(),
});

export const PreparedRunSchema = z.object({
  run_id: z.string(),
  workspace: z.string(),
  skill_id: z.string(),
  skill_source: z.string(),
  request: TaskRequestSchema,
  adapter: AdapterConfigSchema,
  created_at: z.string(),
});

export const RunStatusSchema = z.object({
  run_id: z.string(),
  workspace: z.string(),
  task_type: z.string(),
  skill_id: z.string(),
  state: RunStateSchema,
  adapter_kind: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  pid: z.number().int().optional(),
  error: z.string().optional(),
  result_path: z.string(),
  prompt_path: z.string(),
  stdout_path: z.string(),
  stderr_path: z.string(),
});

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;
export type DevteamConfig = z.infer<typeof DevteamConfigSchema>;
export type PreparedRun = z.infer<typeof PreparedRunSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type TaskRequest = z.infer<typeof TaskRequestSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
