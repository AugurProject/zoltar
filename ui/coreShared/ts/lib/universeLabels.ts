export function formatUniverseIdHex(universeId: bigint) {
	return `0x${universeId.toString(16)}`
}

/** Full universe label used for accessible names, titles, and anywhere width is not constrained. */
export function formatUniverseLabel(universeId: bigint) {
	return universeId === 0n ? `Genesis (${formatUniverseIdHex(universeId)})` : `Universe ${formatUniverseIdHex(universeId)}`
}

/** Short, stable hex name for a universe, such as `0x3228b6…5fb5`; short IDs stay whole. */
export function formatShortUniverseId(universeId: bigint) {
	const universeIdHex = formatUniverseIdHex(universeId)
	if (universeIdHex.length <= 14) return universeIdHex
	return `${universeIdHex.slice(0, 8)}…${universeIdHex.slice(-4)}`
}

/** Compact universe label for dense surfaces; genesis and short IDs keep their full label. */
export function formatUniverseDisplayLabel(universeId: bigint) {
	return universeId === 0n ? formatUniverseLabel(universeId) : `Universe ${formatShortUniverseId(universeId)}`
}
