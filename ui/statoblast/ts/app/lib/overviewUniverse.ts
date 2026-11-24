import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'

/**
 * The top bar's universe state, as in Zoltar: a `?universe=` that names no deployed universe shows the shared not-found hint with
 * its Go to root universe recovery on every Statoblast view, instead of labelling the universe as if it existed.
 */
export function getStatoblastUniversePresentation({ canReadOnchainData, loadingZoltarUniverse, zoltarUniverse, zoltarUniverseMissing }: { canReadOnchainData: boolean; loadingZoltarUniverse: boolean; zoltarUniverse: object | undefined; zoltarUniverseMissing: boolean }) {
	const universeState = resolveLoadableValueState({ isLoading: loadingZoltarUniverse, isMissing: zoltarUniverseMissing, value: zoltarUniverse })
	return canReadOnchainData && universeState === 'missing' ? getUniversePresentation(universeState) : undefined
}
