# where-am-i

A Claude Code mod that keeps a one-glance recap above the prompt: the session's goal, what Claude is doing right now, what's next, and what waits on you. Made for coming back to a session after a break, or keeping several in your head.

> Adapted from [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) (commit `e687416`) by Hamza Zafar, MIT licensed. See [LICENSE](LICENSE). Changed here: a new aligned layout, the live activity with a working dot, the goal shown from your first message before any recap, elapsed time and turn count, folding, no model call for trivial turns, and no dependency on other mods.

```
◆ Goal   Rebuild the context-cache panel as rings        12m · 4 turns  ▾
  Now    ● editing hooks/panel-svg.ts
  You    ⏳ choose whether to keep the card background
```

Between turns, **Now** shows what was just done (✓) and **Next** the next step. Folded:

```
◆ Rebuild the context-cache panel as rings  ·  ● editing hooks/panel-svg.ts  ▸
```

## Install

```
/plugin install where-am-i@arhun-plugins
```

## How it works

- While Claude works, **Now** follows its tool calls live ("editing hooks/view.tsx", "running the tests"). No model call for that.
- After each turn, one small Haiku call rewrites the recap from your message, the tools used and the reply. A turn with no tools and a short reply (a thank-you, a quick answer) skips it.
- Until the first recap, your latest message stands in as the goal, dimmed.
- The time beside the goal counts from when that goal was set; a new goal restarts it.

## Commands

- `/where`: a longer recap in a few bullets, from the last messages.
- `/where-collapse`: fold it to one line, or open it again (the same as the chevron). Kept across sessions.
