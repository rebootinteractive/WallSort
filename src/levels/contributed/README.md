# Contributed levels

Every `.json` file in this folder becomes a playable level automatically — no code
changes needed.

## How to add a level

1. Build it in the in-game **Editor** ("+ Create New Level" on the menu).
2. Hit **↓ Download** — you'll get a `your-level-name.json` file.
3. Move that file into this folder (`src/levels/contributed/`).
4. Commit and push. GitHub Pages redeploys and the level shows up in the list.

The editor only lets you download solvable levels: every color count must be a
multiple of 10, and the total number of tiles must equal 10 × (number of separators).
