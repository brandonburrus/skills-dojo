---
title: "Variants Reference"
description: "Reference for variant and decoy schemas used in selection evals."
---

:::note
This page is auto-generated.
:::

## Variant

Schema for skill variants used in selection evals.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Unique name for this variant. |
| `value` | `string` | Yes | - | SKILL.md content to use in place of the current skill content. |
| `enabled` | `boolean` | Yes | `true` | Whether this variant is active. |
| `decoys` | `Decoy[]` | No | - | Decoy skills specific to this variant. |

## Decoy

Schema for decoy skills that should not be selected.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Name of the decoy skill. |
| `value` | `string` | Yes | - | SKILL.md content for the decoy skill. |
| `enabled` | `boolean` | Yes | `true` | Whether this decoy is active. |
