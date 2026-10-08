# blast-radius

A Claude Code mod that holds destructive commands before they run and shows exactly what they would destroy: the files and their size, the commits a push or reset drops, the untracked files a clean removes. You press **Cancel**, **Proceed** or **Allow this session**; Claude gets the reason either way.

> Adapted from [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) (commit `e687416`) by Hamza Zafar, MIT licensed. See [LICENSE](LICENSE). Rewritten here with many more commands, dry-run previews, severity, recovery hints and a new layout.

```
⚠ Deletes files · critical
rm -rf build ~

Would delete 9 files (1.1 MB)
✖ Targets your whole home folder
● 7 tracked by git (restorable) · 2 untracked (gone for good)

  build/chunk-0.js
  build/chunk-1.js
  … and 7 more

[ Cancel ] [ Proceed ] [ Allow this session ]  auto-cancels in 42 s ━━━━━━━━────
```

## What it holds

| Command | Preview | Severity |
|---|---|---|
| `rm -r` / `rm -rf` | every file and the total size, grouped by folder; how many git can restore | high, critical for `/`, `~`, `.git`, `.` |
| `find … -delete` | the same `find` without `-delete` (not previewed when it has `-exec`) | high |
| `git push --force` | remote commits lost and commits pushed, as of the last fetch | high; medium for `--force-with-lease` or nothing lost |
| `git reset --hard`, `git checkout -- …`, `git restore`, `git stash drop/clear` | uncommitted edits discarded, commits leaving the branch, stashes dropped | high |
| `git clean -f…` | git's own dry run (`git clean -n`); warns when `-x` takes ignored files | high |
| `git branch -D` | commits not in HEAD, whether the branch exists on the remote | medium; high when its commits exist nowhere else |
| migrations (prisma, supabase, drizzle, rails, alembic, django, knex, …) | uncommitted migration files | medium; critical for resets that drop data |
| `DROP` / `TRUNCATE` / `DELETE FROM` through a SQL client | the statements | critical |

Previews only read: dry runs, `git log`, `git status`, `du`, `find`. Nothing is changed until you press Proceed.

## Install

```
/plugin install blast-radius@arhun-plugins
```

## Behaviour

- No answer within 60 s cancels the command, so an unattended session never stalls. Set `timeoutSeconds` in `/config` (or `pluginConfigs["blast-radius"].options` in settings); `0` waits forever.
- **Allow this session** runs it and lets the exact same command through for the rest of the session.
- With no screen attached (`claude -p`, an SDK host that draws nothing) it cancels at once: nobody could answer.
- One command is held at a time; a second waits its turn, then gets its own countdown.
- It opens as a pane; where no pane fits it draws above the prompt instead.
- Paths with shell variables (other than `~` and `$HOME`) say "can't preview" rather than guess.

## Files

- `hooks/classify.ts`: which commands are destructive, from the text alone.
- `hooks/measure.ts`: the dry runs and what they find.
- `hooks/view.tsx`: the panel.
- `hooks/register.tsx`: the hold, the countdown, the answers.
- `tests/blast-radius.test.tsx`: `claude plugin test .`
