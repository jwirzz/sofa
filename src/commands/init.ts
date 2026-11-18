import { Command } from "@commander-js/extra-typings";
import { dirname, join } from "node:path";

const EXAMPLE_YAML = `version: 1
agents: [claude-code, codex, cursor]

# Catalog: define every MCP and skill exactly once
mcps:
  playwright:
    command: npx
    args: ["-y", "@playwright/mcp@latest"]

skills: {}

# Environments: named sets that only reference the catalog
environments:
  base: # always active
    mcps: []
    skills: []
  frontend:
    mcps: [playwright]
    skills: []
`;

const GITIGNORE = `.state.json
.cache/
sofa.local.yaml
`;

export function sofaHome(): string {
  const override = Deno.env.get("SOFA_HOME");
  if (override) return override;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) throw new Error("Cannot determine home directory");
  return join(home, ".sofa");
}

async function git(args: string[], cwd?: string) {
  let out;
  try {
    out = await new Deno.Command("git", {
      args,
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error("git was not found in PATH");
    }
    throw e;
  }
  if (!out.success) throw new Error(`git ${args[0]} failed`);
}

async function isNonEmptyDir(path: string): Promise<boolean> {
  try {
    for await (const _ of Deno.readDir(path)) return true;
    return false;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

async function initFresh(dir: string) {
  await Deno.mkdir(join(dir, "skills"), { recursive: true });
  await Deno.writeTextFile(join(dir, "sofa.yaml"), EXAMPLE_YAML);
  await Deno.writeTextFile(join(dir, ".gitignore"), GITIGNORE);
  await Deno.writeTextFile(join(dir, "skills", ".gitkeep"), "");
  await git(["init", "--quiet"], dir);
}

export const init = new Command("init")
  .description("Create ~/.sofa (git repo with example sofa.yaml)")
  .option("--from <url>", "clone an existing sofa repo instead of creating one")
  .action(async (opts) => {
    const dir = sofaHome();
    try {
      if (await isNonEmptyDir(dir)) {
        throw new Error(`${dir} already exists and is not empty`);
      }
      if (opts.from) {
        await Deno.mkdir(dirname(dir), { recursive: true });
        await git(["clone", opts.from, dir]);
        console.log(`Cloned ${opts.from} into ${dir}`);
      } else {
        await initFresh(dir);
        console.log(`Initialized sofa in ${dir}`);
        console.log(`Edit ${join(dir, "sofa.yaml")} to get started.`);
      }
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : e}`);
      Deno.exit(1);
    }
  });
