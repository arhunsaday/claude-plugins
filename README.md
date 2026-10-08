# arhun-plugins

A [Claude Code](https://code.claude.com) plugin marketplace: mods, skills, commands, agents and hooks.

## Install

Add the marketplace once:

```
/plugin marketplace add arhunsaday/claude-plugins
```

Then install any plugin from it:

```
/plugin install <plugin>@arhun-plugins
```

From a shell, `claude plugin marketplace add arhunsaday/claude-plugins` and `claude plugin install <plugin>@arhun-plugins` do the same.

## Plugins

| Plugin | Kind | What it does |
|---|---|---|
| [plan-progress](plugins/plan-progress) | mod | Live plan progress bars above the prompt, with agent strips you can fold and soft sounds. |
| [where-am-i](plugins/where-am-i) | mod | A live recap above the prompt: goal, what Claude is doing now, next step, what waits on you. |
| [blast-radius](plugins/blast-radius) | mod | Holds destructive commands and shows what they would destroy before they run. |
| [context-cache](plugins/context-cache) | mod | Context usage, usage limits and prompt-cache warmth above the prompt, as rings; collapses to one line. |

## Layout

```
.claude-plugin/marketplace.json   the catalog: one entry per plugin
plugins/<name>/                   one folder per plugin
  .claude-plugin/plugin.json      manifest (name, version, description, ...)
  skills/<skill>/SKILL.md         skills
  commands/*.md                   slash commands
  agents/*.md                     subagents
  hooks/hooks.json                shell hooks, or { "modules": [...] } for a mod
  .mcp.json                       MCP servers
  types/index.d.ts                a mod's $.state contract
templates/plugin/                 starter for a skills/commands/agents/hooks plugin
templates/mod/                    starter for a mod (function hooks that draw UI)
scripts/new-plugin.sh             scaffolds a plugin from a template and lists it
```

## Adding a plugin

```bash
scripts/new-plugin.sh my-plugin          # skills, commands, agents, hooks, MCP
```

```bash
scripts/new-plugin.sh my-mod mod         # a mod
```

Then fill in the placeholders, delete the components you don't need, and check it:

```bash
claude plugin validate .
```

## Developing

Run a plugin straight from its folder; edits reload on save:

```bash
claude --plugin-dir plugins/context-cache
```

Or add this checkout as a marketplace, so installs read from the folder and `/reload-plugins` picks up edits:

```bash
claude plugin marketplace add ./
```

Bump `version` in a plugin's `plugin.json` when you release a change; `claude plugin update` only fetches a new version.

## Licence

MIT, see [LICENSE](LICENSE). Plugins adapted from other projects keep their own licence file and credit the original authors in their README.
