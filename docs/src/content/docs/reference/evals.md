---
title: "Eval File Reference"
description: "Reference for selection and effectiveness eval YAML file formats."
---

:::note
This page is auto-generated.
:::

## Selection File

Top-level schema for selection eval YAML files.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | `string` | No | - | Default model for all evals in this file. |
| `timeout` | `number` | No | `30` | Default timeout in seconds for evals in this file. |
| `skills` | `"all"` \| `string[]` | No | `"all"` | Skills to register for evals. Use "all" or a list of skill names. |
| `run-mode` | `"all"` \| `"variants-only"` \| `"current-only"` | No | `"all"` | Default run mode for evals: "all", "variants-only", or "current-only". |
| `variants` | `Variant[]` | No | - | Variant definitions available to evals in this file. |
| `evals` | `SelectionEval[]` | Yes | - | List of selection evals to run. |

## Selection Eval

Schema for individual eval entries within the `evals` array.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Unique name for this eval. |
| `prompt` | `string` | Yes | - | The prompt to send to the agent being evaluated. |
| `model` | `string` | No | - | Override the model for this eval. |
| `timeout` | `number` | No | - | Timeout in seconds for this eval. Overrides the file-level timeout. |
| `enabled` | `boolean` | No | `true` | Whether this eval is active. |
| `skills` | `"all"` \| `string[]` | No | - | Skills to register for this eval. Use "all" or a list of skill names. |
| `run-mode` | `"all"` \| `"variants-only"` \| `"current-only"` | No | - | Controls which runs to perform: "all" runs current + variants, "variants-only" skips current, "current-only" skips variants. |
| `assert` | `string[]` \| `"none"` \| `"any"` | No | - | Expected skill selection. An array of skill names, "none" if no skill should load, or "any" to accept any selection. Defaults to the owning skill for skill-scoped evals. |
| `variants` | `"all"` \| `string[]` \| `Variant[]` | No | `"all"` | Variants to run: "all" uses file-level variants, or specify inline/by name. |
| `decoys` | `Decoy[]` | No | - | Decoy skills to register alongside real skills for this eval. |

## Effectiveness File

Top-level schema for effectiveness eval YAML files.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `timeout` | `number` | No | `120` | Default timeout in seconds. |
| `defaults` | `object` | No | - | Default settings applied to all evals. |
| `defaults.matrix` | `object` | No | - | Default matrix configuration. |
| `variants` | `Variant[]` | No | - | Variant definitions available to evals. |
| `evals` | `EffectivenessEval[]` | Yes | - | List of effectiveness evals to run. |

## Effectiveness Eval

Schema for individual eval entries within the `evals` array of an effectiveness file.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Unique name for this eval. |
| `prompt` | `string` | Yes | - | The prompt to send to the agent in the sandbox. |
| `enabled` | `boolean` | No | `true` | Whether this eval is active. |
| `timeout` | `number` | No | file-level | Timeout in seconds. Overrides file-level default. |
| `fixtures` | `string[]` | No | all fixtures | Fixture names to run against. |
| `criteria` | `Criterion[]` | Yes | - | Criteria the judge evaluates. All must pass. |
| `variants` | `"all"` \| `string[]` \| `Variant[]` | No | `"all"` | Variants to run. |
| `matrix` | `object` | No | - | Override the matrix for this eval. |

## Criterion

Schema for individual criteria within the `criteria` array.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Name of the criterion to evaluate. |
| `pass_threshold` | `number` (0-1) | Yes | Minimum score for this criterion to pass. |

## Matrix Entry

Schema for entries in the `evaluators` and `judges` arrays within a matrix configuration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `"copilot"` \| `"openai"` \| `"anthropic"` \| `"vercel"` | Yes | Model provider. |
| `model` | `string` | Yes | Model identifier. |
