import type { DiscoveryIssue } from '../operations/types.ts'
import type { CountedRegistryCursor } from './topology-schema.ts'

export function discoveryCoverageIsComplete(issues: readonly DiscoveryIssue[]) {
	return issues.length === 0
}

export function registryDiscoveryIssue(collection: 'questions' | 'pools' | 'vaults', label: string, cursor: CountedRegistryCursor): DiscoveryIssue {
	return { kind: 'registry', collection, label, authenticated: cursor.nextIndex, canonicalCount: cursor.canonicalCount, residentLimit: cursor.residentLimit }
}

function formatDiscoveryIssue(issue: DiscoveryIssue): string {
	switch (issue.kind) {
		case 'registry':
			return BigInt(issue.authenticated) < BigInt(issue.canonicalCount)
				? `${issue.label} discovery truncated while bounded catch-up authenticated ${issue.authenticated} of ${issue.canonicalCount} canonical entries`
				: `${issue.label} discovery truncated after authenticating the exact canonical total ${issue.canonicalCount}; configured resident safety envelope cannot hold complete topology (entry limit ${issue.residentLimit})`
		case 'universe-limit':
			return `Universe discovery truncated at ${issue.retained.toString()} retained universes because the configured resident limit is ${issue.limit.toString()}`
		case 'pool-prerequisites':
			return `Pool discovery truncated while prerequisite question or universe topology is incomplete; authenticated ${issue.authenticated} of ${issue.canonicalCount} canonical pool entries`
		case 'staged-operation-limit':
			return `Staged-operation discovery truncated for ${issue.coordinator}: exact canonical total ${issue.count} exceeds the configured ${issue.limit.toString()}-entry resident limit`
		case 'share-fanout':
			return `Share-inventory discovery truncated because planned approval and migration fan-out is at least ${issue.plannedFanout} entries, exceeding the configured ${issue.limit.toString()}-entry aggregate limit`
		default: {
			const unexpected: never = issue
			throw new Error(`Unsupported discovery issue: ${JSON.stringify(unexpected)}`)
		}
	}
}

/** Fix property order and count representation before constructing a machine identity. */
function normalizeDiscoveryIssue(issue: DiscoveryIssue): DiscoveryIssue {
	switch (issue.kind) {
		case 'registry':
			return { kind: issue.kind, collection: issue.collection, label: issue.label, authenticated: BigInt(issue.authenticated).toString(), canonicalCount: BigInt(issue.canonicalCount).toString(), residentLimit: BigInt(issue.residentLimit).toString() }
		case 'universe-limit':
			return { kind: issue.kind, retained: issue.retained, limit: issue.limit }
		case 'pool-prerequisites':
			return { kind: issue.kind, authenticated: BigInt(issue.authenticated).toString(), canonicalCount: BigInt(issue.canonicalCount).toString() }
		case 'staged-operation-limit':
			return { kind: issue.kind, coordinator: issue.coordinator, count: BigInt(issue.count).toString(), limit: issue.limit }
		case 'share-fanout':
			return { kind: issue.kind, plannedFanout: BigInt(issue.plannedFanout).toString(), limit: issue.limit }
		default: {
			const unexpected: never = issue
			throw new Error(`Unsupported discovery issue: ${JSON.stringify(unexpected)}`)
		}
	}
}

export function canonicalDiscoveryIssues(issues: readonly DiscoveryIssue[]) {
	const byKey = new Map<string, DiscoveryIssue>()
	for (const issue of issues) {
		const normalized = normalizeDiscoveryIssue(issue)
		byKey.set(JSON.stringify(normalized), normalized)
	}
	// Code-unit ordering is independent of both display wording and the process locale.
	return [...byKey]
		.sort(([left], [right]) => {
			if (left === right) return 0
			return left < right ? -1 : 1
		})
		.map(([, issue]) => issue)
}

export function formatDiscoveryWarnings(issues: readonly DiscoveryIssue[]) {
	return [...new Set(issues.map(formatDiscoveryIssue))].sort((left, right) => left.localeCompare(right))
}
