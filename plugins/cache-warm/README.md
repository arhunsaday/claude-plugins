# cache-warm

A Claude Code mod that watches your conversation's prompt cache from above the prompt: how long it stays warm, how much each reply read from it, what it saved you, and a keep-warm ping that stops it lapsing while you are away. `/cache-warm` shows or hides it.

It starts folded to one line; the chevron or `/cache-warm-collapse` opens it.

Terminal, expanded:

```
♨ Cache · Warm · 42m left of 1h                                        ▾
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──────────────────
Last reply 96% hit · 482k read · 3.1k written
Session    91% hit · 12M read · input −78%
History    ▁▇█████▇██•███
Keep-warm  auto · next ping in 39m · 2 pings, 961k re-read

[ Keep warm ] [ Auto on ]
```

Cooling (the last quarter of the TTL):

```
● Cools in 4m 10s: the next message would rewrite 484k tokens.
[ Keep warm ] [ Auto off ]
```

Collapsed:

```
♨ Cache · Warm · 42m left of 1h ━━━━━━━━━─── 96% hit                    ▸
```

## What it shows

- **Warmth**: time left before the cache lapses, as a bar that drains from full to empty. The TTL runs from when a request *starts*, so a long reply eats into it, and the countdown counts from there too. Warm, then cooling for the last quarter of the TTL, then cold. The TTL (5 minutes or 1 hour) is read from the transcript's usage or the engine's model-switch report; until one says, 1 hour is assumed and the header says so.
- **Last reply**: the share of its input the cache served, and the tokens it read, wrote and sent uncached.
- **Session**: the same over every reply, the input cost against sending everything uncached (a read costs a tenth, a fortieth on Claude Fable 5.1; a write 1.25× for 5m or 2× for 1h), and how many times the cache lapsed between two replies.
- **History**: one bar per reply, its height the hit rate; a dot is a keep-warm ping.
- **Keep-warm**: auto on or off, when the next automatic ping goes out, and what the pings re-read.

## Keep warm

**Keep warm** (`w`, or `/cache-warm-ping`) re-sends the conversation's last request through `$.model.fork` with a one-word prompt after it. The API serves the prefix from the cache, which resets the TTL, at a tenth of the input price (a fortieth on Claude Fable 5.1); nothing is added to your conversation. A turn that is running keeps the cache warm by itself, so a ping waits for it to end.

**Auto** (`a`, or `/cache-warm-auto`) pings by itself 45 s (5m TTL) or 3 min (1h TTL) before the cache would lapse, while no turn runs. It stops after 4 pings in a row (set in the plugin's options) and starts again with your next message, so an empty desk does not keep paying all night.

Without Auto, a toast says when the cache starts cooling and when it went cold. Turn on **Notify when the cache cools** in the plugin's options for a native notification as well.

## Commands

| Command | Does |
|---|---|
| `/cache-warm` | Show or hide the band |
| `/cache-warm-ping` | Keep the cache warm now |
| `/cache-warm-auto` | Turn automatic keep-warm pings on or off |
| `/cache-warm-collapse` | Fold the band to one line, or open it again (the chevron) |
| `/cache-warm-status` | Every figure, the TTL and where it came from, and the keep-warm settings |

The band, the fold and Auto are remembered across sessions. The ping runs on your main model with its thinking settings, so a little output is billed on top of the read. The footer's **Cache** button is hidden for now, as is plan-progress's **Progress** (a decision; `SHOW_FOOTER_BUTTON` in `hooks/register.tsx` brings it back).

## Install

```
/plugin install cache-warm@arhun-plugins
```

## Develop

```bash
claude --plugin-dir plugins/cache-warm
```

```bash
claude plugin test plugins/cache-warm
```
