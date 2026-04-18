/**
 * Converts a glob pattern (with `*` and `?` wildcards) into a RegExp.
 * Matching is case-insensitive. A pattern without wildcards
 * behaves as a substring match for backward compatibility.
 */
export function globMatch(pattern: string, value: string): boolean {
  const lower = value.toLowerCase()
  const p = pattern.toLowerCase()

  if (!p.includes('*') && !p.includes('?')) {
    return lower.includes(p)
  }

  const escaped = p.replace(/([.+^${}()|[\]\\])/g, '\\$1')
  const regex = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${regex}$`).test(lower)
}
