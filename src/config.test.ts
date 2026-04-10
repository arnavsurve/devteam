import { describe, expect, test } from "bun:test";
import { resolveAdapterFromConfig } from "./config";

describe("config", () => {
  test("infers codex backend from agent binary name", () => {
    const resolved = resolveAdapterFromConfig(
      {
        agent: {
          bin: "codex",
        },
      },
      undefined,
      undefined,
    );

    expect(resolved?.adapter.kind).toBe("codex");
    if (resolved?.adapter.kind === "codex") {
      expect(resolved.adapter.bin).toBe("codex");
    }
  });

  test("infers codex backend from agent binary path", () => {
    const resolved = resolveAdapterFromConfig(
      {
        agent: {
          bin: "/usr/local/bin/codex",
          sandbox: "workspace-write",
        },
      },
      undefined,
      undefined,
    );

    expect(resolved?.adapter.kind).toBe("codex");
    if (resolved?.adapter.kind === "codex") {
      expect(resolved.adapter.bin).toBe("/usr/local/bin/codex");
      expect(resolved.adapter.sandbox).toBe("workspace-write");
    }
  });
});
