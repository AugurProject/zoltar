import { formatUniverseDisplayLabel, formatUniverseLabel } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import type { UniverseOption } from '@zoltar/ui-core-shared/components/UniverseSelector.js'

/** Uses the shared compact label, but never lets two selector options read the same: colliding entries fall back to their full label. */
export function buildLiveUniverseOptions(universeIds: readonly bigint[]): readonly UniverseOption[] {
	if (new Set(universeIds).size !== universeIds.length) throw new Error('Universe IDs must be unique')
	const compactLabels = universeIds.map(formatUniverseDisplayLabel)
	const collidingLabels = new Set(compactLabels.filter((label, index) => compactLabels.indexOf(label) !== index))
	return universeIds.map((universeId, index) => {
		const accessibleLabel = formatUniverseLabel(universeId)
		const compactLabel = compactLabels[index] ?? accessibleLabel
		return { id: universeId.toString(), label: collidingLabels.has(compactLabel) ? accessibleLabel : compactLabel, accessibleLabel }
	})
}
