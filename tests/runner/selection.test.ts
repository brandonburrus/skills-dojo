import { describe, expect, it, vi } from 'vitest'
import type { Evaluator, SelectionResult } from '../../src/providers/types.js'
import type { DiscoveredEval, DiscoveredSkill, SelectionEval } from '../../src/types.js'
import { buildSkillList, evaluateResult, runSelectionEvals } from '../../src/runner/selection.js'

const makeSkill = (name: string, description = `${name} description`): DiscoveredSkill => ({
  name,
  description,
  dirPath: `/skills/${name}`,
  frontmatter: { name, description },
})

const makeEval = (
  overrides: Partial<SelectionEval> & { selection: SelectionEval['selection'] },
): SelectionEval => ({
  name: 'test-eval',
  type: 'selection',
  prompt: 'Pick a skill',
  timeout_seconds: 30,
  ...overrides,
})

const makeDiscovered = (eval_: SelectionEval): DiscoveredEval => ({
  filePath: '/evals/test.yaml',
  eval: eval_,
  skillName: null,
})

const mockEvaluator = (result: SelectionResult): Evaluator => ({
  async runSelection() {
    return result
  },
})

const throwingEvaluator = (message: string): Evaluator => ({
  async runSelection() {
    throw new Error(message)
  },
})

const allSkills = [makeSkill('skill-a'), makeSkill('skill-b'), makeSkill('skill-c')]

describe('buildSkillList', () => {
  it('includes all skills when available is "all"', () => {
    const eval_ = makeEval({ selection: { expect: 'skill-a', available: 'all' } })
    const result = buildSkillList(allSkills, eval_)
    expect(result).toEqual([
      { name: 'skill-a', description: 'skill-a description' },
      { name: 'skill-b', description: 'skill-b description' },
      { name: 'skill-c', description: 'skill-c description' },
    ])
  })

  it('filters skills when available is a string array', () => {
    const eval_ = makeEval({ selection: { expect: 'skill-a', available: ['skill-a'] } })
    const result = buildSkillList(allSkills, eval_)
    expect(result).toEqual([{ name: 'skill-a', description: 'skill-a description' }])
  })

  it('appends decoys', () => {
    const eval_ = makeEval({
      selection: {
        expect: 'skill-a',
        available: ['skill-a'],
        decoys: [{ name: 'fake-skill', description: 'I am a decoy' }],
      },
    })
    const result = buildSkillList(allSkills, eval_)
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({ name: 'fake-skill', description: 'I am a decoy' })
  })
})

describe('evaluateResult', () => {
  it('passes when expected skill matches', () => {
    expect(evaluateResult('skill-a', { loaded: true, skillName: 'skill-a', raw: '' })).toBe(true)
  })

  it('fails when expected skill does not match', () => {
    expect(evaluateResult('skill-a', { loaded: true, skillName: 'skill-b', raw: '' })).toBe(false)
  })

  it('fails for specific skill when not loaded', () => {
    expect(evaluateResult('skill-a', { loaded: false, skillName: null, raw: '' })).toBe(false)
  })

  it('passes for "none" when not loaded', () => {
    expect(evaluateResult('none', { loaded: false, skillName: null, raw: '' })).toBe(true)
  })

  it('fails for "none" when loaded', () => {
    expect(evaluateResult('none', { loaded: true, skillName: 'skill-a', raw: '' })).toBe(false)
  })

  it('passes for "any" when loaded', () => {
    expect(evaluateResult('any', { loaded: true, skillName: 'whatever', raw: '' })).toBe(true)
  })

  it('fails for "any" when not loaded', () => {
    expect(evaluateResult('any', { loaded: false, skillName: null, raw: '' })).toBe(false)
  })
})

describe('runSelectionEvals', () => {
  it('returns passed when evaluator returns correct skill', async () => {
    const eval_ = makeEval({ selection: { expect: 'skill-a', available: 'all' } })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results).toHaveLength(1)
    expect(results[0].passed).toBe(true)
    expect(results[0].expected).toBe('skill-a')
    expect(results[0].actual).toEqual({ loaded: true, skillName: 'skill-a' })
    expect(results[0].durationMs).toBeGreaterThan(0)
  })

  it('returns failed when evaluator returns wrong skill', async () => {
    const eval_ = makeEval({ selection: { expect: 'skill-a', available: 'all' } })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-b', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results[0].passed).toBe(false)
  })

  it('captures error when evaluator throws', async () => {
    const eval_ = makeEval({ selection: { expect: 'skill-a', available: 'all' } })
    const results = await runSelectionEvals({
      evaluator: throwingEvaluator('connection timeout'),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results[0].passed).toBe(false)
    expect(results[0].error).toBe('connection timeout')
    expect(results[0].actual).toEqual({ loaded: false, skillName: null })
    expect(results[0].durationMs).toBeGreaterThan(0)
  })

  it('calls onProgress at start and completion of each eval', async () => {
    const eval_ = makeEval({ selection: { expect: 'skill-a', available: 'all' } })
    const onProgress = vi.fn()
    await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'start', runIndex: 0 }),
    )
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'complete',
        runIndex: 0,
        result: expect.objectContaining({ passed: true }),
      }),
    )
  })

  it('stops early when signal is aborted', async () => {
    const s1 = makeEval({ name: 's1', selection: { expect: 'skill-a', available: 'all' } })
    const s2 = makeEval({ name: 's2', selection: { expect: 'skill-a', available: 'all' } })
    const ac = new AbortController()
    ac.abort()

    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(s1), makeDiscovered(s2)],
      signal: ac.signal,
    })

    expect(results).toHaveLength(0)
  })
})

