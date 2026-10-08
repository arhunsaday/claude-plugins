# plan-progress

Live progress bars above the Claude Code prompt. Claude splits a task into stages and steps, and the bar fills as it works. The subagents for each task are listed under its bar.

![plan-progress: two tasks with their agents, a question, an error, a plan rewritten mid-run, both tasks done](https://raw.githubusercontent.com/zycck/claude-mods/main/media/plan-progress.gif)

> Adapted from [zycck/claude-mods](https://github.com/zycck/claude-mods) (commit `3539d02`) by Kirill Serditov, MIT licensed. See [LICENSE](LICENSE).

- One row per task: state, title, bar, percent, close button
- The pill on the bar shows the current stage and step; hover it for the time spent so far
- Stages are capsules, steps are dots; hover one to see when it was reached
- A finished bar turns green and shows the total time, then leaves after 30 s (`doneBarSeconds` in `/config`)
- Four states: running, needs input, error, done
- Each subagent gets a row under its task: name, model and effort, current tool, time; fold them with the chevron
- The plan can change mid-run; finished steps are kept by title
- Bars are saved per session and come back when the session is resumed
- Short sounds for a question, an error and completion
- Works in the desktop app and in the terminal

## Install

Requires Claude Code 2.1.286 or newer.

```
/plugin install plan-progress@arhun-plugins
```

If you installed the upstream copy (`plan-progress@zycck-mods`), uninstall it first so the two don't both draw bars.

## Commands

- `/progress` shows or hides the bars
- `/progress-clear` removes all bars
- `/progress-agents` folds the agent strips under the bars, or shows them again (the chevron next to a bar's ✕ does it for that bar)
- `/plan-progress-autoclose` turns off finished bars leaving on their own, or turns it back on; the choice is kept across sessions

The **Progress** button in the footer does the same as `/progress`.

## How it works

The mod registers a `plan_progress` tool. Claude sends the plan once, then short updates such as `{id, next: true}` or `{id, done: ["Routes"]}`. An unknown step name is refused with the list of the bar's steps. A plan approved in plan mode becomes the bar `plan`. Agent rows come from engine events and cost no tokens.

On the desktop the bar is an SVG image with a hover layer on top. In the terminal it is a character grid that animates only while Claude is working.

## Tests

See [tests/README.md](tests/README.md): the real module driven against a stub engine.
