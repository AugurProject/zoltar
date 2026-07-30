function canonical(value: unknown): string {
	if (typeof value === 'bigint') return `bigint:${value.toString()}`
	if (value === undefined) return 'undefined'
	if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value === 'object') {
		const entries = Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
		return `{${entries.join(',')}}`
	}
	throw new Error(`Unsupported quorum value type: ${typeof value}`)
}

export function quorumValue<T>(label: string, observations: readonly { endpoint: string; value: T }[]) {
	const uniqueEndpoints = new Set(observations.map(observation => observation.endpoint))
	if (uniqueEndpoints.size < 2) throw new Error(`${label} requires at least two independent RPC endpoints`)
	const first = observations[0]
	if (first === undefined) throw new Error(`${label} requires at least two independent RPC endpoints`)
	const expected = canonical(first.value)
	const disagreement = observations.find(observation => canonical(observation.value) !== expected)
	if (disagreement !== undefined) throw new Error(`RPC disagreement for ${label}: ${first.endpoint} and ${disagreement.endpoint} returned different values`)
	return first.value
}

export async function readWithQuorum<T>(label: string, endpoints: readonly string[], read: (endpoint: string) => Promise<T>) {
	const observations = await Promise.all(endpoints.map(async endpoint => ({ endpoint, value: await read(endpoint) })))
	return quorumValue(label, observations)
}
