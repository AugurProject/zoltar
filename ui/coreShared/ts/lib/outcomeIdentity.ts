import * as universeCopy from '../copy/universes.js'
import { escapeOnChainText } from './onChainText.js'
import { formatShortUniverseId } from './universeLabels.js'

/**
 * Categorical and binary outcomes are numbered from zero; a scalar outcome's index packs its tick into a 256-bit value
 * that means nothing to a reader, so only small indexes are shown and scalar outcomes rely on their child universe ID.
 */
const LARGEST_DISPLAYED_OUTCOME_INDEX = 0xffff_ffffn

/** A categorical label is built from its immutable index (`Outcome 1: Alpha`, or `Outcome 1` when blank), so it already names that index. */
function labelNamesIndex(label: string, index: string) {
	return label === universeCopy.formatUnnamedOutcome(index) || label.startsWith(universeCopy.formatIndexedOutcome('', index))
}

function displayedOutcomeIndex(label: string, outcomeIndex: bigint) {
	if (outcomeIndex < 0n || outcomeIndex > LARGEST_DISPLAYED_OUTCOME_INDEX) return undefined
	const index = outcomeIndex.toString()
	return labelNamesIndex(label, index) ? undefined : index
}

/**
 * The immutable outcome index and short child universe ID that tell look-alike on-chain outcome labels apart (#1477), such
 * as `#1 · 0x3228b6…5fb5`, or `· 0x3228b6…5fb5` when the label already names the index or the index is a packed scalar one.
 */
export function formatOutcomeIdentityText(label: string, outcomeIndex: bigint, universeId: bigint | undefined) {
	const index = displayedOutcomeIndex(label, outcomeIndex)
	const indexText = index === undefined ? undefined : universeCopy.formatOutcomeIndex(index)
	if (universeId === undefined) return indexText
	const universe = formatShortUniverseId(universeId)
	return indexText === undefined ? universeCopy.formatOutcomeUniverse(universe) : universeCopy.formatOutcomeWithUniverse(indexText, universe)
}

/**
 * An escaped on-chain label followed by its identity, such as `Yes #1 · 0x3228b6…5fb5` or `Outcome 1: Alpha · 0x3228b6…5fb5`:
 * the one order used by cards, chips, pickers, reviews, dialogs and accessible names.
 */
export function formatLabelWithIdentity(label: string, outcomeIndex: bigint, universeId: bigint | undefined) {
	const escaped = escapeOnChainText(label)
	const identity = formatOutcomeIdentityText(label, outcomeIndex, universeId)
	return identity === undefined ? escaped : universeCopy.formatOutcomeWithIdentity(escaped, identity)
}
