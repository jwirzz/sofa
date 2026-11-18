import { Command } from "@commander-js/extra-typings";
import { bold, dim } from "@std/fmt/colors";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { type Document, isMap, isScalar, isSeq, parse, parseDocument } from "yaml";
import { home } from "../adapters/mod.ts";
import { type SkillEntry, userCwd } from "../config.ts";
import { err, fail, interactive, ok, pick, spinner, warn } from "../ui.ts";
import { sofaHome } from "./init.ts";

export const skillsDir = () => join(sofaHome(), "skills");
const configPath = () => join(sofaHome(), "sofa.yaml");

export async function readConfig() {
  const src = await Deno.readTextFile(configPath()).catch((e) => {
    if (e instanceof Deno.errors.NotFound) fail(`${configPath()} not found, run sofa init first`);
    throw e;
  });
  const doc = parseDocument(src);
  if (doc.errors.length) fail(`${configPath()}: ${doc.errors[0].message}`);
  return doc;
}

export const writeConfig = (doc: Document) =>
  Deno.writeTextFile(configPath(), doc.toString({ flowCollectionPadding: false }));

export function setSkill(doc: Document, name: string, entry: Record<string, string>) {
  const cur = doc.get("skills", true);
  const skills = isMap(cur) ? cur : doc.createNode({});
  if (isScalar(cur) && cur.comment) skills.commentBefore = cur.comment;
  skills.flow = false;
  skills.set(name, doc.createNode(entry));
  doc.set("skills", skills);
}

type EnvKey = "skills" | "mcps";

export function envList(doc: Document, env: string, key: EnvKey): string[] {
  const list = doc.getIn(["environments", env, key]);
  return isSeq(list) ? list.items.map((i) => String(isScalar(i) ? i.value : i)) : [];
}

// set an environment's skills or mcps, keeping the existing list style; creates the environment if needed
export function setEnvList(doc: Document, env: string, key: EnvKey, names: string[]) {
  const e = doc.getIn(["environments", env]);
  const list = isMap(e) ? e.get(key) : undefined;
  if (isSeq(list)) {
    list.items = list.items.filter((i) => isScalar(i) && names.includes(String(i.value)));
    for (const n of names) if (!envList(doc, env, key).includes(n)) list.add(doc.createNode(n));
    return;
  }
  const seq = doc.createNode(names);
  seq.flow = true;
  if (isMap(e)) e.set(key, seq);
  else doc.setIn(["environments", env], doc.createNode({ [key]: seq }));
}

function dropSkill(doc: Document, name: string) {
  const envs = doc.get("environments");
  if (isMap(envs)) {
    for (const { value } of envs.items) {
      const list = isMap(value) ? value.get("skills") : undefined;
      if (isSeq(list)) list.items = list.items.filter((i) => !(isScalar(i) && i.value === name));
    }
  }
  const skills = doc.get("skills");
  return isMap(skills) && skills.delete(name);
}

// a skill folder on disk (anywhere; a path to its SKILL.md works too), or null for a package like owner/repo
async function localDir(pkg: string) {
  const path = resolve(userCwd(), pkg.replace(/^~(?=$|[\\/])/, home()));
  const info = await Deno.stat(path).catch(() => null);
  if (info) return info.isFile ? dirname(path) : path;
  if (/^[.~]/.test(pkg) || isAbsolute(pkg)) fail(`${pkg}: no such file or directory`);
  return null;
}

const installedSkills = async () =>
  (await Array.fromAsync(Deno.readDir(skillsDir())).catch(() => []))
    .filter((e) => e.isDirectory).map((e) => e.name).sort();

