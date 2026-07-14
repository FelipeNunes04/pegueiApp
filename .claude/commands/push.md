---
description: Push the current branch to origin (never force, never to main without confirmation)
---

1. Run `git status` to confirm the branch and check it's not behind/diverged from `origin` in a way that needs attention first.
2. Run `git log --oneline @{u}..` (or equivalent) to show what's about to be pushed.
3. Push with a plain `git push` (add `-u origin <branch>` only if the branch has no upstream yet).
4. **Never use `--force`/`--force-with-lease`** from this command, and never push straight to `main` without explicitly confirming with the user first — if the current branch is `main`, stop and ask before pushing.
5. Confirm the push succeeded and report the resulting remote state.
