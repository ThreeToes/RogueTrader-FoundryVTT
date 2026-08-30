# This Project

This project is to create a system for FoundryVTT for the Rogue Trader RPG.

# General rules

- Write unit tests where approriate
- Follow existing patterns
- Use `bun run build` to test application builds, do not hack together bash,
  typescript, javascript or python scripts to try and test the compile
- Use `bun run lint` before declaring any typescript changes done
- When implementing UIs, always make sure the window is resizable
- When modifying i18n strings, update all different translations
- **DO NOT** invoke bash if you have a tool available to achieve your goal
- **DO NOT** invoke bash or write scripts to edit files, use built in
  editing tools instead

## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Review available tools for details.

### Rules

- Use beads for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists

## Agent Context Profiles

Agent onboarding: see [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md) and the visual
conventions in [docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md). Before closing UI or
lifecycle beads, run the manual pass in [docs/QA-CHECKLIST.md](docs/QA-CHECKLIST.md).

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.
