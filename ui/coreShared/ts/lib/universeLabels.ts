export function formatUniverseIdHex(universeId: bigint) {
	return `0x${universeId.toString(16)}`
}

const COMPACT_LABEL_MAX_LENGTH = 28
const COMPACT_PREFIX_HEX_LENGTH = 10
const COMPACT_SUFFIX_HEX_LENGTH = 6

/** Full universe label used for accessible names, titles, and anywhere width is not constrained. */
export function formatUniverseLabel(universeId: bigint) {
	return universeId === 0n ? `Genesis (${formatUniverseIdHex(universeId)})` : `Universe ${formatUniverseIdHex(universeId)}`
}

function abbreviateUniverseLabel(universeId: bigint, suffixHexLength: number) {
	const fullLabel = formatUniverseLabel(universeId)
	if (universeId === 0n || fullLabel.length <= COMPACT_LABEL_MAX_LENGTH) return fullLabel
	const universeIdHex = formatUniverseIdHex(universeId)
	if (COMPACT_PREFIX_HEX_LENGTH + suffixHexLength + 1 >= universeIdHex.length) return fullLabel
	return `Universe ${universeIdHex.slice(0, COMPACT_PREFIX_HEX_LENGTH)}…${universeIdHex.slice(-suffixHexLength)}`
}

/** Compact universe label for dense surfaces; genesis and short IDs keep their full label. */
export function formatUniverseDisplayLabel(universeId: bigint) {
	return abbreviateUniverseLabel(universeId, COMPACT_SUFFIX_HEX_LENGTH)
}

/**
 * Compact labels for a set of universes shown together, such as a switcher's options. When two compact labels would
 * read the same, the abbreviation keeps its prefix and shows more trailing hex digits until every label is distinct,
 * so the set stays readable at phone width instead of falling back to full 64-digit IDs.
 */
export function formatDistinctUniverseDisplayLabels(universeIds: readonly bigint[]): string[] {
	const longestHexLength = Math.max(0, ...universeIds.map(universeId => formatUniverseIdHex(universeId).length))
	for (let suffixHexLength = COMPACT_SUFFIX_HEX_LENGTH; suffixHexLength <= longestHexLength; suffixHexLength += 4) {
		const labels = universeIds.map(universeId => abbreviateUniverseLabel(universeId, suffixHexLength))
		if (new Set(labels).size === labels.length) return labels
	}
	return universeIds.map(formatUniverseLabel)
}
