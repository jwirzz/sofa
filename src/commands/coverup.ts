import { Command } from "@commander-js/extra-typings";
import { join } from "node:path";
import { home } from "../lib/adapters/mod.ts";
import { sofaHome } from "../lib/config.ts";

type Json = Record<string, unknown>;

const MARKER = "# sofa coverup";

// Agent-agnostic: a git commit-msg hook that strips AI attribution lines.
const AI_NAMES =
  "claude|anthropic|codex|openai|chatgpt|cursor|copilot|gemini|opencode|aider|devin|windsurf|cline|amp";

const hookScript = (chain: boolean) =>
  `#!/bin/sh
${MARKER} - removes AI attribution from commit messages
f="$1"
sed -E -i.sofabak \\
  -e '/^[Cc]o-[Aa]uthored-[Bb]y:.*(${AI_NAMES})/Id' \\
  -e '/^(🤖 )?Generated (with|by) /d' "$f"
rm -f "$f.sofabak"
# drop trailing blank lines left behind
awk '{l[NR]=$0} END{n=NR; while(n>0 && l[n]=="") n--; for(i=1;i<=n;i++) print l[i]}' "$f" > "$f.sofatmp" && mv "$f.sofatmp" "$f"
${
    chain
      ? `# keep per-repo hooks working
repo_hook="$(git rev-parse --git-dir)/hooks/commit-msg"
[ -x "$repo_hook" ] && exec "$repo_hook" "$@"
`
      : ""
  }exit 0
`;

async function git(args: string[], cwd?: string) {
  const out = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    ok: out.success,
    out: new TextDecoder().decode(out.stdout).trim(),
    err: new TextDecoder().decode(out.stderr).trim(),
  };
}

async function readText(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function readJson(path: string): Promise<Json> {
  const text = await readText(path);
  if (!text?.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} is not plain JSON - not touching it`);
  }
}

/** Claude Code's own setting (also covers PR descriptions). */
async function claudeSettings(here: boolean, undo: boolean) {
  const dir = here ? join(Deno.cwd(), ".claude") : join(home(), ".claude");
  const path = join(dir, "settings.json");
  const s = await readJson(path);
  if (undo) {
    delete s.attribution;
    delete s.includeCoAuthoredBy;
  } else {
    s.attribution = { commit: "", pr: "" };
    s.includeCoAuthoredBy = false;
  }
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(s, null, 2) + "\n");
  console.log(`${undo ? "-" : "+"} Claude Code settings: ${path}`);
}

async function installHook(path: string, chain: boolean) {
  const existing = await readText(path);
  if (existing !== null && !existing.includes(MARKER)) {
    throw new Error(`${path} already exists and isn't managed by sofa`);
  }
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, hookScript(chain));
  await Deno.chmod(path, 0o755);
}

async function removeHook(path: string) {
  const existing = await readText(path);
  if (existing?.includes(MARKER)) await Deno.remove(path);
}

async function gitHook(here: boolean, undo: boolean) {
  if (here) {
    const r = await git(["rev-parse", "--git-path", "hooks/commit-msg"]);
    if (!r.ok) throw new Error("not inside a git repository");
    const path = join(Deno.cwd(), r.out);
    if (undo) await removeHook(path);
    else await installHook(path, false);
    console.log(`${undo ? "-" : "+"} git commit-msg hook: ${path}`);
    return;
  }
  const hooksDir = join(sofaHome(), "hooks");
  const current =
    (await git(["config", "--global", "--get", "core.hooksPath"])).out;
  if (undo) {
    await removeHook(join(hooksDir, "commit-msg"));
    if (current === hooksDir) {
      await git(["config", "--global", "--unset", "core.hooksPath"]);
    }
  } else {
    if (current && current !== hooksDir) {
      throw new Error(
        `global core.hooksPath is already set to ${current}; use --here per repo or unset it`,
      );
    }
    await installHook(join(hooksDir, "commit-msg"), true);
    const r = await git(["config", "--global", "core.hooksPath", hooksDir]);
    if (!r.ok) throw new Error(r.err);
  }
  console.log(`${undo ? "-" : "+"} global git hook: ${hooksDir}/commit-msg`);
}

export const coverup = new Command("coverup")
  .description(
    "Keep every AI agent out of your commit messages (Co-Authored-By, 'Generated with')",
  )
  .option("--here", "only for the current project instead of globally")
  .option("--undo", "remove everything coverup installed")
  .action(async (opts) => {
    try {
      await claudeSettings(!!opts.here, !!opts.undo);
      await gitHook(!!opts.here, !!opts.undo);
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : e}`);
      Deno.exit(1);
    }
  });
