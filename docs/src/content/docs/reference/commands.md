---
title: "Commands Reference"
description: "Reference for all dojo CLI commands, arguments, and options."
---

:::note
This page is auto-generated.
:::

## Global Options

These options are available on all commands.

| Flag | Description | Default |
|------|-------------|---------|
| `--skills-dir <dir>` | Override skills directory (repeatable) | - |
| `--evaluator-model <model>` | Override evaluator model | - |
| `--model-provider <provider>` | Override model provider | - |
| `--cwd <dir>` | Working directory for config and skill discovery | - |
| `-v, --version` | Output the current version | - |
| `-h, --help` | Display help for command | - |

## Commands

### `dojo run`

Run evals against discovered skills. Results are saved as JSON reports per-skill.

```
dojo run [skill] [options]
```

#### Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `skill` | Filter by skill name (supports glob patterns) | No |

#### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-e, --eval <name>` | Run only evals matching this name | - |
| `-V, --variant <name>` | Run only a specific variant (by name) | - |
| `-p, --parallelism <n>` | Max concurrent eval runs | CPU cores |
| `--no-parallelism` | Run evals sequentially | - |
| `-o, --output <path>` | Write combined report to file | - |
| `-i, --inspect` | Show full session telemetry and streaming output | - |
### `dojo list` (alias: `ls`)

List all discovered skills and evals in a tabular format.

```
dojo list [options]
```
### `dojo validate`

Validate the config, skills, and evals. Reports errors without running anything.

```
dojo validate [options]
```
