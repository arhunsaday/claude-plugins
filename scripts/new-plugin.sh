#!/usr/bin/env bash
# Scaffold plugins/<name> from a template and list it in the marketplace.
# Usage: scripts/new-plugin.sh <name> [plugin|mod]
set -euo pipefail

name="${1:-}"
kind="${2:-plugin}"
root="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "usage: $0 <kebab-case-name> [plugin|mod]" >&2
  exit 1
fi
if [[ "$kind" != "plugin" && "$kind" != "mod" ]]; then
  echo "kind must be 'plugin' or 'mod'" >&2
  exit 1
fi

dest="$root/plugins/$name"
if [[ -e "$dest" ]]; then
  echo "$dest already exists" >&2
  exit 1
fi

cp -R "$root/templates/$kind" "$dest"
grep -rl "example-$kind" "$dest" | while IFS= read -r f; do
  sed -i '' "s/example-$kind/$name/g" "$f"
done

node -e '
const fs = require("fs")
const [file, name] = process.argv.slice(1)
const m = JSON.parse(fs.readFileSync(file, "utf8"))
m.plugins.push({ name, source: `./plugins/${name}`, description: "TODO: one line" })
m.plugins.sort((a, b) => a.name.localeCompare(b.name))
fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n")
' "$root/.claude-plugin/marketplace.json" "$name"

echo "Created plugins/$name ($kind) and listed it in .claude-plugin/marketplace.json"
echo "Next: edit its description in both plugin.json and marketplace.json, then run: claude plugin validate plugins/$name"
