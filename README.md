# sofa (simple one-file agent configuration)

```
 .-="""""""""""=-.
 | . . . . . . . |                __
 | .'.'.'.'.'.'. |     ___  ___  / _| __ _
()_______________()   / __|/ _ \| |_ / _` |
||_______________||   \__ \ (_) |  _| (_| |
 W               W    |___/\___/|_|  \__,_|
```

sofa manages the skills and MCP servers of your AI coding agents from one file. You install them once, group them into environments, and sofa sets them up for Claude Code, Cursor, Codex and others, in a single project or globally.
## Install
```sh
curl -fsSL https://raw.githubusercontent.com/jwirzz/sofa/main/install.sh | sh
```

Installs to `~/.sofa/bin` pin a version with `SOFA_VERSION=v0.1.0`.

## Usage
```sh
sofa <command> [options]
```

```sh
sofa init [--from <url>]   # create ~/.sofa with sofa.yaml

sofa skill add <owner/repo> [-s <skill>] [-e <env>]   # skills from npx skills (e.g. anthropics/skills -s docx)
sofa skill add <./path> [-e <env>]      # your own skill folder, copied into ~/.sofa/skills
sofa skill list                         # installed skills with author
sofa skill rm [names...]                # remove skills
sofa migrate                            # import skills from `npx skills`

sofa mcp list                           # MCPs from sofa.yaml and where they are written

sofa env list                           # environments and where they are active
sofa env edit [name]                    # pick skills and MCPs for an environment
sofa env use [names...] [-g]            # link skills (project, or globally with -g; -g also writes MCPs)
sofa env off [-g]                       # remove everything sofa set up there

sofa coverup [--here] [--undo]          # keep AI agents out of commit messages
```

MCPs are added in `~/.sofa/sofa.yaml`:

```yaml
mcps:
  playwright:
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
  github:
    url: https://api.githubcopilot.com/mcp/
    headers: { Authorization: "Bearer ${GITHUB_TOKEN}" }
environments:
  base:
    mcps: [playwright]
```
## Local config

Anything you don't want to share through git goes in `~/.sofa/sofa.local.yaml` (same format as `sofa.yaml`) and `~/.sofa/skills.local/`. Both are gitignored and layered on top of the shared config: local MCPs and skills win by name, and environments of the same name are merged.

The commands that edit the config take `-l, --local` to write there instead: `sofa skill add -l`, `sofa skill rm -l`, `sofa env edit -l`, `sofa migrate -l`.
