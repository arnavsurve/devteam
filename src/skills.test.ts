import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { initWorkspace } from "./init";
import { listSkills, resolveSkill } from "./skills";

describe("skills", () => {
  test("loads a markdown skill", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "devteam-skill-"));
    const skillDir = join(workspace, ".devteam", "skills", "qa");
    await initWorkspace(workspace, { force: false, skipSkills: false });

    const skill = await resolveSkill(workspace, {}, "qa");
    expect(skill.id).toBe("qa");
    expect(skill.prompt).toContain("Verify the current implementation");
    expect(skill.manifestPath).toContain("SKILL.md");
    expect(skill.dir).toBe(skillDir);
  });

  test("init scaffolds config and starter markdown skills", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "devteam-init-"));
    const result = await initWorkspace(workspace, { force: false, skipSkills: false });
    expect(result.created.length).toBe(3);

    const config = await readFile(join(workspace, ".devteam", "config.yaml"), "utf8");
    const qaSkill = await readFile(join(workspace, ".devteam", "skills", "qa", "SKILL.md"), "utf8");
    expect(config).toContain("implement_skill: implement");
    expect(qaSkill).toContain("name: qa");

    const listed = await listSkills(workspace, {});
    expect(listed.some((skill) => skill.id === "qa" && skill.source === "workspace")).toBe(true);
  });
});
