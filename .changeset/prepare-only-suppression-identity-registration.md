---
"rogue-trader": patch
---

- Guarded the RT funnel-contributor registration by function identity, so a
  foreign module registering the same source-type keys can no longer make the
  RT rows silently vanish.
- Made prepare-only rolls (initiative) structurally exempt from the TestDialog's
  generic condition toggles instead of a handler-maintained key list, closing a
  path that could leak wildcard rows into the initiative parity set.