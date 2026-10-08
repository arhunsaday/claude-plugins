# context-cache

A Claude Code mod that puts your context window, your usage limits and your prompt cache above the prompt: a context bar with its legend, a ring per limit (session, weekly, Fable) and one for the cache, a notice about what the next message costs, and Clear / Compact. No card or background; text follows your light or dark theme. Hover a ring on the desktop for its reset time and details. The chevron folds it to one line.

> Adapted from [Christandoh/context-cache](https://github.com/Christandoh/context-cache) (commit `2afa4e8`) by Chris Tandoh, MIT licensed. See [LICENSE](LICENSE). Changes here: the ring layout at every width (upstream switched to bar columns above ~500 px), drawn without the card and theme-aware, a collapse chevron and `/cache-collapse`, hover details on the rings, and the band keeps whatever the host or other mods draw below it.

Terminal, expanded:

```
Context 92k / 1M (9%) ━━━━━────────────────────────────│── 92%   ▾
● System 6k  ● Tools 21k  ● Files 15k  ● Messages 50k  Free 908k

◷ 9%              ▦ 14%             ✦ 2%              ♨ Warm
  Time 12%          Time 14%          Time 14%          95% warm

● Cache warm: next message reuses 92k from cache.
[ Clear ] [ Compact ]
```

Collapsed:

```
Context 9% ━━──────│─   ◷ 9%  ▦ 14%  ✦ 2%  ♨ Warm 57m left   ▸
```

## Install

```
/plugin install context-cache@arhun-plugins
```

If you installed the upstream copy (`context-cache@chris-mods`), uninstall it first so the two don't both draw.

## Reading it

- **Context**: tokens used out of the window, split into System, Tools, Files and Messages, with a tick where auto-compact fires.
- **Session / Weekly / Fable** rings: the bright arc is how much of the limit you've used, the faint arc and the notch how much of the window's time has passed ("Time"). Each keeps its colour (green, blue, purple) while on pace, turns amber when you're well ahead of the time, red from 90%.
- **Cache** ring: how much of the prompt cache's time-to-live is left (Warm above 25%, Cooling, Cold); hover for minutes left and the last hit rate.
- The last row says what the next message will cost the cache, with **Clear** (`/clear`) and **Compact** beside it.

Below about 360 px the legend and the ring captions drop; a band too short for the panel shows the one-line summary.

## Commands

- `/cache` hides or shows the panel.
- `/cache-collapse` folds it to one line or opens it again (the same as the chevron). The choice is kept across sessions.
- `/cache-pane` opens the panel as a pane, on any device (how it shows on the phone).
- `/cache-refresh` re-reads usage now.
- `/cache-status` prints where each figure came from and writes the full report to `context-cache-status.json` in the working directory.

## Where the numbers come from

| Figure | Source |
|---|---|
| Context used, window, auto-compact point | `$.session.usage()`, the same figures as the status line and `/context` |
| System / Tools / Messages split | the `/context` breakdown, scaled to the real token count |
| Files | the share of Messages that is `Read` output, by character count |
| Session and weekly limits | the rate-limit headers of every reply; when the account endpoint describes the same window, the higher reading |
| Fable, and reset times a header lacks | the account usage endpoint (`api.anthropic.com/api/oauth/usage`), called through Claude Code with the session's own login (the mod never sees the token); at session start, every 5 minutes, and on `/cache-refresh` |
| Cache TTL (5m or 60m) | the `cache_creation` usage of the last response in the transcript, or Claude Code's report on a model switch; remembered across sessions |
| Last cache write, hit % | each main-conversation reply as it arrives |

The weekly and Fable figures rely on an endpoint Anthropic hasn't documented. If it changes, Fable shows "no data" and the rest keeps working.

## Files

- `hooks/register.tsx`: data collection, commands, the band and the pane.
- `hooks/model.ts`: the maths, thresholds and copy; no drawing.
- `hooks/panel-svg.ts`: the desktop panel and collapsed line as SVG, measured with `hooks/metrics.ts`.
- `hooks/view.tsx`: the terminal layout, and the desktop's SVG with the host's buttons and chevron.
- `hooks/view.test.tsx`: `claude plugin test .` mounts the band on terminal and desktop.
- `types/index.d.ts`: the mod's `$.state` contract.
