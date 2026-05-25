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
  variant: z.string().optional(),
  evalSkillName: z.string().nullable(),
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

const CriterionResultSchema = z.object({
  name: z.string(),
  score: z.number(),
  passed: z.boolean(),
  reasoning: z.string(),
})

const EffectivenessEvalResultSchema = z.object({
  eval: z.string(),
  fixture: z.string(),
  evaluator: z.string(),
  judge: z.string(),
  variant: z.string().describe('Variant name: "current" for baseline, or the variant ID.'),
  skillName: z.string().nullable(),
  passed: z.boolean(),
  criteria: z.array(CriterionResultSchema),
  durationMs: z.number(),
  error: z.string().optional(),
})

export const EffectivenessRunReportSchema = z.object({
  runId: z.string(),
  timestamp: z.iso.datetime(),
  skill: z.string(),
  totalEvals: z.number(),
  passed: z.number(),
  failed: z.number(),
  results: z.array(EffectivenessEvalResultSchema),
})
