# assumptions

When something is unclear, Claude asks about the big decisions. For the small ones it quietly picks something and keeps going: a default timeout, a file name, what happens on an empty list. Most of those guesses are right; the wrong ones surface later, when something breaks.

This mod makes them visible. Claude logs each small guess as it makes it, and when the turn ends a strip appears above the prompt:

```
◆ Claude made 6 assumptions · 6 to check                                ▸
```

Open it (the chevron, or `/assumptions-collapse`) and mark each one:

```
◆ Claude made 6 assumptions · 3 to check                                ▾
● #1 Timeout is 30 s · api/client.ts                          right undo
● #2 Retries twice on 5xx · api/client.ts                       fix sent
● #3 Dates shown in UTC                                      right wrong
● #4 Empty list shows "No results" · ui/List.tsx             right wrong
…

[ All right ] [ Clear checked ]
```

Marking one **wrong** sends Claude a prompt on its own: what the guess was and where, to fix only what depends on it, and the guesses you marked **right** to keep as they are. You do not have to explain the problem; if the right choice is not clear, Claude asks.

## How Claude logs

The mod registers a tool, `assumption_log`, and adds a short rule to the system prompt: when Claude decides something the user left open instead of asking, it logs one line (what it assumed, and the file or area). The tool sits in the prompt's tool list, not behind ToolSearch, so a guess is logged in passing.

## What it costs

- The rule and the tool's schema: a few hundred tokens of system prompt, cached with the rest of it.
- Each logged guess: one small tool call, about 60 to 100 output tokens.
- Marking right: nothing. Marking wrong: one turn, the fix you would have asked for anyway.

## Commands

| Command | Does |
|---|---|
| `/assumptions` | Open the full list as a pane |
| `/assumptions-right 1 3` | Mark by number, or `all` |
| `/assumptions-wrong 2` | Mark wrong by number; Claude gets a fix prompt for each |
| `/assumptions-clear` | Remove the checked ones |
| `/assumptions-collapse` | Fold the strip to one line, or open it (it starts folded) |

Nothing is written to the repository: the list lives in the session and goes with `/clear`. The fold is remembered across sessions.

## Install

```
/plugin install assumptions@arhun-plugins
```
