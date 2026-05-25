import type { RunReport } from '../types.js'
import type { EffectivenessEvalResult } from '../runner/effectiveness.js'
import { createTable, statusLabel } from './cli.js'
import chalk from 'chalk'

type EvalResult = RunReport['results'][number]

function formatFlatReport(report: RunReport): string {
  const table = createTable(['', 'Eval', 'Expected', 'Actual'])
  for (const result of report.results) {
    const actual = result.actual.loaded ? (result.actual.skillName ?? 'none') : 'none'
    table.push([statusLabel(result.passed), result.eval, result.expected, actual])
  }
  return table.toString()
}

function formatVariantMatrix(report: RunReport): string {
  const evalNames: string[] = []
  const variants: string[] = []
  const resultMap = new Map<string, EvalResult>()

  for (const result of report.results) {
    const variant = result.variant ?? 'base'
    if (!evalNames.includes(result.eval)) evalNames.push(result.eval)
    if (!variants.includes(variant)) variants.push(variant)
    resultMap.set(`${result.eval}::${variant}`, result)
  }

  // Sort so 'base' (current) is always first
  variants.sort((a, b) => {
    if (a === 'base') return -1
    if (b === 'base') return 1
    return 0
  })

  const headers = ['Eval', ...variants.map(v => (v === 'base' ? 'current' : v))]
  const table = createTable(headers)

  for (const evalName of evalNames) {
    const row = [evalName]
    for (const variant of variants) {
      const result = resultMap.get(`${evalName}::${variant}`)
      row.push(result ? statusLabel(result.passed) : '-')
    }
    table.push(row)
  }

  return table.toString()
}

export function formatRunReport(report: RunReport): string {
  const header = `Skill Selection: ${chalk.bold.blueBright(report.skill)}`
  const hasVariants = report.results.some(r => r.variant !== undefined)
  const body = hasVariants ? formatVariantMatrix(report) : formatFlatReport(report)
  return `${header}\n${body}`
}

export function formatEffectivenessReport(
  skillName: string,
  _runId: string,
  results: EffectivenessEvalResult[],
): string {
  const header = `Skill Effectiveness: ${chalk.bold.blueBright(skillName)}`
  const table = createTable(['Eval', 'Fixture', 'Evaluator', 'Judge', 'Result'])

  for (const result of results) {
    const resultCell = result.error ? chalk.red('ERROR') : statusLabel(result.passed)
    table.push([result.eval, result.fixture, result.evaluator, result.judge, resultCell])
  }

  const lines = [header, table.toString()]

  const errored = results.filter(r => r.error)
  const evaluated = results.filter(r => !r.error)
  const totalCriteria = evaluated.reduce((sum, r) => sum + r.criteria.length, 0)
  const passedCriteria = evaluated.reduce(
    (sum, r) => sum + r.criteria.filter(c => c.passed).length,
    0,
  )

  if (evaluated.length > 0) {
    lines.push(`${passedCriteria}/${totalCriteria} criteria passed`)
  }

  if (errored.length > 0) {
    lines.push('')
    lines.push(chalk.red(`${errored.length} eval(s) failed with errors:`))
    const uniqueErrors = [...new Set(errored.map(r => r.error!))]
    for (const err of uniqueErrors) {
      const count = errored.filter(r => r.error === err).length
      const prefix = count > 1 ? `(${count}x) ` : ''
      lines.push(chalk.red(`  ${prefix}${err}`))
    }
  }

  return lines.join('\n')
}
