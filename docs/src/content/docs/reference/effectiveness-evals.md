---
title: "Effectiveness Evals Reference"
description: "Reference for the effectiveness eval YAML file format."
---

:::note
This page is auto-generated.
:::

## Effectiveness File

Top-level schema for `effectiveness.yaml` files.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | `string` | No | - | Default evaluator model for all evals in this file. |
| `judge` | `string` | No | - | Default judge model (format: "provider/model"). |
| `timeout` | `number` | No | `120` | Default timeout in seconds. |
| `matrix` | `Matrix` | No | - | Default matrix applied to all evals. |
| `variants` | `Variant[]` | No | - | Variant definitions available to evals. |
| `run-mode` | `"all"` \| `"variants-only"` \| `"current-only"` | No | `"all"` | Default run mode for evals. |
| `evals` | `EffectivenessEval[]` | Yes | - | List of effectiveness evals to run. |

#### `matrix` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `evaluators` | `MatrixEntry[]` | No | - | Evaluator models to run the agent with. |
| `judges` | `MatrixEntry[]` | No | - | Judge models to score the output. |

## Effectiveness Eval

Schema for individual entries in an effectiveness file's `evals` array.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Unique name for this eval. |
| `prompt` | `string` | Yes | - | The prompt to send to the agent in the sandbox. |
| `enabled` | `boolean` | No | `true` | Whether this eval is active. |
| `timeout` | `number` | No | - | Timeout in seconds. Overrides file-level default. |
| `fixtures` | `string[]` | No | - | Fixture names to run against. Default: all fixtures. |
| `criteria` | `Criterion[]` | Yes | - | Criteria the judge evaluates. All must pass. |
| `variants` | `"all"` \| `string[]` \| `Variant[]` | No | `"all"` | Variants to run. |
| `run-mode` | `"all"` \| `"variants-only"` \| `"current-only"` | No | - | Override run mode for this eval. |
| `matrix` | `Matrix` | No | - | Override the matrix for this eval. |

#### `matrix` fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `evaluators` | `MatrixEntry[]` | No | - | Evaluator models to run the agent with. |
| `judges` | `MatrixEntry[]` | No | - | Judge models to score the output. |

## Criterion

Schema for judging criteria in effectiveness evals.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Name of the criterion to evaluate. |
| `description` | `string` | Yes | - | What the judge should evaluate for this criterion. |
| `pass_threshold` | `number` | Yes | - | Minimum score (0-1) for this criterion to pass. |

## Matrix

Configuration for running evals across multiple models.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `evaluators` | `MatrixEntry[]` | No | - | Evaluator models to run the agent with. |
| `judges` | `MatrixEntry[]` | No | - | Judge models to score the output. |

## Matrix Entry

A provider/model pair used in matrix configuration.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider` | `"copilot"` \| `"openai"` \| `"anthropic"` \| `"vercel"` | Yes | - | The model provider to use. |
| `model` | `string` | Yes | - | The model identifier (e.g. "claude-sonnet-4-6", "gpt-4o"). |
