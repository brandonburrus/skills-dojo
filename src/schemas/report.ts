import { z } from 'zod/v4'

const EvalResultSchema = z.object({
  eval: z.string(),
  passed: z.boolean(),
  expected: z.string(),
  actual: z.object({
    loaded: z.boolean(),
    skillName: z.string().nullable(),
  }),
  durationMs: z.number(),
  error: z.string().optional(),
})

export const RunReportSchema = z.object({
  runId: z.string(),
  timestamp: z.iso.datetime(),
  skill: z.string(),
  totalEvals: z.number(),
  passed: z.number(),
  failed: z.number(),
  results: z.array(EvalResultSchema),
})
