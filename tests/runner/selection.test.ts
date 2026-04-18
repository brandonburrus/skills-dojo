import { describe, expect, it, vi } from 'vitest'
import type { Evaluator, SelectionResult } from '../../src/providers/types.js'
import type {
  DiscoveredSelectionFile,
  DiscoveredSkill,
  SelectionEval,
  SelectionFile,
} from '../../src/types.js'
import { buildSkillList, evaluateResult, runSelectionEvals } from '../../src/runner/selection.js'

const makeSkill = (name: string, description = `${name} description`): DiscoveredSkill => ({
  name,
  description,
  dirPath: `/skills/${name}`,
  frontmatter: { name, description },
})

const makeEval = (overrides?: Partial<SelectionEval>): SelectionEval => ({
  name: 'test-eval',
  prompt: 'Pick a skill',
  enabled: true,
  variants: 'all',
  ...overrides,
})

const makeSelectionFile = (
  evals: SelectionEval[],
  overrides?: Partial<SelectionFile>,
  skillName: string | null = null,
): DiscoveredSelectionFile => ({
  filePath: '/evals/selection.yaml',
  skillName,
  file: {
    timeout: 30,
    skills: 'all',
    'run-mode': 'all',
    evals,
    ...overrides,
  },
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
  it('includes all skills when skills is "all"', () => {
    const result = buildSkillList(allSkills, 'all', [])
    expect(result).toEqual([
      { name: 'skill-a', description: 'skill-a description' },
      { name: 'skill-b', description: 'skill-b description' },
      { name: 'skill-c', description: 'skill-c description' },
    ])
  })

  it('filters skills when skills is a string array', () => {
    const result = buildSkillList(allSkills, ['skill-a'], [])
    expect(result).toEqual([{ name: 'skill-a', description: 'skill-a description' }])
  })

  it('appends decoys with value as description', () => {
    const result = buildSkillList(
      allSkills,
      ['skill-a'],
      [{ name: 'fake-skill', value: 'I am a decoy', enabled: true }],
    )
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({ name: 'fake-skill', description: 'I am a decoy' })
  })
})

describe('evaluateResult', () => {
  it('passes when assert array contains matching skill', () => {
    expect(evaluateResult(['skill-a'], { loaded: true, skillName: 'skill-a', raw: '' })).toBe(true)
  })

  it('fails when assert array does not contain loaded skill', () => {
    expect(evaluateResult(['skill-a'], { loaded: true, skillName: 'skill-b', raw: '' })).toBe(false)
  })

  it('fails for specific skill when not loaded', () => {
    expect(evaluateResult(['skill-a'], { loaded: false, skillName: null, raw: '' })).toBe(false)
  })

  it('passes when assert array has multiple skills and one matches', () => {
    expect(
      evaluateResult(['skill-a', 'skill-b'], { loaded: true, skillName: 'skill-b', raw: '' }),
    ).toBe(true)
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
    const eval_ = makeEval({ assert: ['skill-a'] })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([eval_])],
    })
    expect(results).toHaveLength(1)
    expect(results[0].passed).toBe(true)
    expect(results[0].expected).toBe('skill-a')
    expect(results[0].actual).toEqual({ loaded: true, skillName: 'skill-a' })
    expect(results[0].durationMs).toBeGreaterThan(0)
  })

  it('returns failed when evaluator returns wrong skill', async () => {
    const eval_ = makeEval({ assert: ['skill-a'] })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-b', raw: '' }),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([eval_])],
    })
    expect(results[0].passed).toBe(false)
  })

  it('captures error when evaluator throws', async () => {
    const eval_ = makeEval({ assert: ['skill-a'] })
    const results = await runSelectionEvals({
      evaluator: throwingEvaluator('connection timeout'),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([eval_])],
    })
    expect(results[0].passed).toBe(false)
    expect(results[0].error).toBe('connection timeout')
    expect(results[0].actual).toEqual({ loaded: false, skillName: null })
    expect(results[0].durationMs).toBeGreaterThan(0)
  })

  it('calls onProgress at start and completion of each eval', async () => {
    const eval_ = makeEval({ assert: ['skill-a'] })
    const onProgress = vi.fn()
    await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([eval_])],
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
    const s1 = makeEval({ name: 's1', assert: ['skill-a'] })
    const s2 = makeEval({ name: 's2', assert: ['skill-a'] })
    const ac = new AbortController()
    ac.abort()

    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([s1, s2])],
      signal: ac.signal,
    })

    expect(results).toHaveLength(0)
  })
})

