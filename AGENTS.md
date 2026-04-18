# Copilot Dojo

A toolkit for testing, evaluating, and improving AI agent skills in
sandboxed environments. Provides a CLI for running evaluations and an
MCP server for agent interaction.

## Critical constraints

- All commits must follow [Conventional Commits](https://www.conventionalcommits.org/).
  Commitlint enforces this via a husky `commit-msg` hook.
- Husky `pre-commit` hook runs `npm run lint && npm test`. Both must
  pass before a commit is accepted.

## Architecture

| Component       | Location | Responsibility                              |
|-----------------|----------|---------------------------------------------|
| CLI             | `src/`   | Commander-based CLI for running evaluations  |
| MCP Server      | `src/`   | FastMCP server for agent interaction         |
| Sandbox Runtime | `src/`   | Anthropic sandbox runtime for isolated execution |

**Key dependencies:**

- `commander` -- CLI framework
- `fastmcp` -- MCP server
- `@anthropic-ai/sandbox-runtime` -- sandboxed execution
- `@github/copilot-sdk` -- Copilot integration
- `zod` -- schema validation

### Data flow

CLI commands trigger evaluation runs -> sandbox runtime spins up
isolated environments -> agents interact via MCP server -> results
are collected and reported.

## Development flow

| Task          | Command                |
|---------------|------------------------|
| Install deps  | `npm install`          |
| Build         | `npm run build`        |
| Run tests     | `npm test`             |
| Test (watch)  | `npm run test:watch`   |
| Coverage      | `npm run test:coverage`|
| Type check    | `npm run typecheck`    |
| Lint          | `npm run lint`         |
| Full check    | `npm run check`        |
| Run CLI       | `npx tsx src/`         |

## Directory context (`AGENTS.md`)

No directory-level `AGENTS.md` files exist yet. As the project grows,
create them in directories that develop their own domain, patterns, or
conventions. When you create one, add a pointer here.

## Maintaining documentation

You are responsible for keeping all `AGENTS.md` files accurate as a
byproduct of your normal work. Documentation updates go in the same
commit or PR as the code change.

**Task priority:** Complete your primary task first. Documentation
updates are a byproduct, not a blocker.

**Quality bar:** Only document concrete findings from actual work. The
test: "Would a future agent working here likely get tripped up without
this?" If yes, document it. If no, skip it.

### When to create

- You work in a directory that has its own domain or patterns but no
  `AGENTS.md`: create one with what you learned.
- You add a new `AGENTS.md`: add a pointer to the table above.
- You remove or move an `AGENTS.md`: update the pointer.

### When to update

- You find an instruction that contradicts reality: fix it immediately.
- You discover a gotcha for a single file: add a block comment at the
  top of that file.
- You discover a gotcha for a module: add it to the nearest `AGENTS.md`.
- You change build, test, or dev commands: update the development flow
  table above.
- You add a significant component or service: update the architecture
  section above.

### Self-correction

When you notice a claim in any `AGENTS.md` that contradicts what the
code actually does: fix the documentation. Code is the source of truth.
If ambiguous, ask the human.

### Decision records

When a human makes a technical judgment call during your session, record
it in the nearest `AGENTS.md` with: what was decided, alternatives
considered, why this choice was made, and when to revisit.
