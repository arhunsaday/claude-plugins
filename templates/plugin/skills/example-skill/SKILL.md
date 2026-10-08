---
name: example-skill
description: Say what this skill does and when Claude should use it. Claude reads this line to decide whether to load the skill, so name the triggers ("Use when ...").
---

# Example skill

Replace this with the instructions Claude follows once the skill is loaded.

- Keep it focused on one job.
- Put long reference material in sibling files (`reference.md`) and link to them, so it loads only when needed.
- Bundle helper scripts next to this file and call them as `${CLAUDE_PLUGIN_ROOT}/skills/example-skill/<script>`.
