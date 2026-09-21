import { formatDistinctUniverseDisplayLabels, formatUniverseLabel } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import type { UniverseOption } from '@zoltar/ui-core-shared/components/UniverseSelector.js'

/** Uses the shared compact labels, widened only as far as needed so no two selector options read the same. */
export function buildLiveUniverseOptions(universeIds: readonly bigint[]): readonly UniverseOption[] {
	if (new Set(universeIds).size !== universeIds.length) throw new Error('Universe IDs must be unique')
	const labels = formatDistinctUniverseDisplayLabels(universeIds)
	return universeIds.map((universeId, index) => {
		const accessibleLabel = formatUniverseLabel(universeId)
		return { id: universeId.toString(), label: labels[index] ?? accessibleLabel, accessibleLabel }
	})
}
