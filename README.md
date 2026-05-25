# Skills Dojo

A toolkit for testing, evaluating, and improving AI agent skills.

Skills follow the [Agent Skills specification](https://agentskills.io/specification).

Dojo supports **selection evals** (does the agent load the right skill?) and **effectiveness evals** (does the skill actually help the agent produce correct output?). Selection evals register a `load_skill` tool and observe whether the agent calls it; effectiveness evals run the agent in a sandbox and have an LLM judge score the results.

![Example run output](example.png)

## Quick Start

```bash
npm install -g skills-dojo
```

### Selection Eval

Create a skill with a `SKILL.md` file and a `selection.yaml` eval file:

```
skills/
  code-review/
    SKILL.md
    evals/
      selection.yaml
```

`skills/code-review/SKILL.md`:

```markdown
---
name: code-review
description: Review code changes for security, performance, and correctness issues.
---

# Code Review

Analyzes diffs and pull requests...
```

`skills/code-review/evals/selection.yaml`:

```yaml
evals:
  - name: should-select-code-review
    prompt: "Review this pull request for potential security issues and suggest improvements."

  - name: should-not-select-code-review
    prompt: "Write a Python function that calculates the Fibonacci sequence."
    assert: none
```

When `assert` is omitted, it defaults to the skill the eval lives under (e.g. `code-review`). Use `assert: none` to test that the agent does _not_ select the skill.

### Effectiveness Eval

Add an `effectiveness.yaml` and fixtures:

```
skills/
  sql-queries/
    SKILL.md
    evals/
      selection.yaml
      effectiveness.yaml
      fixtures/
        aggregate-query/
          tests/
            schema.sql
          golden/
            notes.md
```

`skills/sql-queries/evals/effectiveness.yaml`:

```yaml
evals:
  - name: aggregate-monthly-revenue
    prompt: "Write a SQL query that calculates total revenue per month from the orders table."
    criteria:
      - Uses GROUP BY with a date function
      - Returns both month and revenue columns
      - Handles NULL values appropriately
```

### Run evals

```bash
dojo run
```

## Variants

Variants let you test the same eval against different skill descriptions. This is useful for tuning the `description` field in your `SKILL.md` — you can compare how a concise vs verbose description affects selection accuracy.

```yaml
variants:
  - name: concise
    value: Write and optimize SQL queries across all major database dialects.

  - name: verbose
    value: >
      Write correct, performant SQL across all major data warehouse and database
      dialects including Snowflake, BigQuery, Databricks, PostgreSQL, MySQL, and
      SQL Server.

evals:
  - name: should-select-sql-queries
    prompt: "Write a query that finds the top 10 customers by revenue using a window function."
```

Each eval runs once with the current skill description (`[current]`), then once per variant with the variant's `value` substituted as the skill description. Results are displayed in a matrix so you can compare across variants.

### Run modes

Control which combinations run with `run-mode` (at file or eval level):

| Mode | Behavior |
|------|----------|
| `all` (default) | Run current + all variants |
| `variants-only` | Skip current, run variants only |
| `current-only` | Skip variants, run current only |

## Decoys

Decoys are fake skills injected into the available skill list to test discrimination:

```yaml
evals:
  - name: select-with-decoys
    prompt: "Review this pull request for potential security issues."
    decoys:
      - name: code-formatter
        value: Automatically format code to match style guidelines.
      - name: code-explainer
        value: Explain what a piece of code does in plain English.
```

Variants can also define decoys. When both exist, they are merged (deduplicated by name).

## Effectiveness Evals

Effectiveness evals test whether a skill actually helps an agent produce correct output.

- The agent runs in a **sandboxed temp directory** with real tools (`bash`, `read_file`, `write_file`, `list_files`).
- **Fixtures** provide test scenarios: the `tests/` directory is copied as the agent's working directory. An optional `tests/setup.sh` runs before the agent starts.
- An **LLM judge** scores the agent's output against user-defined criteria. Optional `golden/` material (notes, reference files) calibrates the judge.
- **Matrix support**: run N evaluators x M judges per eval. Agent runs fan out to judges — one agent run produces N judge scores.

See [skillsdojo.dev](https://skillsdojo.dev) for full effectiveness eval documentation.

## CLI

```
dojo run [skill]              Run evals, optionally filtering by skill name
  -e, --eval <name>           Filter by eval name
  -V, --variant <name>        Run only a specific variant by name
  -t, --eval-type <type>      Filter: "selection", "effectiveness", or "all"
  --selection                  Run only selection evals
  --effectiveness              Run only effectiveness evals
  -m, --evaluation-model       Override evaluation model
  -j, --judge-model            Override judge model
  --model-provider             Override model provider
  -f, --fixture <name>        Filter to a specific fixture
  --judge-filter <id>         Filter to a specific judge
  -p, --parallelism <n>       Max concurrent eval runs (default: CPU cores)
  --no-parallelism            Run evals sequentially
  -o, --output <path>         Write combined report JSON
  -i, --inspect               Show session events
  --keep-sandbox              Keep sandbox temp dirs after run
  -y, --yes                   Skip confirmation prompts

dojo list                     List discovered skills and evals
dojo validate                 Validate skills and eval files
```

Global flags:

```
-s, --skills-dir <dir>    Override skills directory (repeatable)
-c, --config <path>       Path to config file (default: auto-detect dojo.toml)
-d, --cwd <dir>           Working directory for config and skill discovery
```

## Eval Schema

Each skill has a single `evals/selection.yaml` file containing all its evals.

### File-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | SDK default | Model for the evaluator session. |
| `timeout` | number | `30` | Timeout in seconds. |
| `skills` | `"all"` or `string[]` | `"all"` | Which skills to offer the agent. |
| `run-mode` | `"all"`, `"variants-only"`, `"current-only"` | `"all"` | Which combinations to run. |
| `variants` | `Variant[]` | — | Variant definitions. |
| `evals` | `Eval[]` | — | **Required.** The eval definitions. |

### Eval-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | **Required.** Eval identifier. |
| `prompt` | string | — | **Required.** The prompt sent to the agent. |
| `assert` | `string[]`, `"none"`, `"any"` | `[skillName]` | Expected selection result. |
| `model` | string | file-level | Override model for this eval. |
| `timeout` | number | file-level | Override timeout for this eval. |
| `skills` | `"all"` or `string[]` | file-level | Override available skills. |
| `run-mode` | `"all"`, `"variants-only"`, `"current-only"` | file-level | Override run mode. |
| `variants` | `"all"`, `string[]`, `Variant[]` | `"all"` | Which variants to run. |
| `decoys` | `Decoy[]` | — | Fake skills for discrimination testing. |
| `enabled` | boolean | `true` | Skip this eval when `false`. |

### Variant fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | **Required.** Variant identifier. |
| `value` | string | — | **Required.** Skill description override. |
| `enabled` | boolean | `true` | Skip this variant when `false`. |
| `decoys` | `Decoy[]` | — | Additional decoys for this variant. |

### Assert behavior

- **omitted** — defaults to `[skillName]` (the skill the eval lives under)
- **`"none"`** — the agent must not load any skill
- **`"any"`** — the agent must load something (any skill)
- **`["skill-a", "skill-b"]`** — the agent must load one of the listed skills

### Cascading

Fields cascade: eval-level overrides file-level, file-level overrides defaults. For `model`, the cascade is: eval > file > CLI flag/config > SDK default.

## Configuration

Optional `dojo.toml` in the working directory. Everything has sensible defaults.

```toml
[skills]
dir = ['skills', '.agents/skills', '.github/skills', '.claude/skills', '.codex/skills', '.gemini/skills', '.openclaw/skills', '.opencode/skills']

[model]
provider = 'anthropic'
# evaluator = 'claude-sonnet-4-20250514'   # optional override for eval agent model
# judge = 'claude-sonnet-4-20250514'       # optional override for judge model
```

The `provider` setting applies to both evaluation and judging.

## Reports

Reports are saved per-skill at:

```
<skill-dir>/evals/reports/<run-id>/report.json
<skill-dir>/evals/reports/<run-id>/effectiveness-report.json
<skill-dir>/evals/reports/<run-id>/logs.json
```

## Provider Architecture

Evaluator and Judge are interfaces — not tied to any specific SDK. Four providers ship today:

| Provider | Notes |
|----------|-------|
| `anthropic` | Default. Reads `ANTHROPIC_API_KEY`. |
| `openai` | Reads `OPENAI_API_KEY`. |
| `copilot` | GitHub Copilot SDK (v1.0.0-beta.4). |
| `vercel` | Vercel AI SDK. Routes via `<provider>/<model-id>` model strings (e.g. `openai/gpt-4o-mini`). |

All four implement both the `Evaluator` and `Judge` interfaces. To add a new provider, create `src/providers/<name>/evaluator.ts`, add the literal to `SUPPORTED_PROVIDERS` in `src/schemas/config.ts`, and wire the dispatch in `src/providers/factory.ts`.