describe('runSelectionEvals variants', () => {
  it('runs only base when no file-level variants and variants="all"', async () => {
    const eval_ = makeEval({ assert: ['skill-a'] })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([eval_])],
    })
    expect(results).toHaveLength(1)
    expect(results[0].variant).toBeUndefined()
  })

  it('runs base + file-level variants when variants="all"', async () => {
    const eval_ = makeEval({ assert: ['skill-a'] })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [
        makeSelectionFile([eval_], {
          variants: [{ name: 'concise', value: 'Short desc', enabled: true }],
        }),
      ],
    })
    expect(results).toHaveLength(2)
    expect(results[0].variant).toBeUndefined()
    expect(results[1].variant).toBe('concise')
  })

  it('runs subset of file-level variants when variants is string[]', async () => {
    const eval_ = makeEval({ assert: ['skill-a'], variants: ['concise'] })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [
        makeSelectionFile([eval_], {
          variants: [
            { name: 'concise', value: 'Short desc', enabled: true },
            { name: 'verbose', value: 'Long desc', enabled: true },
          ],
        }),
      ],
    })
    expect(results).toHaveLength(2)
    expect(results[0].variant).toBeUndefined()
    expect(results[1].variant).toBe('concise')
  })

  it('runs inline variants defined on the eval', async () => {
    const eval_ = makeEval({
      assert: ['skill-a'],
      variants: [{ name: 'verbose', value: 'Long desc', enabled: true }],
    })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([eval_])],
    })
    expect(results).toHaveLength(2)
    expect(results[1].variant).toBe('verbose')
  })

  it('run-mode="current-only" runs only base', async () => {
    const eval_ = makeEval({ assert: ['skill-a'] })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [
        makeSelectionFile([eval_], {
          'run-mode': 'current-only',
          variants: [{ name: 'v1', value: 'Variant', enabled: true }],
        }),
      ],
    })
    expect(results).toHaveLength(1)
    expect(results[0].variant).toBeUndefined()
  })

  it('run-mode="variants-only" runs only variants', async () => {
    const eval_ = makeEval({ assert: ['skill-a'] })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [
        makeSelectionFile([eval_], {
          'run-mode': 'variants-only',
          variants: [{ name: 'v1', value: 'Variant', enabled: true }],
        }),
      ],
    })
    expect(results).toHaveLength(1)
    expect(results[0].variant).toBe('v1')
  })

  it('skips disabled variants', async () => {
    const eval_ = makeEval({
      assert: ['skill-a'],
      variants: [
        { name: 'enabled-v', value: 'Active', enabled: true },
        { name: 'disabled-v', value: 'Inactive', enabled: false },
      ],
    })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([eval_])],
    })
    expect(results).toHaveLength(2)
    expect(results[1].variant).toBe('enabled-v')
  })

  it('includes variant name in result for variant runs, undefined for base', async () => {
    const eval_ = makeEval({
      assert: ['skill-a'],
      variants: [{ name: 'my-variant', value: 'Desc', enabled: true }],
    })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [makeSelectionFile([eval_])],
    })
    expect(results[0].variant).toBeUndefined()
    expect(results[1].variant).toBe('my-variant')
  })

  it('runs variants for assert "none" based on run-mode', async () => {
    const eval_ = makeEval({ assert: 'none' })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: false, skillName: null, raw: '' }),
      skills: allSkills,
      selectionFiles: [
        makeSelectionFile([eval_], {
          variants: [{ name: 'v1', value: 'Variant', enabled: true }],
        }),
      ],
    })
    expect(results).toHaveLength(2)
  })

  it('runs variants for assert "any" based on run-mode', async () => {
    const eval_ = makeEval({ assert: 'any' })
    const results = await runSelectionEvals({
      evaluator: mockEvaluator({ loaded: true, skillName: 'skill-a', raw: '' }),
      skills: allSkills,
      selectionFiles: [
        makeSelectionFile([eval_], {
          variants: [{ name: 'v1', value: 'Variant', enabled: true }],
        }),
      ],
    })
    expect(results).toHaveLength(2)
  })
})
