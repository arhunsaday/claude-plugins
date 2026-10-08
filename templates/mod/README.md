# example-mod

A mod is a plugin of function hooks: `hooks/register.tsx` runs inside Claude Code and can draw UI (a band above the prompt, a pane, the status line), react to tool calls and prompts, and register commands.

- `hooks/hooks.json` names the module.
- `types/index.d.ts` declares the values the mod keeps in `$.state`.
- `hooks/*.test.ts` run with `claude plugin test <folder>`.

Develop with `claude --plugin-dir plugins/example-mod`; the folder is watched and reloads on save.
