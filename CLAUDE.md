# claude-plugins

A Claude Code plugin marketplace (`arhun-plugins`). Each plugin lives in `plugins/<name>/` and is listed in `.claude-plugin/marketplace.json`.

## Rules

- One plugin per folder under `plugins/`. Its `name` in `plugin.json` matches the folder name and its marketplace entry.
- `version` lives in the plugin's `plugin.json` only, not in the marketplace entry. Bump it (semver) with every user-visible change.
- Keep the marketplace entry's `description` in step with `plugin.json`.
- New plugins start from `scripts/new-plugin.sh <name> [plugin|mod]`, which copies `templates/`.
- Plugins adapted from other repositories keep their upstream `LICENSE` and credit the source in their README.
- Mods (function hooks): read `hooks/register.tsx`, its `types/index.d.ts` contract and the plugin-authoring skill before editing. Every `$.state` key must be declared in the contract.

## UI conventions for mods

Every mod should look like part of the same set, and like part of Claude Code:

- **No card**: no border, no background, no padding around the mod. Draw with the host's own `Box`, `Text`, `Button` and `Code`.
- **Colours**: theme keys only for text (`success`, `warning`, `error`, `suggestion`, `claude`, `merged`, `inactive`), so light and dark themes both work. An `Svg` (desktop only, when text can't do it) has a transparent background and switches text and track colours with `prefers-color-scheme`.
- **Header row**: a coloured glyph, a **bold** title, then dim detail after ` · `. In a band, the fold chevron sits at the end of that row: `▾` open / `▸` folded on the terminal, the Lucide chevron chip on the desktop (see plan-progress and context-cache).
- **Hierarchy**: default text for content, `dimColor` for labels and secondary detail, `bold` only for titles and key figures. Status dots are `● ` in the status colour.
- **Spacing**: no blank rows inside a section; one (`rowGap={1}`) between sections. Label columns have a fixed width so values line up.
- **Buttons**: on their own row under the content, left-aligned, `columnGap={1}`; the main or safe action first with `variant="primary"`; one-letter `hotkey`s.
- **Folding**: a band that takes more than two rows can fold to one line, by the chevron and a `/<mod>-collapse` command, and remembers it in `$.store`.
- **Sharing the band**: draw yours and keep what `next(e)` returns, stacked with `rowGap={1}`.
- **Desktop SVG sizes**: Helvetica Neue / Helvetica / Arial; 13 px bold titles, 12.5 px body, 11.5 px secondary, 10.5 px captions; capped at 520 px wide.

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
