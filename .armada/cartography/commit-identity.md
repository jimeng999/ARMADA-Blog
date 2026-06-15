# Cartography — commit & deploy identity

Per-repo heuristics learned from fleet runs. `shipwright` should read this before building.

---

## heuristic: always commit as `calumjs@live.com`, never `calum@ssw.com.au`

**Rule.** Every fleet commit in this repo MUST be authored (and committed) as
`Calum Simpson [SSW] <calumjs@live.com>` — the GitHub account `calumjs`. Never use
`calum@ssw.com.au` (the GitHub account `calumssw`). Before committing in a worktree, ensure the
identity is set:

```bash
git config user.name  "Calum Simpson [SSW]"
git config user.email "calumjs@live.com"
```

**Why.** Production deploys go to the Vercel project `northwind-trading`/`armada-blog`, owned by the
`calumjs-projects` team. Vercel's GitHub-integration deploy check maps each commit to the GitHub
account behind its author email and **fails the check** if that account isn't a team member.
`calumssw` is **not** on the team, so any commit authored `calum@ssw.com.au` makes the Vercel check
red (a "@calumssw must be a member" message) even when the build is otherwise perfect. `calumjs` is
on the team, so commits authored `calumjs@live.com` pass.

**Evidence.** Run 2026-06-15, issue #10 / PR #11 ("revert the Northwind rebrand"): the build was
clean (local `build:local` + `astro check` green, muster 0 findings) but the Vercel check was
`FAILURE` purely because the revert commit inherited the machine's global git identity
`calum@ssw.com.au` → `calumssw`. Re-authoring the commit to `calumjs@live.com` and force-pushing the
fleet-owned branch turned the Vercel check green with no code change. The machine's **global** git
config is `calum@ssw.com.au`, so this trap recurs on any fresh checkout — set the repo-local identity
explicitly.

**Confidence.** high (root cause confirmed: same diff, only the author email changed, check flipped
red→green).