describe('runSelectionEvals variants', () => {
  it('runs only base when no variants configured', async () => {
    const eval_ = makeEval({ selection: { expect: 'skill-a', available: 'all' } })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results).toHaveLength(1)
    expect(results[0].variant).toBeUndefined()
  })

  it('runs base + skill-level variants when skillVariants provided', async () => {
    const eval_ = makeEval({ selection: { expect: 'skill-a', available: 'all' } })
    const discovered = makeDiscovered(eval_)
    discovered.skillName = 'skill-a'

    const skillVariants = new Map([
      ['skill-a', [{ name: 'concise', description: 'Short desc', enabled: true }]],
    ])

    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [discovered],
      skillVariants,
    })
    expect(results).toHaveLength(2)
    expect(results[0].variant).toBeUndefined()
    expect(results[1].variant).toBe('concise')
  })

  it('runs base + inline variants from eval', async () => {
    const eval_ = makeEval({
      selection: { expect: 'skill-a', available: 'all' },
      variants: [{ name: 'verbose', description: 'Long desc', enabled: true }],
    })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results).toHaveLength(2)
    expect(results[1].variant).toBe('verbose')
  })

  it('respects config.variants: disabled (only base)', async () => {
    const eval_ = makeEval({
      selection: { expect: 'skill-a', available: 'all' },
      variants: [{ name: 'verbose', description: 'Long desc', enabled: true }],
      config: { variants: 'disabled' },
    })
    const discovered = makeDiscovered(eval_)
    discovered.skillName = 'skill-a'

    const skillVariants = new Map([
      ['skill-a', [{ name: 'concise', description: 'Short', enabled: true }]],
    ])

    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [discovered],
      skillVariants,
    })
    expect(results).toHaveLength(1)
    expect(results[0].variant).toBeUndefined()
  })

  it('respects config.variants: inline-only (no skill-level)', async () => {
    const eval_ = makeEval({
      selection: { expect: 'skill-a', available: 'all' },
      variants: [{ name: 'inline-v', description: 'Inline variant', enabled: true }],
      config: { variants: 'inline-only' },
    })
    const discovered = makeDiscovered(eval_)
    discovered.skillName = 'skill-a'

    const skillVariants = new Map([
      ['skill-a', [{ name: 'skill-v', description: 'Skill variant', enabled: true }]],
    ])

    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [discovered],
      skillVariants,
    })
    expect(results).toHaveLength(2)
    expect(results[0].variant).toBeUndefined()
    expect(results[1].variant).toBe('inline-v')
  })

  it('skips variants for expect: none', async () => {
    const eval_ = makeEval({
      selection: { expect: 'none', available: 'all' },
      variants: [{ name: 'v1', description: 'Variant', enabled: true }],
    })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: false, skillName: null, raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results).toHaveLength(1)
    expect(results[0].variant).toBeUndefined()
  })

  it('skips variants for expect: any', async () => {
    const eval_ = makeEval({
      selection: { expect: 'any', available: 'all' },
      variants: [{ name: 'v1', description: 'Variant', enabled: true }],
    })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results).toHaveLength(1)
  })

  it('only runs enabled variants (enabled: false are skipped)', async () => {
    const eval_ = makeEval({
      selection: { expect: 'skill-a', available: 'all' },
      variants: [
        { name: 'enabled-v', description: 'Active', enabled: true },
        { name: 'disabled-v', description: 'Inactive', enabled: false },
      ],
    })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results).toHaveLength(2)
    expect(results[1].variant).toBe('enabled-v')
  })

  it('result includes variant name for variant runs, undefined for base', async () => {
    const eval_ = makeEval({
      selection: { expect: 'skill-a', available: 'all' },
      variants: [{ name: 'my-variant', description: 'Desc', enabled: true }],
    })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      evals: [makeDiscovered(eval_)],
    })
    expect(results[0].variant).toBeUndefined()
    expect(results[1].variant).toBe('my-variant')
  })
})
