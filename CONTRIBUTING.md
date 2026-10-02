# Contributing

## Developer Tooling

This repository leverages [Bun](https://bun.sh/) to run automated build tasks. Run the following commands from the root of the project to get set up:

### `bun install`

Installs all dependencies needed to run developer tooling scripts.

### `bun run build`

Runs all relevant build scripts (listed below).

### `bun run build:css`

Builds the final `rogue-trader.css`.

### `bun run watch`

Runs the builder in watch mode so that changes made to the source files are automatically rebuilt.

### `bun run hooks:install`

Git hooks are not versioned by default, so pointing this clone at the committed
ones is a one-time, per-clone step: run `bun run hooks:install` (which runs
`git config core.hooksPath .githooks`). Until you do, no pre-commit checks
run locally and nothing stops a red state from being committed the way CI
does — bypass the checks deliberately with `git commit --no-verify`.

## Code

Here are some guidelines for contributing code to this project.

To contribute code, [fork this project](https://docs.github.com/en/get-started/quickstart/fork-a-repo) and submit a [pull request (PR)](https://docs.github.com/en/get-started/quickstart/contributing-to-projects#making-a-pull-request) against the correct development branch.

### Style

Please attempt to follow code style present throughout the project. The project lints with Biome: run `bun run lint` to lint and `bun run format` to format. All warnings presented by `bun run check` should be resolved before an PR is submitted.

- `bun run lint` - Run the linter and display any issues found.
- `bun run format` - Write formatting fixes (formatting only; does not apply lint fixes).
- `bun run check --write` - Run the full Biome check (lint + format) and automatically apply fixes.
- `bun run check` - Run the full Biome check (lint + format) over the project.
