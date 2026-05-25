import { describe, expect, it } from 'vitest'
import { buildEffectivenessWorkItems } from '../../src/runner/effectiveness.js'
import type {
  DiscoveredEffectivenessFile,
  DiscoveredFixture,
  DiscoveredSkill,
  SkillFrontmatter,
} from '../../src/types.js'

function makeSkill(name: string, dirPath: string): DiscoveredSkill {
  return {
    name,
    description: 'Test skill',
    dirPath,
    frontmatter: { name, description: 'Test skill' } as SkillFrontmatter,
  }
}

function makeFixture(name: string): DiscoveredFixture {
  return { name, testsDir: `/tmp/fixtures/${name}/tests` }
}

function makeEffFile(
  skillName: string,
  evalOverrides: Record<string, unknown> = {},
  fileOverrides: Record<string, unknown> = {},
): DiscoveredEffectivenessFile {
  return {
    filePath: `/tmp/${skillName}/evals/effectiveness.yaml`,
    skillName,
    file: {
      timeout: 120,
      'run-mode': 'all',
      evals: [
        {
          name: 'test-eval',
          prompt: 'Do something',
          enabled: true,
          criteria: [{ name: 'correct', description: 'Is correct', pass_threshold: 0.8 }],
          variants: 'all',
          ...evalOverrides,
        },
      ],
      ...fileOverrides,
    },
  }
}

describe('buildEffectivenessWorkItems', () => {
  const skill = makeSkill('my-skill', '/tmp/my-skill')
  const fixture = makeFixture('fix-a')
  const defaultMatrix = {
    evaluators: [{ provider: 'anthropic' as const, model: 'claude-sonnet-4-5' }],
    judges: [{ provider: 'anthropic' as const, model: 'claude-sonnet-4-5' }],
  }

  it('generates current run with variantName "current"', () => {
    const items = buildEffectivenessWorkItems({
      skills: [skill],
      effectivenessFiles: [makeEffFile('my-skill')],
      fixtures: new Map([['my-skill', [fixture]]]),
      judges: new Map(),
      runId: 'test-run',
      defaultMatrix,
    })

    const currentItems = items.filter(i => i.variantName === 'current')
    expect(currentItems.length).toBeGreaterThan(0)
    expect(currentItems[0].variantSkillDir).toBe('/tmp/my-skill')
  })

  it('includes filesystem variants when discoveredVariants provided', () => {
    const items = buildEffectivenessWorkItems({
      skills: [skill],
      effectivenessFiles: [makeEffFile('my-skill')],
      fixtures: new Map([['my-skill', [fixture]]]),
      judges: new Map(),
      runId: 'test-run',
      defaultMatrix,
      discoveredVariants: new Map([
        ['my-skill', [{ name: 'terse', dirPath: '/tmp/variants/terse', description: 'Terse' }]],
      ]),
    })

    const variantItems = items.filter(i => i.variantName === 'terse')
    expect(variantItems.length).toBeGreaterThan(0)
    expect(variantItems[0].variantSkillDir).toBe('/tmp/variants/terse')
    expect(variantItems[0].inlineSkillContent).toBeUndefined()
  })

  it('respects run-mode current-only', () => {
    const items = buildEffectivenessWorkItems({
      skills: [skill],
      effectivenessFiles: [makeEffFile('my-skill', { 'run-mode': 'current-only' })],
      fixtures: new Map([['my-skill', [fixture]]]),
      judges: new Map(),
      runId: 'test-run',
      defaultMatrix,
      discoveredVariants: new Map([
        ['my-skill', [{ name: 'terse', dirPath: '/tmp/variants/terse', description: 'Terse' }]],
      ]),
    })

    expect(items.every(i => i.variantName === 'current')).toBe(true)
  })

  it('respects run-mode variants-only', () => {
    const items = buildEffectivenessWorkItems({
      skills: [skill],
      effectivenessFiles: [makeEffFile('my-skill', { 'run-mode': 'variants-only' })],
      fixtures: new Map([['my-skill', [fixture]]]),
      judges: new Map(),
      runId: 'test-run',
      defaultMatrix,
      discoveredVariants: new Map([
        ['my-skill', [{ name: 'terse', dirPath: '/tmp/variants/terse', description: 'Terse' }]],
      ]),
    })

    expect(items.every(i => i.variantName !== 'current')).toBe(true)
    expect(items.length).toBeGreaterThan(0)
  })

  it('sets inlineSkillContent for inline variants', () => {
    const fileWithInlineVariant = makeEffFile(
      'my-skill',
      {},
      {
        variants: [
          { name: 'inline-v', value: '---\nname: inline-v\n---\n\n# Inline', enabled: true },
        ],
      },
    )

    const items = buildEffectivenessWorkItems({
      skills: [skill],
      effectivenessFiles: [fileWithInlineVariant],
      fixtures: new Map([['my-skill', [fixture]]]),
      judges: new Map(),
      runId: 'test-run',
      defaultMatrix,
    })

    const inlineItems = items.filter(i => i.variantName === 'inline-v')
    expect(inlineItems.length).toBeGreaterThan(0)
    expect(inlineItems[0].inlineSkillContent).toContain('# Inline')
  })
})
