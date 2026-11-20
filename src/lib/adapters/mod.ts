import { dirname, join, resolve } from "node:path";
import type { McpServer } from "../config.ts";

export type Servers = Record<string, McpServer>;

export interface ApplyResult {
  written: string[]; // names now managed by sofa in this agent
  skipped: string[]; // exist unmanaged -> left alone
  changed: boolean;
}

export interface Adapter {
  id: string;
  label: string;
  path(): string;
  apply(
    servers: Servers,
    owned: string[],
    dryRun: boolean,
  ): Promise<ApplyResult>;
}

export function home(): string {
  const h = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!h) throw new Error("Cannot determine home directory");
  return h;
}

/** Rewrite `${VAR}` references into an agent's own interpolation syntax. */
function envRefs(s: string, wrap: (v: string) => string): string {
  return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, v) => wrap(v));
}
function mapValues(
  o: Record<string, string> | undefined,
  f: (s: string) => string,
) {
  if (!o) return undefined;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}

async function readText(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function writeText(path: string, text: string) {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.sofa-tmp`;
  await Deno.writeTextFile(tmp, text);
  await Deno.rename(tmp, path);
}

/** Remove a folder, then its parent, while they are empty real folders (never home itself). */
export async function pruneEmpty(dir: string) {
  for (const d of [dir, dirname(dir)]) {
    if (resolve(d) === resolve(home()) || !(await Deno.lstat(d).catch(() => null))?.isDirectory) return;
    if (!await Deno.remove(d).then(() => true, () => false)) return; // not empty
  }
}

// a config left with nothing but sofa's emptied section: delete it and its folders if they are empty now
async function removeText(path: string) {
  await Deno.remove(path);
  await pruneEmpty(dirname(path));
}

// ---------- JSON-based agents ----------

interface JsonSpec {
  id: string;
  label: string;
  path: () => string;
  key: string; // top-level key holding the servers
  env: (v: string) => string; // how this agent references env vars
  convert: (s: McpServer, e: (x: string) => string) => unknown;
}

function jsonAdapter(spec: JsonSpec): Adapter {
  const e = (x: string) => envRefs(x, spec.env);
  return {
    id: spec.id,
    label: spec.label,
    path: spec.path,
    async apply(servers, owned, dryRun) {
      const path = spec.path();
      const before = await readText(path);
      let doc: Record<string, unknown> = {};
      if (before !== null && before.trim() !== "") {
        try {
          doc = JSON.parse(before);
        } catch {
          throw new Error(
            `${path} is not plain JSON (comments?) - not touching it`,
          );
        }
      }
      const section = { ...((doc[spec.key] as Record<string, unknown>) ?? {}) };
      for (const n of owned) delete section[n];
      const written: string[] = [];
      const skipped: string[] = [];
      for (const [name, s] of Object.entries(servers)) {
        if (name in section) skipped.push(name);
        else {
          section[name] = spec.convert(s, e);
          written.push(name);
        }
      }
      if (Object.keys(section).length > 0 || spec.key in doc) {
        doc[spec.key] = section;
      }
      const after = JSON.stringify(doc, null, 2) + "\n";
      const changed = before === null ? written.length > 0 : after !== before &&
        JSON.stringify(JSON.parse(before || "{}")) !== JSON.stringify(doc);
      const empty = !Object.keys(section).length && Object.keys(doc).every((k) => k === spec.key);
      if (changed && !dryRun) await (empty ? removeText(path) : writeText(path, after));
      return { written, skipped, changed };
    },
  };
}

function clean<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T;
}

const stdio = (s: McpServer, e: (x: string) => string) => ({
  command: s.command,
  args: s.args?.map(e),
  env: mapValues(s.env, e),
});

const claude = jsonAdapter({
  id: "claude-code",
  label: "Claude Code",
  path: () => join(home(), ".claude.json"),
  key: "mcpServers",
  env: (v) => `\${${v}}`,
  convert: (s, e) =>
    s.url
      ? clean({ type: "http", url: e(s.url), headers: mapValues(s.headers, e) })
      : clean({ type: "stdio", ...stdio(s, e) }),
});

const cursor = jsonAdapter({
  id: "cursor",
  label: "Cursor",
  path: () => join(home(), ".cursor", "mcp.json"),
  key: "mcpServers",
  env: (v) => `\${env:${v}}`,
  convert: (s, e) =>
    s.url
      ? clean({ url: e(s.url), headers: mapValues(s.headers, e) })
      : clean(stdio(s, e)),
});

const gemini = jsonAdapter({
  id: "gemini",
  label: "Gemini CLI",
  path: () => join(home(), ".gemini", "settings.json"),
  key: "mcpServers",
  env: (v) => `\${${v}}`,
  convert: (s, e) =>
    s.url
      ? clean({ httpUrl: e(s.url), headers: mapValues(s.headers, e) })
      : clean(stdio(s, e)),
});

function vscodeDir(): string {
  const h = home();
  switch (Deno.build.os) {
    case "darwin":
      return join(h, "Library", "Application Support", "Code", "User");
    case "windows":
      return join(
        Deno.env.get("APPDATA") ?? join(h, "AppData", "Roaming"),
        "Code",
        "User",
      );
    default:
      return join(h, ".config", "Code", "User");
  }
}

const vscode = jsonAdapter({
  id: "vscode",
  label: "VS Code / Copilot",
  path: () => join(vscodeDir(), "mcp.json"),
  key: "servers",
  env: (v) => `\${env:${v}}`,
  convert: (s, e) =>
    s.url
      ? clean({ type: "http", url: e(s.url), headers: mapValues(s.headers, e) })
      : clean({ type: "stdio", ...stdio(s, e) }),
});

const opencode = jsonAdapter({
  id: "opencode",
  label: "opencode",
  path: () =>
    join(
      Deno.env.get("XDG_CONFIG_HOME") ?? join(home(), ".config"),
      "opencode",
      "opencode.json",
    ),
  key: "mcp",
  env: (v) => `{env:${v}}`,
  convert: (s, e) =>
    s.url
      ? clean({
        type: "remote",
        url: e(s.url),
        headers: mapValues(s.headers, e),
        enabled: true,
      })
      : clean({
        type: "local",
        command: [s.command!, ...(s.args ?? []).map(e)],
        environment: mapValues(s.env, e),
        enabled: true,
      }),
});

// Pi has no built-in MCP; this is the shared config read by the pi-mcp-adapter
// extension (`pi install npm:pi-mcp-adapter`).
const pi = jsonAdapter({
  id: "pi",
  label: "Pi (needs pi-mcp-adapter)",
  path: () =>
    join(
      Deno.env.get("PI_CODING_AGENT_DIR") ?? join(home(), ".pi", "agent"),
      "mcp.json",
    ),
  key: "mcpServers",
  env: (v) => `\${${v}}`,
  convert: (s, e) =>
    s.url
      ? clean({ url: e(s.url), headers: mapValues(s.headers, e) })
      : clean(stdio(s, e)),
});

// ---------- Codex (TOML, marker-delimited block) ----------

const BEGIN = "# >>> sofa managed (do not edit) >>>";
const END = "# <<< sofa managed <<<";
const VAR = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

const tomlStr = (s: string) => JSON.stringify(s);
const tomlKey = (k: string) => /^[A-Za-z0-9_-]+$/.test(k) ? k : tomlStr(k);
const tomlTable = (o: Record<string, string>) =>
  "{ " + Object.entries(o).map(([k, v]) =>
    `${tomlKey(k)} = ${tomlStr(v)}`
  ).join(", ") + " }";

function codexEntry(name: string, s: McpServer): string {
  const lines = [`[mcp_servers.${tomlKey(name)}]`];
  if (s.url) {
    lines.push(`url = ${tomlStr(s.url)}`);
    const literal: Record<string, string> = {};
    const fromEnv: Record<string, string> = {};
    for (const [h, v] of Object.entries(s.headers ?? {})) {
      const bearer = h.toLowerCase() === "authorization" &&
        v.match(/^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
      if (bearer) lines.push(`bearer_token_env_var = ${tomlStr(bearer[1])}`);
      else if (VAR.test(v)) fromEnv[h] = v.match(VAR)![1];
      else literal[h] = v;
    }
    if (Object.keys(literal).length) {
      lines.push(`http_headers = ${tomlTable(literal)}`);
    }
    if (Object.keys(fromEnv).length) {
      lines.push(`env_http_headers = ${tomlTable(fromEnv)}`);
    }
  } else {
    lines.push(`command = ${tomlStr(s.command!)}`);
    if (s.args?.length) {
      lines.push(`args = [${s.args.map(tomlStr).join(", ")}]`);
    }
    const literal: Record<string, string> = {};
    const forward: string[] = [];
    for (const [k, v] of Object.entries(s.env ?? {})) {
      const m = v.match(VAR);
      if (m && m[1] === k) forward.push(k);
      else literal[k] = v;
    }
    if (forward.length) {
      lines.push(`env_vars = [${forward.map(tomlStr).join(", ")}]`);
    }
    if (Object.keys(literal).length) lines.push(`env = ${tomlTable(literal)}`);
  }
  return lines.join("\n");
}

const codex: Adapter = {
  id: "codex",
  label: "Codex",
  path: () =>
    join(Deno.env.get("CODEX_HOME") ?? join(home(), ".codex"), "config.toml"),
  async apply(servers, _owned, dryRun) {
    const path = codex.path();
    const before = await readText(path) ?? "";
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\n?${esc(BEGIN)}[\\s\\S]*?${esc(END)}\\n?`);
    const outside = before.replace(re, "\n");
    const written: string[] = [];
    const skipped: string[] = [];
    const entries: string[] = [];
    for (const [name, s] of Object.entries(servers)) {
      const unmanaged = new RegExp(
        `^\\[mcp_servers\\.(${
          tomlKey(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        })(\\.|\\])`,
        "m",
      );
      if (unmanaged.test(outside)) skipped.push(name);
      else {
        entries.push(codexEntry(name, s));
        written.push(name);
      }
    }
    let after = outside.replace(/\n+$/, "");
    if (entries.length) {
      after += `${after ? "\n\n" : ""}${BEGIN}\n${
        entries.join("\n\n")
      }\n${END}`;
    }
    if (after) after += "\n";
    const changed = after !== before && !(before === "" && after === "");
    if (changed && !dryRun) await (after ? writeText(path, after) : removeText(path));
    return { written, skipped, changed };
  },
};

export const adapters: Record<string, Adapter> = Object.fromEntries(
  [claude, codex, cursor, gemini, opencode, pi, vscode].map((a) => [a.id, a]),
);
