function formatUniverseLabel(universeId: bigint) {
	return universeId === 0n ? 'Genesis (0)' : `Universe ${ universeId.toString() }`
}

export function formatUniverseCollectionLabel(universeIds: bigint[]) {
	const uniqueUniverseIds = [...new Set(universeIds)]
	if (uniqueUniverseIds.length === 0) return formatUniverseLabel(0n)
	if (uniqueUniverseIds.length === 1) {
		const universeId = uniqueUniverseIds[0]
		if (universeId === undefined) return formatUniverseLabel(0n)
		return formatUniverseLabel(universeId)
	}
	return `Multiple (${ uniqueUniverseIds.map(universeId => universeId.toString()).join(', ') })`
}
