function record(value: unknown) {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

function compact(value: Record<string, unknown>) {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function stringField(value: Record<string, unknown>, field: string) {
	return typeof value[field] === 'string' ? value[field] : undefined
}

function scalar(value: Record<string, unknown>, field: string) {
	return typeof value[field] === 'string' || typeof value[field] === 'number' ? value[field] : undefined
}

export function publicRetirement(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		blockers: Array.isArray(source['blockers'])
			? source['blockers'].map(entry => compact({ category: stringField(record(entry) ?? {}, 'category'), details: stringField(record(entry) ?? {}, 'details'), id: stringField(record(entry) ?? {}, 'id'), nextEligibleAt: stringField(record(entry) ?? {}, 'nextEligibleAt') }))
			: [],
		completionEvidence: source['completionEvidence'],
		finalSweepStartedAt: stringField(source, 'finalSweepStartedAt'),
		positions: Array.isArray(source['positions'])
			? source['positions'].map(entry => {
					const position = record(entry) ?? {}
					return compact({
						fee: scalar(position, 'fee'),
						id: stringField(position, 'id'),
						lastCheckedAtBlock: stringField(position, 'lastCheckedAtBlock'),
						owner: stringField(position, 'owner'),
						pool: stringField(position, 'pool'),
						positionKey: stringField(position, 'positionKey'),
						status: stringField(position, 'status'),
						tickLower: scalar(position, 'tickLower'),
						tickUpper: scalar(position, 'tickUpper'),
						token0: stringField(position, 'token0'),
						token1: stringField(position, 'token1'),
					})
				})
			: [],
		recipient: stringField(source, 'recipient'),
		requestedAt: stringField(source, 'requestedAt'),
		status: stringField(source, 'status'),
		updatedAt: stringField(source, 'updatedAt'),
	})
}

export function publicAlert(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({ message: stringField(source, 'message'), severity: stringField(source, 'severity') })
}
