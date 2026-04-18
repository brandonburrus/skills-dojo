export interface ConfigIssue {
  readonly path: string
  readonly message: string
}

export class DojoError extends Error {
  override readonly name: string = 'DojoError'
  override readonly cause?: unknown

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.cause = options?.cause
  }
}

export class ConfigValidationError extends DojoError {
  override readonly name = 'ConfigValidationError'
  readonly issues: ReadonlyArray<ConfigIssue>

  constructor(message: string, issues: ReadonlyArray<ConfigIssue>, options?: ErrorOptions) {
    super(message, options)
    this.issues = issues
  }
}

export class SkillValidationError extends DojoError {
  override readonly name = 'SkillValidationError'
  readonly skillPath: string

  constructor(message: string, skillPath: string, options?: ErrorOptions) {
    super(message, options)
    this.skillPath = skillPath
  }
}

export class EvalValidationError extends DojoError {
  override readonly name = 'EvalValidationError'
  readonly evalPath: string

  constructor(message: string, evalPath: string, options?: ErrorOptions) {
    super(message, options)
    this.evalPath = evalPath
  }
}
