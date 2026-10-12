import { expect, test } from 'bun:test'
import { canonicalDiscoveryIssues, discoveryCoverageIsComplete, formatDiscoveryWarnings, registryDiscoveryIssue } from '../../src/monitoring/discovery-coverage.ts'
import { emptyCountedRegistryCursor } from '../../src/monitoring/topology-schema.ts'

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
