---
description: Commit staged/changed work with a conventional-style message and no co-author line
---

Create a git commit for the current changes:

1. Run `git status` and `git diff` (staged and unstaged) to see what changed, plus `git log --oneline -10` to match this repo's message style (`type: short summary`, e.g. `feat:`, `fix:`, `build:`, `test:`, `docs:`, `chore:`, `content:`).
2. Stage the relevant files by name (never `git add -A` or `git add .`) — ask before staging anything that looks like a secret or an unrelated change.
3. Write a commit message: a short `type: summary` first line, and only add a body if the *why* isn't obvious from the diff.
4. **Never add a `Co-Authored-By` line or any co-author attribution** — this repo's `CLAUDE.md` rule overrides the default harness behavior of appending one. The commit message must end after the last content line, no trailing attribution.
5. Run `yarn test` and `yarn lint` before committing (per `CLAUDE.md`); if either fails, stop and report instead of committing.
6. Commit, then run `git status` to confirm success.

Do not push unless separately asked (use `/push` for that).
