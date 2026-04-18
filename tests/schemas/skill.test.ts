import { describe, expect, it } from 'vitest'
import { SkillFrontmatterSchema } from '../../src/schemas/skill.js'

describe('SkillFrontmatterSchema', () => {
  const validSkill = {
    name: 'my-skill',
    description: 'A useful skill',
  }

  it('parses valid minimal frontmatter', () => {
    const result = SkillFrontmatterSchema.parse(validSkill)
    expect(result.name).toBe('my-skill')
    expect(result.description).toBe('A useful skill')
  })

  it('parses full frontmatter', () => {
    const result = SkillFrontmatterSchema.parse({
      ...validSkill,
      license: 'MIT',
      compatibility: 'copilot, cursor',
      metadata: { author: 'test' },
      'allowed-tools': 'Read Edit Bash',
    })
    expect(result.license).toBe('MIT')
    expect(result['allowed-tools']).toBe('Read Edit Bash')
  })

  it('rejects missing name', () => {
    expect(() => SkillFrontmatterSchema.parse({ description: 'test' })).toThrow()
  })

  it('rejects missing description', () => {
    expect(() => SkillFrontmatterSchema.parse({ name: 'test' })).toThrow()
  })

  it('rejects uppercase in name', () => {
    expect(() => SkillFrontmatterSchema.parse({ ...validSkill, name: 'MySkill' })).toThrow()
  })

  it('rejects name starting with hyphen', () => {
    expect(() => SkillFrontmatterSchema.parse({ ...validSkill, name: '-skill' })).toThrow()
  })

  it('rejects name ending with hyphen', () => {
    expect(() => SkillFrontmatterSchema.parse({ ...validSkill, name: 'skill-' })).toThrow()
  })

  it('rejects consecutive hyphens in name', () => {
    expect(() => SkillFrontmatterSchema.parse({ ...validSkill, name: 'my--skill' })).toThrow()
  })

  it('rejects name longer than 64 chars', () => {
    expect(() => SkillFrontmatterSchema.parse({ ...validSkill, name: 'a'.repeat(65) })).toThrow()
  })

  it('accepts max length name', () => {
    const result = SkillFrontmatterSchema.parse({ ...validSkill, name: 'a'.repeat(64) })
    expect(result.name).toHaveLength(64)
  })

  it('rejects description longer than 1024 chars', () => {
    expect(() =>
      SkillFrontmatterSchema.parse({ ...validSkill, description: 'a'.repeat(1025) }),
    ).toThrow()
  })

  it('rejects compatibility longer than 500 chars', () => {
    expect(() =>
      SkillFrontmatterSchema.parse({ ...validSkill, compatibility: 'a'.repeat(501) }),
    ).toThrow()
  })
})
