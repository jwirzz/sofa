/** The `sofa` skill that `sofa init` installs into ~/.sofa/skills/sofa and enables in `base`. */
export const DEFAULT_SKILL_NAME = "sofa";

export const DEFAULT_SKILL = `---
name: sofa
description: Manage the user's sofa setup (~/.sofa): add, remove or list skills and MCP servers, edit environments, and activate them for a project or globally. Use when the user asks to install a skill, add an MCP server, change which skills/MCPs are active, or edit sofa.yaml.
---

# Managing sofa

sofa keeps the skills and MCP servers of all the user's AI agents in one git repo, \`~/.sofa\` (or \`$SOFA_HOME\`). Prefer the \`sofa\` CLI over editing files by hand; run \`sofa --help\` or \`sofa <command> --help\` for the current flags.

## Layout

- \`sofa.yaml\`: shared config (synced with git). Catalog of \`mcps\` and \`skills\`, plus \`environments\` that only reference catalog names.
- \`sofa.local.yaml\` and \`skills.local/\`: same format, gitignored, layered on top. Local entries win by name; environments of the same name are merged.
- \`skills/\`: custom skill folders, referenced as \`{ path: ./skills/<name> }\`.

## Commands

- \`sofa skill add <owner/repo> [-s <skill>] [-e <env>] [-l]\`: install from a package (e.g. \`anthropics/skills -s docx\`)
- \`sofa skill add <./path> [-e <env>] [-l]\`: copy your own skill folder in
- \`sofa skill list\` / \`sofa skill rm [names...] [-l]\`
- \`sofa mcp list\`: MCPs and where they are written
- \`sofa env list\`: environments and where they are active
- \`sofa env edit [name] [-l]\`: pick skills and MCPs for an environment (interactive)
- \`sofa env use [names...] [-g]\`: activate environments in the current project, or globally with \`-g\` (only \`-g\` writes MCPs into agent configs)
- \`sofa env off [-g]\`: remove everything sofa set up there
- \`sofa migrate [-l]\`: import skills from \`npx skills\`

Use \`-l/--local\` when the user wants something kept out of git.

## Adding an MCP server

There is no \`sofa mcp add\`; edit \`sofa.yaml\` (or \`sofa.local.yaml\`):

\`\`\`yaml
mcps:
  playwright:            # stdio server
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
  github:                # remote server
    url: https://api.githubcopilot.com/mcp/
    headers: { Authorization: "Bearer \${GITHUB_TOKEN}" }
environments:
  base:                  # always active
    mcps: [playwright]
\`\`\`

Never write secrets into \`sofa.yaml\`; reference environment variables with \`\${VAR}\`, or put the entry in \`sofa.local.yaml\`. Optional fields: \`env\`, \`only\` (restrict to listed agents).

## After changes

Changes only take effect once applied: run \`sofa env use\` (project) or \`sofa env use -g\` (global), then verify with \`sofa env list\`. If the config is synced, the user commits and pushes \`~/.sofa\` themselves; don't do it unasked.
`;