const add = new Command("add")
  .alias("install")
  .description("Install skills via the skills CLI into ~/.sofa/skills and record them in sofa.yaml")
  .argument("<package>", "skill package (e.g. anthropics/skills) or local path")
  .option("-s, --skill <names...>", "only install these skills (asks if omitted)")
  .option("-e, --env <names...>", "also add the skills to these environments (asks if omitted)")
  .action(async (pkg, opts) => {
    const doc = await readConfig();
    const localPath = await localDir(pkg);
    const local = localPath !== null;
    await Deno.mkdir(skillsDir(), { recursive: true });
    const tmp = await Deno.makeTempDir({ dir: sofaHome() });
    const cleanup = () => {
      try {
        Deno.removeSync(tmp, { recursive: true });
      } catch { /* already removed */ }
    };
    globalThis.addEventListener("unload", cleanup); // Ctrl+C in a prompt exits without running finally
    try {
      const args = ["-y", "skills", "add", localPath ?? pkg, "-a", "universal", "--copy", "-y", "--json"];
      if (opts.skill) args.push("-s", ...opts.skill);
      // keep skills CLI side effects (global lock, temp files, telemetry) inside tmp
      const env = {
        XDG_STATE_HOME: tmp,
        TMPDIR: tmp,
        TEMP: tmp,
        TMP: tmp,
        DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
        npm_config_update_notifier: "false",
      };
      const stop = spinner(`Fetching ${pkg} …`);
      const res = await new Deno.Command("npx", { args, cwd: tmp, env, stdin: "null" }).output().finally(stop);
      const text = new TextDecoder();
      let results: { name?: string; status: string; path?: string; reason?: string; error?: string }[];
      try {
        results = JSON.parse(text.decode(res.stdout));
      } catch {
        return err(`skills add failed:\n${text.decode(res.stderr)}`);
      }

      let found: { name: string; path: string }[] = [];
      for (const r of results) {
        if (r.status === "installed" && r.path && r.name) found.push({ name: r.name, path: r.path });
        else err(`${r.name ?? pkg}: ${r.reason ?? r.error ?? r.status}`);
      }
      if (!opts.skill && found.length > 1 && interactive()) {
        const names = await pick(`Which skills from ${bold(pkg)}?`, found.map((r) => ({ value: r.name })));
        found = found.filter((r) => names.includes(r.name));
      }
      if (!found.length) return warn("no skills installed");

      const known = Object.keys(doc.toJS()?.environments ?? {});
      let envs = opts.env ?? [];
      if (!opts.env && known.length && interactive()) {
        envs = await pick("Add to environments? (enter to skip)", known.map((value) => ({ value })));
      }
      for (const r of found) {
        const dir = basename(r.path);
        const dest = join(skillsDir(), dir);
        await Deno.remove(dest, { recursive: true }).catch(() => {});
        await Deno.rename(r.path, dest);
        setSkill(doc, dir, local ? { path: `./skills/${dir}` } : { source: pkg, skill: r.name });
        for (const e of envs) setEnvList(doc, e, "skills", [...new Set([...envList(doc, e, "skills"), dir])]);
        await writeConfig(doc);
        ok(`${bold(r.name)}${envs.length ? dim(` → ${envs.join(", ")}`) : ""}`);
      }
      const created = envs.filter((e) => !known.includes(e));
      if (created.length) ok(`new environment: ${created.map((e) => bold(e)).join(", ")}`);
    } finally {
      cleanup();
    }
  });

// owner of the source repo (anthropics/skills, https://github.com/anthropics/skills -> anthropics), "custom" for own skills
export function skillAuthor(e?: SkillEntry | null) {
  if (e?.source) return e.source.replace(/^(https?:\/\/[^/]+\/|git@[^:]+:)/, "").split("/")[0];
  return e?.path ? "custom" : "unknown";
}

// description from the SKILL.md frontmatter, on one line
async function skillDescription(name: string) {
  const md = await Deno.readTextFile(join(skillsDir(), name, "SKILL.md")).catch(() => "");
  const front = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  try {
    return String(parse(front)?.description ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

const list = new Command("list")
  .alias("ls")
  .description("List installed skills with author and description")
  .action(async () => {
    const names = await installedSkills();
    if (!names.length) return console.log(dim("no skills installed"));
    const catalog: Record<string, SkillEntry> = await Deno.readTextFile(configPath())
      .then((s) => parseDocument(s).toJS()?.skills ?? {}, () => ({}));
    const authors = names.map((n) => skillAuthor(catalog[n]));
    const nw = Math.max(...names.map((n) => n.length));
    const aw = Math.max(...authors.map((a) => a.length));
    const cols = Deno.stdout.isTerminal() ? Deno.consoleSize().columns : Infinity;
    for (const [i, n] of names.entries()) {
      const room = cols - nw - aw - 4;
      let desc = await skillDescription(n);
      if (desc.length > room) desc = desc.slice(0, Math.max(room - 1, 0)) + "…";
      console.log(`${bold(n.padEnd(nw))}  ${authors[i].padEnd(aw)}  ${dim(desc)}`);
    }
  });

const remove = new Command("remove")
  .alias("rm")
  .description("Remove skills from ~/.sofa/skills and sofa.yaml")
  .argument("[names...]", "skill names (asks if omitted)")
  .action(async (names) => {
    const doc = await readConfig();
    if (!names.length) {
      if (!interactive()) fail("which skills? pass their names (see sofa skill list)");
      const installed = await installedSkills();
      if (!installed.length) return console.log(dim("no skills installed"));
      names = await pick("Remove which skills?", installed.map((value) => ({ value })));
    }
    for (const n of names) {
      const safe = !/[\\/]|^\.+$/.test(n);
      const onDisk = safe && await Deno.remove(join(skillsDir(), n), { recursive: true }).then(
        () => true,
        (e) => {
          if (e instanceof Deno.errors.NotFound) return false;
          throw e;
        },
      );
      const inConfig = safe && dropSkill(doc, n);
      if (!onDisk && !inConfig) {
        err(`${n}: not installed (see sofa skill list)`);
        continue;
      }
      await writeConfig(doc);
      ok(`${bold(n)} removed`);
    }
  });

export const skill = new Command("skill")
  .description("Manage skills")
  .addCommand(add)
  .addCommand(list)
  .addCommand(remove);
