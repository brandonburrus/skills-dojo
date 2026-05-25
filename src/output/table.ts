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
  const header = `Skill: ${chalk.bold.blueBright(report.skill)}`
  const hasVariants = report.results.some(r => r.variant !== undefined)
  const body = hasVariants ? formatVariantMatrix(report) : formatFlatReport(report)
  return `${header}\n${body}`
}

export function formatEffectivenessReport(
  skillName: string,
  runId: string,
  results: EffectivenessEvalResult[],
): string {
  const header = `Effectiveness: ${chalk.bold.blueBright(skillName)} (run: ${runId})`
  const table = createTable(['Eval', 'Fixture', 'Evaluator', 'Judge', 'Result'])

  for (const result of results) {
    table.push([
      result.eval,
      result.fixture,
      result.evaluator,
      result.judge,
      statusLabel(result.passed),
    ])
  }

  const totalCriteria = results.reduce((sum, r) => sum + r.criteria.length, 0)
  const passedCriteria = results.reduce(
    (sum, r) => sum + r.criteria.filter(c => c.passed).length,
    0,
  )
  const summary = `${passedCriteria}/${totalCriteria} criteria passed`

  return `${header}\n${table.toString()}\n${summary}`
}
