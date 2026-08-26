import * as copy from '../copy/app.js'

export type UniverseOption = Readonly<{ id: string; label: string; accessibleLabel?: string }>

export function compactUniqueUniverseIds(universeIds: readonly string[]) {
	if (new Set(universeIds).size !== universeIds.length) throw new Error('Universe IDs must be unique')
	let edgeLength = 3
	while (true) {
		const labels = universeIds.map(universeId => (universeId.length <= edgeLength * 2 + 1 ? universeId : `${universeId.slice(0, edgeLength)}…${universeId.slice(-edgeLength)}`))
		if (new Set(labels).size === labels.length) return labels
		edgeLength++
	}
}

export function buildLiveUniverseOptions(universeIds: readonly bigint[]): readonly UniverseOption[] {
	const ids = universeIds.map(universeId => universeId.toString())
	const compactIds = compactUniqueUniverseIds(ids)
	return universeIds.map((universeId, index) => {
		const id = ids[index]
		const compactId = compactIds[index]
		if (id === undefined || compactId === undefined) throw new Error('Universe label generation failed')
		return universeId === 0n ? { id, label: copy.genesisUniverse, accessibleLabel: copy.genesisUniverse } : { id, label: copy.universeLabel(compactId), accessibleLabel: copy.universeLabel(id) }
	})
}
