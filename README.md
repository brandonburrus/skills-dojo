# Skills Dojo

A toolkit for testing, evaluating, and improving AI agent skills.

Skills follow the [Agent Skills specification](https://agentskills.io/specification).

Dojo's current focus is **selection evals** — testing whether an agent correctly decides to load (or not load) a skill given a user prompt. Instead of asking the agent "which skill would you pick?", Dojo registers a `load_skill` tool and observes whether the agent calls it. This tests real decision-making behavior.

## Quick Start

```bash
npm install -g skills-dojo
```

Create a skill with a `SKILL.md` file:

```
skills/
  code-review/
    SKILL.md
    evals/
      should-select.yaml
      should-not-select.yaml
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

Write an eval that tests whether the agent selects the skill:

`skills/code-review/evals/should-select.yaml`:

```yaml
name: should-select-code-review
type: selection
prompt: "Review this pull request for potential security issues and suggest improvements."
selection:
  expect: code-review
  available: all
```

Write a negative eval that tests the agent does _not_ select the skill:

`skills/code-review/evals/should-not-select.yaml`:

```yaml
name: should-not-select-code-review
type: selection
prompt: "Write a Python function that calculates the Fibonacci sequence."
selection:
  expect: none
  available: all
```

Test discrimination by adding decoy skills that could confuse the agent:

`skills/code-review/evals/with-decoys.yaml`:

```yaml
name: select-with-decoys
type: selection
prompt: "Review this pull request for potential security issues."
selection:
  expect: code-review
  available: all
  decoys:
    - name: code-formatter
      description: Automatically format code to match style guidelines.
    - name: code-explainer
      description: Explain what a piece of code does in plain English.
```

Run the evals:

```bash
dojo run
```

## CLI

```
dojo run [skill]          Run evals, optionally filtering by skill name substring
  --type <type>           Filter by eval type
  --output <path>         Write combined report JSON
  --inspect               Show full session telemetry and streaming output

dojo list                 List discovered skills and evals
dojo validate             Validate skills and evals
```

Global flags:

```
--cwd <dir>               Working directory for config and skill discovery
--skills-dir <dir>        Override skills directory (repeatable)
--evaluator-model <model> Override evaluator model
--model-provider <provider> Override model provider
```

## Eval Schema

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Required. Eval identifier. |
| `type` | `"selection"` | Required. Eval type. |
| `prompt` | string | Required. The prompt sent to the agent. |
| `timeout_seconds` | number | Optional. Default `30`. |
| `selection.expect` | string | `"none"`, `"any"`, or a specific skill name. |
| `selection.available` | `"all"` or `string[]` | Which skills to offer the agent. |
| `selection.decoys` | `{name, description}[]` | Optional. Fake skills to test discrimination. |

### Expectations

- `expect: "skill-name"` — the agent must load that specific skill
- `expect: "none"` — the agent must not load any skill
- `expect: "any"` — the agent must load something (any skill)

## Configuration

Optional `dojo.toml` in the working directory. Everything has sensible defaults.

```toml
[skills]
dir = ['skills', '.agents/skills', '.github/skills', '.claude/skills', '.codex/skills', '.gemini/skills', '.openclaw/skills', '.opencode/skills']

[model]
provider = 'copilot'
evaluator = 'gpt-4o-mini'
judge = 'gpt-4o-mini'

[reporting]
per-skill = true
consolidated = false
```

## Reports

Reports are saved per-skill at:

```
<skill-dir>/evals/reports/<run-id>/report.json
<skill-dir>/evals/reports/<run-id>/logs.json
```

### Provider Architecture

Evaluator and Judge are interfaces — not tied to any specific SDK. The Copilot SDK (`@github/copilot-sdk`) is the first implementation. New providers can be added under `src/providers/<name>/`.

