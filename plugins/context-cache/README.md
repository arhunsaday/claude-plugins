# context-cache

A Claude Code mod that puts your context window, your usage limits and your prompt cache above the prompt. It is drawn with Claude Code's own elements and theme colours (no card or background), and folds to a single line with the chevron.

> Adapted from [Christandoh/context-cache](https://github.com/Christandoh/context-cache) (commit `2afa4e8`) by Chris Tandoh, MIT licensed. See [LICENSE](LICENSE). Changes here: a theme-native layout in place of the fixed dark SVG card, a collapse chevron and `/cache-collapse`, and the band keeps whatever the host or other mods draw below it.

```
Context  ━━━━━━━━━━━━━━━━━━━──────────│───────  48% · 484k of 1M · auto-compact at 80%   ▾
         ● System 20k  ● Tools 30k  ● Files 100k  ● Messages 334k  Free 516k
Session  ━━━━━━━━━━━━━━━━━━━━━━━━──────────────  34% · resets in 2h 0m · 60% of window gone
Weekly   ━━━━━━━━━━━━━━━━━──────────────────────  26% · resets Mon 2:00 pm · 43% of window gone
Fable    ━━━━━─────────────────────────────────  10% · resets Mon 2:00 pm
Cache    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  Warm · 59m left of 60m · hit 98%
● Cache warm: next message reuses 484k from cache.                         [ Clear ] [ Compact ]
```

Collapsed:

```
Context 48% ━━━━━───│─ · Session 34% · Weekly 26% · Fable 10% · Cache warm 59m left   ▸
```

## Install

```
/plugin install context-cache@arhun-plugins
```

If you installed the upstream copy (`context-cache@chris-mods`), uninstall it first so the two don't both draw.

## Reading it

- **Context**: tokens used out of the window, split into System, Tools, Files and Messages, with a tick where auto-compact fires.
- **Session / Weekly / Fable**: the bright part is how much of the limit you've used; the faint part behind it is how much of the window's time has passed. Green when on pace, amber when you're well ahead of the time, red from 90%.
- **Cache**: how much of the prompt cache's time-to-live is left (Warm above 25%, Cooling, Cold), with the last reply's cache hit rate.
- The last row says what the next message will cost the cache, with **Clear** (`/clear`) and **Compact** beside it.

Rows give way as the band narrows: the trailing detail first, then the legend; a band too short for the panel shows the one-line summary.

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
- `hooks/model.ts`: the maths, thresholds, copy and layout decisions; no drawing.
- `hooks/view.tsx`: the one layout, with text bars on the terminal and thin SVG bars elsewhere.
- `hooks/view.test.tsx`: `claude plugin test .` mounts the band on terminal and desktop.
- `types/index.d.ts`: the mod's `$.state` contract.
