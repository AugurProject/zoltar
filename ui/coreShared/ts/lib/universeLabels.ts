export function formatUniverseIdHex(universeId: bigint) {
	return `0x${universeId.toString(16)}`
}

const COMPACT_LABEL_MAX_LENGTH = 28
/** Characters of the `0x…` ID kept before the ellipsis: the `0x` prefix plus eight hex digits. */
const COMPACT_PREFIX_LENGTH = 10
const COMPACT_SUFFIX_HEX_LENGTH = 6
/** The widest suffix that still fits a phone-width toolbar slot; beyond it a label would be ellipsized on exactly the digits that tell the options apart. */
const MAX_DISTINCT_SUFFIX_HEX_LENGTH = 18

/** Full universe label used for accessible names, titles, and anywhere width is not constrained. */
export function formatUniverseLabel(universeId: bigint) {
	return universeId === 0n ? `Genesis (${formatUniverseIdHex(universeId)})` : `Universe ${formatUniverseIdHex(universeId)}`
}

function abbreviateUniverseLabel(universeId: bigint, suffixHexLength: number) {
	const fullLabel = formatUniverseLabel(universeId)
	if (universeId === 0n || fullLabel.length <= COMPACT_LABEL_MAX_LENGTH) return fullLabel
	const universeIdHex = formatUniverseIdHex(universeId)
	if (COMPACT_PREFIX_LENGTH + suffixHexLength + 1 >= universeIdHex.length) return fullLabel
	return `Universe ${universeIdHex.slice(0, COMPACT_PREFIX_LENGTH)}…${universeIdHex.slice(-suffixHexLength)}`
}

/** Compact universe label for dense surfaces; genesis and short IDs keep their full label. */
export function formatUniverseDisplayLabel(universeId: bigint) {
	return abbreviateUniverseLabel(universeId, COMPACT_SUFFIX_HEX_LENGTH)
}

/**
 * Compact labels for a set of universes shown together, such as a switcher's options. When two compact labels would
 * read the same, the abbreviation keeps its prefix and shows more trailing hex digits until every label is distinct,
 * so the set stays readable at phone width instead of falling back to full 64-digit IDs. IDs that still collide at the
 * widest phone-friendly suffix (sharing eight leading and eighteen trailing digits) fall back to their full labels.
 */
export function formatDistinctUniverseDisplayLabels(universeIds: readonly bigint[]): string[] {
	for (let suffixHexLength = COMPACT_SUFFIX_HEX_LENGTH; suffixHexLength <= MAX_DISTINCT_SUFFIX_HEX_LENGTH; suffixHexLength += 4) {
		const labels = universeIds.map(universeId => abbreviateUniverseLabel(universeId, suffixHexLength))
		if (new Set(labels).size === labels.length) return labels
	}
	return universeIds.map(formatUniverseLabel)
}
