---
title: "Variants Reference"
description: "Reference for variant schemas used in selection and effectiveness evals."
---

:::note
This page is auto-generated.
:::

## Selection Variant

Schema for skill variants used in selection evals. These replace the skill's description in the selection pool.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Unique name for this variant. |
| `value` | `string` | Yes | - | SKILL.md content to use in place of the current skill content. |
| `enabled` | `boolean` | No | `true` | Whether this variant is active. |
| `decoys` | `Decoy[]` | No | - | Decoy skills specific to this variant. |

## Decoy

Schema for decoy skills that should not be selected.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Name of the decoy skill. |
| `value` | `string` | Yes | - | SKILL.md content for the decoy skill. |
| `enabled` | `boolean` | No | `true` | Whether this decoy is active. |

## Effectiveness Variants

Effectiveness variants test different formulations of an entire skill directory. Two sources are supported:

### Filesystem variants

Full agentskills.io skill directories placed at `evals/variants/<name>/`:

```
evals/
  variants/
    <variant-name>/
      SKILL.md            # required
      scripts/            # optional
      references/         # optional
      assets/             # optional
```

The directory name is the variant's identifier. The variant is discovered automatically when it contains a valid `SKILL.md`.

### Inline effectiveness variants

Defined in `effectiveness.yaml` with the same schema as selection variants:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Unique name for this variant. |
| `value` | `string` | Yes | - | SKILL.md content to use in place of the current skill. |

Inline variants cannot carry `scripts/`, `references/`, or `assets/`. Use filesystem variants when you need the full skill directory.

### Run mode

Controls which combinations execute for a given eval.

| Value | Description |
|-------|-------------|
| `"all"` | Run both `[current]` baseline and all variants. Default. |
| `"current-only"` | Run only the baseline skill. |
| `"variants-only"` | Run only variants, skip the baseline. |

Configurable at file level and per-eval. Per-eval overrides file level.

### Collision resolution

If an inline variant and a filesystem variant share the same name, the filesystem variant takes precedence. A warning is emitted to stderr.

### Validation

Invalid variant `SKILL.md` files (parse errors, missing required fields) emit a warning and are skipped. They do not fail the run or `dojo validate`.
