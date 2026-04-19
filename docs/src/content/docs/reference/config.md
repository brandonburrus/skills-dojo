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
| `skills` | `object` | Yes | `{"dir":["skills",".agents/skills",".github/skills",".claude/skills",".codex/skills",".gemini/skills",".openclaw/skills",".opencode/skills"]}` | Configuration for skill discovery. |
| `model` | `object` | Yes | `{"provider":"copilot"}` | Model provider and model selection for evaluations. |
| `reporting` | `object` | Yes | `{"per-skill":true,"consolidated":false}` | Controls how and where eval reports are written. |

#### `skills` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `dir` | `string` \| `string[]` | Yes | `["skills",".agents/skills",".github/skills",".claude/skills",".codex/skills",".gemini/skills",".openclaw/skills",".opencode/skills"]` | Directories to search for SKILL.md files. Can be a single path or an array of paths. |

#### `model` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider` | `string` | Yes | `"copilot"` | Model provider to use for evaluations. Currently only "copilot" is supported. |
| `evaluator` | `string` | No | - | Model to use for running evals. Defaults to the provider's default model. |
| `judge` | `string` | No | - | Model to use for judging eval results. Defaults to the provider's default model. |

#### `reporting` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `per-skill` | `boolean` | Yes | `true` | Write a separate report for each skill under its evals/reports/ directory. |
| `consolidated` | `boolean` | Yes | `false` | Write a single consolidated report combining all skills. |
