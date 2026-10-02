import type { PublicOperationEntry } from '#state/operator-state'

/** Groups identical decisions in the bounded journal, keeping their latest timestamp and occurrence count. */
export function groupedOperations(operations: readonly PublicOperationEntry[]) {
	const groups = new Map<string, { operation: PublicOperationEntry; occurrences: number }>()
	for (const operation of operations) {
		if (operation.category === 'scan') continue
		const key = JSON.stringify([operation.category, operation.level, operation.reportId, operation.message, operation.reason, operation.details])
		const existing = groups.get(key)
		if (existing === undefined) groups.set(key, { operation, occurrences: 1 })
		else existing.occurrences += 1
	}
	return [...groups.values()]
}

/** Keeps provider payloads and long diagnostics out of the default table view. */
export function diagnosticSummary(text: string) {
	if (text.length <= 140 && !/0x[0-9a-f]{40}|\n|\{\s*"/i.test(text)) return text
	const prefix = text.split(':')[0]?.trim()
	if (prefix !== undefined && prefix.length > 0 && prefix.length <= 80 && !/0x|\n|\{/i.test(prefix)) return prefix.length < text.length ? prefix : `${prefix.slice(0, 77)}…`
	return 'Request failed'
}
