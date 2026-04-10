import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { getRunPaths } from "./run-store";
import { TaskResultSchema, type AdapterConfig, type PreparedRun, type TaskResult } from "./types";
import { pathExists } from "./util";

export async function executeAdapter(spec: PreparedRun) {
  switch (spec.adapter.kind) {
    case "mock":
      return buildMockResult(spec.adapter.status ?? "passed", spec.adapter.summary);
    case "shell":
      return executeShellAdapter(spec, spec.adapter);
  }
}

function buildMockResult(status: TaskResult["status"], summary?: string): TaskResult {
  return {
    status,
    summary:
      summary ??
      (status === "passed"
        ? "Mock adapter passed."
        : status === "failed"
          ? "Mock adapter failed."
          : status === "blocked"
            ? "Mock adapter blocked."
            : "Mock adapter errored."),
    findings:
      status === "failed"
        ? [
            {
              severity: "high",
              title: "Mock failure",
              actual: "The mock adapter was configured to fail.",
              expected: "The delegated task should pass.",
            },
          ]
        : [],
    artifacts: [],
    proof: [],
    next_action: status === "failed" ? "Inspect the mock adapter configuration." : null,
    metadata: {
      adapter: "mock",
    },
  };
}

async function executeShellAdapter(
  spec: PreparedRun,
  adapter: Extract<AdapterConfig, { kind: "shell" }>,
): Promise<TaskResult> {
  const paths = getRunPaths(spec.workspace, spec.run_id);
  const stdoutStream = createWriteStream(paths.stdout, { flags: "a" });
  const stderrStream = createWriteStream(paths.stderr, { flags: "a" });

  const environment = {
    ...process.env,
    ...(adapter.env ?? {}),
    DEVTEAM_RUN_ID: spec.run_id,
    DEVTEAM_RUN_DIR: paths.root,
    DEVTEAM_WORKSPACE: spec.workspace,
    DEVTEAM_TASK_TYPE: spec.request.task_type,
    DEVTEAM_SKILL_ID: spec.skill_id,
    DEVTEAM_GOAL: spec.request.goal,
    DEVTEAM_REF: spec.request.ref,
    DEVTEAM_REQUEST_FILE: paths.request,
    DEVTEAM_PROMPT_FILE: paths.prompt,
    DEVTEAM_RESULT_FILE: paths.result,
    DEVTEAM_ARTIFACTS_DIR: paths.artifactsDir,
    DEVTEAM_STDOUT_LOG: paths.stdout,
    DEVTEAM_STDERR_LOG: paths.stderr,
  };

  const child =
    adapter.command && adapter.command.length > 0
      ? spawn(adapter.command[0], adapter.command.slice(1), {
          cwd: spec.workspace,
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(process.env.SHELL || "/bin/sh", ["-lc", adapter.shell ?? ""], {
          cwd: spec.workspace,
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        });

  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);

  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (adapter.timeout_sec) {
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, adapter.timeout_sec * 1000);
  }

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });

  if (timeout) clearTimeout(timeout);
  stdoutStream.end();
  stderrStream.end();

  if (!(await pathExists(paths.result))) {
    const stdout = await readMaybe(paths.stdout);
    const stderr = await readMaybe(paths.stderr);
    return {
      status: "error",
      summary: timedOut
        ? "Adapter timed out before writing a result."
        : "Adapter exited without writing a result.",
      findings: [],
      artifacts: [],
      proof: [
        {
          type: "command_output",
          label: "adapter-exit",
          content: JSON.stringify(exit),
        },
        {
          type: "command_output",
          label: "stdout-tail",
          content: stdout.slice(-4000),
        },
        {
          type: "command_output",
          label: "stderr-tail",
          content: stderr.slice(-4000),
        },
      ],
      next_action: "Inspect the adapter wrapper and ensure it writes DEVTEAM_RESULT_FILE.",
      metadata: {
        adapter: "shell",
        exit,
        timed_out: timedOut,
      },
    };
  }

  const raw = JSON.parse(await readFile(paths.result, "utf8")) as unknown;
  const parsed = TaskResultSchema.parse(raw);
  return {
    ...parsed,
    metadata: {
      ...parsed.metadata,
      adapter: "shell",
      exit,
      timed_out: timedOut,
    },
  };
}

async function readMaybe(path: string) {
  if (!(await pathExists(path))) return "";
  return readFile(path, "utf8");
}
