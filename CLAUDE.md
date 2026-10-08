# claude-plugins

A Claude Code plugin marketplace (`arhun-plugins`). Each plugin lives in `plugins/<name>/` and is listed in `.claude-plugin/marketplace.json`.

## Rules

- One plugin per folder under `plugins/`. Its `name` in `plugin.json` matches the folder name and its marketplace entry.
- `version` lives in the plugin's `plugin.json` only, not in the marketplace entry. Bump it (semver) with every user-visible change.
- Keep the marketplace entry's `description` in step with `plugin.json`.
- New plugins start from `scripts/new-plugin.sh <name> [plugin|mod]`, which copies `templates/`.
- Plugins adapted from other repositories keep their upstream `LICENSE` and credit the source in their README.
- Mods (function hooks): read `hooks/register.tsx`, its `types/index.d.ts` contract and the plugin-authoring skill before editing. Every `$.state` key must be declared in the contract.

## Check before committing

```bash
claude plugin validate .
```

```bash
claude plugin validate plugins/<name>
```

```bash
claude plugin test plugins/<name>
```
