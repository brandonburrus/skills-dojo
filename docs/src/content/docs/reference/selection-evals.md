---
title: "Selection Evals Reference"
description: "Reference for the selection eval YAML file format."
---

:::note
This page is auto-generated.
:::

## Selection File

Top-level schema for `selection.yaml` files.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | `string` | No | - | Default model for all evals in this file. |
| `timeout` | `number` | No | `30` | Default timeout in seconds for evals in this file. |
| `skills` | `"all"` \| `string[]` | No | `"all"` | Skills to register for evals. Use "all" or a list of skill names. |
| `run-mode` | `"all"` \| `"variants-only"` \| `"current-only"` | No | `"all"` | Default run mode for evals: "all", "variants-only", or "current-only". |
| `variants` | `Variant[]` | No | - | Variant definitions available to evals in this file. |
| `evals` | `SelectionEval[]` | Yes | - | List of selection evals to run. |

## Selection Eval

Schema for individual entries in a selection file's `evals` array.

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
