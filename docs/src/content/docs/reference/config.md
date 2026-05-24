---
title: "Config Reference"
description: "Reference for the dojo.toml configuration file format."
---

:::note
This page is auto-generated.
:::

## Configuration

Schema for the `dojo.toml` configuration file.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `skills` | `object` | No | `{"dir":["skills",".agents/skills",".github/skills",".claude/skills",".codex/skills",".gemini/skills",".openclaw/skills",".opencode/skills"]}` | Configuration for skill discovery. |
| `model` | `object` | No | `{"provider":"anthropic"}` | Model provider and model selection for evaluations. |
| `reporting` | `object` | No | `{"per-skill":true,"consolidated":false}` | Controls how and where eval reports are written. |

#### `skills` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `dir` | `string` \| `string[]` | No | `["skills",".agents/skills",".github/skills",".claude/skills",".codex/skills",".gemini/skills",".openclaw/skills",".opencode/skills"]` | Directories to search for SKILL.md files. Can be a single path or an array of paths. |

#### `model` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider` | `"copilot"` \| `"openai"` \| `"anthropic"` \| `"vercel"` | No | `"anthropic"` | Model provider to use for evaluations. One of: copilot, openai, anthropic, vercel. Defaults to anthropic. |
| `evaluator` | `string` | No | - | Model to use for running evals. Defaults to the provider's default model. For the vercel provider, use the form "<underlying-provider>/<model-id>" (e.g. "openai/gpt-4o-mini"). |
| `judge` | `string` | No | - | Model to use for judging eval results. Defaults to the provider's default model. |

#### `reporting` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `per-skill` | `boolean` | No | `true` | Write a separate report for each skill under its evals/reports/ directory. |
| `consolidated` | `boolean` | No | `false` | Write a single consolidated report combining all skills. |
