#!/bin/zsh
cd "$(dirname "$0")"
echo "Paste an Obsidian URL or Markdown file path, then press Enter:"
read ARTICLE
node bin/publish-obsidian.js "$ARTICLE"
echo
echo "Done. Press Enter to close."
read _
