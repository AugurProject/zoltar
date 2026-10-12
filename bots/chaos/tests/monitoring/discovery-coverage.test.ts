import { expect, test } from 'bun:test'
import { canonicalDiscoveryIssues, discoveryCoverageIsComplete, formatDiscoveryWarnings, registryDiscoveryIssue } from '../../src/monitoring/discovery-coverage.ts'
import { emptyCountedRegistryCursor } from '../../src/monitoring/topology-schema.ts'
import type { DiscoveryIssue } from '../../src/operations/types.ts'

test('structured discovery issues block execution independently of warning text', () => {
	expect(discoveryCoverageIsComplete([{ kind: 'universe-limit', retained: 2, limit: 2 }])).toBeFalse()
})

test('captures registry progress without retaining its mutable cursor', () => {
	const cursor = { ...emptyCountedRegistryCursor(), nextIndex: '1', canonicalCount: '3', residentLimit: '2' }
	const issue = registryDiscoveryIssue('questions', 'Question', cursor)
	cursor.nextIndex = '3'
	expect(issue).toEqual({ kind: 'registry', collection: 'questions', label: 'Question', authenticated: '1', canonicalCount: '3', residentLimit: '2' })
	expect(discoveryCoverageIsComplete([issue])).toBeFalse()
})

test('normalizes concurrent issue order and remains JSON serializable for quorum comparison', () => {
	const question = registryDiscoveryIssue('questions', 'Question', { ...emptyCountedRegistryCursor(), nextIndex: '1', canonicalCount: '2', residentLimit: '2' })
	const universe = { kind: 'universe-limit', retained: 2, limit: 2 } as const
	const first = canonicalDiscoveryIssues([universe, question, universe])
	const second = canonicalDiscoveryIssues([question, universe])
	expect(JSON.stringify(first)).toBe(JSON.stringify(second))
	expect(first).toHaveLength(2)
	expect(formatDiscoveryWarnings(first)).toEqual(['Question discovery truncated while bounded catch-up authenticated 1 of 2 canonical entries', 'Universe discovery truncated at 2 retained universes because the configured resident limit is 2'])
})

test('orders issues by machine kind rather than the label used in warning text', () => {
	const vaults = registryDiscoveryIssue('vaults', 'Vault', { ...emptyCountedRegistryCursor(), nextIndex: '1', canonicalCount: '2', residentLimit: '2' })
	const universe: DiscoveryIssue = { kind: 'universe-limit', retained: 2, limit: 2 }
	expect(canonicalDiscoveryIssues([universe, vaults]).map(issue => issue.kind)).toEqual(['registry', 'universe-limit'])
})

test('distinguishes issues that render the same warning and resolves sorting ties deterministically', () => {
	const cursor = { ...emptyCountedRegistryCursor(), nextIndex: '1', canonicalCount: '2', residentLimit: '2' }
	const pools = registryDiscoveryIssue('pools', 'Registry', cursor)
	const questions = registryDiscoveryIssue('questions', 'Registry', cursor)
	expect(formatDiscoveryWarnings([pools, questions])).toHaveLength(1)
	expect(canonicalDiscoveryIssues([pools, questions])).toHaveLength(2)
	expect(JSON.stringify(canonicalDiscoveryIssues([pools, questions]))).toBe(JSON.stringify(canonicalDiscoveryIssues([questions, pools])))
})

test('deduplicates equivalent issues regardless of property insertion order', () => {
	const first: DiscoveryIssue = { kind: 'universe-limit', retained: 2, limit: 2 }
	const reordered: DiscoveryIssue = { limit: 2, retained: 2, kind: 'universe-limit' }
	expect(canonicalDiscoveryIssues([first, reordered])).toEqual([first])
	expect(JSON.stringify(canonicalDiscoveryIssues([first]))).toBe(JSON.stringify(canonicalDiscoveryIssues([reordered])))
})

test('normalizes decimal count representations before ordering and deduplicating', () => {
	const issue = registryDiscoveryIssue('pools', 'Pool', { ...emptyCountedRegistryCursor(), nextIndex: '1', canonicalCount: '3', residentLimit: '2' })
	const padded = { ...issue, authenticated: '01', canonicalCount: '03', residentLimit: '02' }
	expect(canonicalDiscoveryIssues([padded, issue])).toEqual([issue])
})
