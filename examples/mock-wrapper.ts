#!/usr/bin/env bun
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const requestFile = process.env.DEVTEAM_REQUEST_FILE;
const resultFile = process.env.DEVTEAM_RESULT_FILE;
const artifactsDir = process.env.DEVTEAM_ARTIFACTS_DIR;

if (!requestFile || !resultFile || !artifactsDir) {
  console.error("Missing DEVTEAM_* environment variables.");
  process.exit(1);
}

const request = JSON.parse(await readFile(requestFile, "utf8")) as {
  goal: string;
  task_type: string;
};

await mkdir(artifactsDir, { recursive: true });
const proofPath = join(artifactsDir, "wrapper-proof.txt");
await writeFile(proofPath, `goal=${request.goal}\ntask=${request.task_type}\n`, "utf8");

await mkdir(dirname(resultFile), { recursive: true });
await writeFile(
  resultFile,
  `${JSON.stringify(
    {
      status: "passed",
      summary: `Wrapper completed ${request.task_type}.`,
      findings: [],
      artifacts: [
        {
          type: "file",
          path: proofPath,
          label: "wrapper-proof",
        },
      ],
      proof: [
        {
          type: "command_output",
          label: "wrapper",
          content: "mock wrapper ran successfully",
        },
      ],
      next_action: null,
      metadata: {
        adapter: "example-wrapper",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
