import type { RunReport } from '../types.js'
import { createTable, statusLabel } from './cli.js'

export function formatRunReport(report: RunReport): string {
  const header = `Run: ${report.runId} | Skill: ${report.skill} | ${report.timestamp}`

  const table = createTable(['Eval', 'Expected', 'Actual', 'Status', 'Duration'])

  for (const result of report.results) {
    const actual = result.actual.loaded ? (result.actual.skillName ?? 'none') : 'none'
    const status = statusLabel(result.passed)
    const duration = `${(result.durationMs / 1000).toFixed(1)}s`

    table.push([result.eval, result.expected, actual, status, duration])
  }

  const summary = `${report.passed}/${report.totalEvals} passed`

  return `${header}\n${table.toString()}\n${summary}`
}
