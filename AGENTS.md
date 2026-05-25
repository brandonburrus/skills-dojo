# Dojo

A CLI toolkit for testing, evaluating, and improving AI agent skills.
Skills follow the [agentskills.io specification](https://agentskills.io/specification).

## Critical constraints

- All commits must follow [Conventional Commits](https://www.conventionalcommits.org/).
  Commitlint enforces this via a husky `commit-msg` hook.
- Husky `pre-commit` hook runs `npm run lint && npm test`. Both must
  pass before a commit is accepted.
- Zod v4 is used throughout -- import from `zod/v4`, not `zod`.
- Always work from a feature branch. Use `feat/<description>` for new
  features and `fix/<description>` for patches (e.g. `feat/new-feature-thing`,
  `fix/patch-this-thing`). Never commit directly to `main`.

## Architecture

```
src/
  index.ts              CLI entry point (commander)
  types.ts              Shared domain types (inferred from Zod schemas)
  errors.ts             Typed error hierarchy (DojoError base)
  schemas/              Zod validation schemas (config, skill, eval, report)
  loaders/              Discovery + parsing (config, skills, evals)
  providers/            Evaluator/Judge abstractions + implementations
    types.ts            Evaluator + Judge interfaces
    factory.ts          createEvaluator + createJudge dispatchers
    shared/             Cross-provider helpers (system messages)
    copilot/            Copilot SDK implementation
    openai/             OpenAI Chat Completions implementation
    anthropic/          Anthropic Messages API + Judge implementation
    vercel/             Vercel AI SDK implementation (meta-SDK with model routing)
  runner/               Eval execution logic (provider-agnostic)
    selection.ts        Selection eval runner
    effectiveness.ts    Effectiveness eval runner (matrix expansion + judging)
    sandbox/            Subprocess sandbox for effectiveness evals
      harness.ts        Temp dir lifecycle, fixture copy, fs-diff
      fs-diff.ts        Filesystem snapshotting and diff computation
      agent-runner.ts   Subprocess entry point (spawned per eval run)
  output/               CLI output formatting (tables)
  commands/             CLI command handlers (validate, list, run)
  utils/                Utilities (run ID generator)
```

**Key dependencies:**

- `commander` -- CLI framework
- `@github/copilot-sdk`, `openai`, `@anthropic-ai/sdk`, `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic` -- evaluator providers
- `zod` -- schema validation (v4, import from `zod/v4`)
- `yaml` -- YAML parsing for evals
- `smol-toml` -- TOML parsing for optional config
- `chalk`, `cli-table3` -- CLI output formatting

### Module dependency graph

schemas -> types -> errors (no cycles)
loaders -> schemas, types, errors
providers -> providers/types
runner -> providers/types, types
commands -> loaders, runner, providers, output
index -> commands

### Data flow

1. CLI parses args (commander), including global flags
2. Config loaded from optional `dojo.toml` or defaults applied
3. CLI overrides (`--cwd`, `--model-provider`, `--evaluator-model`,
   `--skills-dir`) applied on top of config. CLI flags always win.
4. Skills discovered by globbing SKILL.md files under configured paths
5. Evals discovered from per-skill `evals/` dirs
6. Evaluator provider instantiated (Copilot SDK registers `load_skill` tool)
7. Runner executes evals, observes agent tool-call behavior
8. Reports saved as JSON per-skill in `evals/reports/`

### Provider abstraction

Evaluator and Judge are interfaces in `src/providers/types.ts`. Four
concrete `Evaluator` implementations ship today: Copilot SDK, OpenAI
Chat Completions, Anthropic Messages API, and Vercel AI SDK. The default
provider is `anthropic`; switch via `dojo.toml` (`model.provider`) or
the `--model-provider` CLI flag. OpenAI and Anthropic read their API keys
from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env vars. The Vercel provider
routes to an underlying provider based on the model string format
`<provider>/<model-id>` (e.g. `openai/gpt-4o-mini`).

To add a new provider: (1) create `src/providers/<name>/evaluator.ts`
implementing `Evaluator`, (2) add the literal to the
`SUPPORTED_PROVIDERS` enum in `src/schemas/config.ts`, and (3) wire
the dispatch case in `src/providers/factory.ts`. The `Judge` interface
has one implementation (Anthropic); other providers throw "not yet
implemented" from `createJudge`.

### Selection eval mechanism

The evaluator registers a `load_skill` tool with the agent. The agent
either calls it (selecting a skill) or responds directly (no skill
needed). This tests real agent decision-making, not artificial prompts.

### Effectiveness eval mechanism

Effectiveness evals test whether a skill actually helps an agent produce
correct output. The flow:

1. A sandbox subprocess is spawned with the skill preloaded and real
   tools (bash, read_file, write_file, list_files).
2. The agent works in a temp directory populated from fixture `tests/`.
3. After completion, an LLM judge scores the output against user-defined
   criteria, using optional `golden/` reference material for calibration.
4. Matrix support: run N evaluators × M judges × K fixtures per eval.
   Agent runs fan out to judges (one agent run → N judge calls).

Fixture layout:
```
evals/
  effectiveness.yaml    eval definitions with criteria
  fixtures/
    <name>/
      tests/            copied into sandbox as agent's cwd
      tests/setup.sh    optional; runs before agent
      golden/
        notes.md        optional; freeform reference for judge
        files/          optional; reference file state
```

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
| Run CLI (built) | `node dist/index.js` |

## Directory context (`AGENTS.md`)

No directory-level `AGENTS.md` files exist yet. As the project grows,
create them in directories that develop their own domain, patterns, or
conventions. When you create one, add a pointer here.

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

### Decisions

- **Provider abstraction over SDK lock-in:** The evaluator and judge
  are interfaces, not tied to any single SDK. All four providers
  (copilot, openai, anthropic, vercel) implement both `Evaluator` and
  `Judge` interfaces. Provider is configured once in `dojo.toml`
  (`[model].provider`) and used for both selection evals, effectiveness
  evals (agent-runner), and judging. The Vercel AI SDK provider routes
  to underlying providers via a `<provider>/<model-id>` model string.
  Revisit if the abstraction becomes leaky.

- **Selection evals use tool observation:** Instead of asking the agent
  "which skill would you pick?", we register a `load_skill` tool and
  observe whether the agent calls it. This tests real decision-making
  behavior. Revisit if SDK limitations make this unreliable.

- **Effectiveness evals use real subprocess sandbox:** The agent runs
  in an isolated temp directory with real bash/file tools, not mocked
  or virtualized. This gives real-world fidelity — process isolation,
  OS-enforced cwd, no path escapes. The full skill directory (SKILL.md,
  scripts/, references/, assets/) is copied into the sandbox per the
  agentskills.io spec's progressive disclosure model.

- **Judge is batched (all criteria in one call):** Rather than one API
  call per criterion, the judge scores all criteria in a single
  structured-output call. Reduces cost 3-4x in matrix mode and gives
  the judge cross-criterion context for better calibration. Revisit if
  individual criterion scoring proves more reliable.

- **Matrix separates agent runs from judge calls:** Agent runs depend
  on the evaluator but not the judge. So the matrix is expanded as
  (eval × fixture × evaluator × variant) for agent runs, then each
  artifact fans out to N judges. This makes judge-only reruns nearly
  free and avoids redundant agent executions.

