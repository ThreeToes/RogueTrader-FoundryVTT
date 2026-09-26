# Changesets

Each `.md` file in this directory records one user-visible change. At release
time the largest level present picks the version bump and every body becomes
a dotpoint on the release page.

## Format

Filename: descriptive kebab-case, e.g. `shared-psyker-gate.md`.

```markdown
---
"rogue-trader": minor
---

- Shared the psyker gate into one predicate.
```

- Frontmatter key: the system slug (`rogue-trader`). Value: `major`,
  `minor`, or `patch` — literal semver, largest wins, one version for all
  in-flight changesets.
- Body: one or more bullets. Each becomes a release dotpoint, so write the
  sentence you want on the release page.

## Rule

Never describe `src/packs` content in a changeset. The release body is
mirrored verbatim to the public GitHub release, which ships no packs — a
pack mention would leak into a public page.

See `.agents/skills/changesets/SKILL.md` for when to add one.