export function formatUniverseIdHex(universeId: bigint) {
	return `0x${universeId.toString(16)}`
}

/** Full universe label used for accessible names, titles, and anywhere width is not constrained. */
export function formatUniverseLabel(universeId: bigint) {
	return universeId === 0n ? `Genesis (${formatUniverseIdHex(universeId)})` : `Universe ${formatUniverseIdHex(universeId)}`
}

/** Compact universe label for dense surfaces; genesis and short IDs keep their full label. */
export function formatUniverseDisplayLabel(universeId: bigint) {
	const fullLabel = formatUniverseLabel(universeId)
	if (universeId === 0n || fullLabel.length <= 28) return fullLabel
	const universeIdHex = formatUniverseIdHex(universeId)
	return `Universe ${universeIdHex.slice(0, 10)}…${universeIdHex.slice(-6)}`
}
