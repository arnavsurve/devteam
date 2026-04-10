import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { executeRun, prepareRun } from "./broker";

describe("broker", () => {
  test("executes a mock adapter run", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "devteam-mock-"));
    const prepared = await prepareRun(
      {
        workspace,
        skillId: "qa",
        adapterName: "mock-pass",
        goal: "verify a mock flow",
        acceptanceCriteria: ["the run should pass"],
        context: {},
        wait: true,
      },
      {},
    );

    const result = await executeRun(workspace, prepared.runId);
    expect(result.status).toBe("passed");
    expect(result.summary).toContain("Mock adapter passed");
  });

  test("executes a shell adapter wrapper run", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "devteam-shell-"));
    const wrapperPath = join(process.cwd(), "examples", "mock-wrapper.ts");
    const prepared = await prepareRun(
      {
        workspace,
        skillId: "qa",
        inlineShell: `bun run ${wrapperPath}`,
        goal: "verify shell wrapper flow",
        acceptanceCriteria: ["the wrapper should write a result"],
        context: {},
        wait: true,
      },
      {},
    );

    const result = await executeRun(workspace, prepared.runId);
    expect(result.status).toBe("passed");
    expect(result.artifacts[0]?.label).toBe("wrapper-proof");
  });
});
