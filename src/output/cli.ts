import chalk from 'chalk'
import Table from 'cli-table3'
import figures from 'figures'

/** Log a success line: green tick + plain white message */
export function logSuccess(message: string): void {
  console.log(`${chalk.green(figures.tick)} ${message}`)
}

/** Log a failure line: red cross + plain white message */
export function logFailure(message: string): void {
  console.log(`${chalk.red(figures.cross)} ${message}`)
}

/** Bold blueBright heading */
export function heading(text: string): string {
  return chalk.blueBright.bold(text)
}

/** Dim blueBright hint text */
export function dim(text: string): string {
  return chalk.blueBright.dim(text)
}

/** PASS/FAIL status label for tables */
export function statusLabel(passed: boolean): string {
  return passed ? chalk.bold.greenBright('PASS') : chalk.bold.redBright('FAIL')
}

/** Red error text */
export function errorText(text: string): string {
  return chalk.redBright(text)
}

/** Truncate text with ellipsis */
export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

/** Create a consistently styled CLI table */
export function createTable(columns: string[]): Table.Table {
  return new Table({
    head: columns,
    style: { head: ['white'], border: ['gray'] },
  })
}
