import type { Hex } from '@zoltar/core-shared/evm/ethereum'
import { bagCarryPeaks, buildCarryPeakHeights, hashCarryLeaf as hashLeaf, type CarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'

export { buildCarryMerkleMountainRangeProof, compareBigintAscending, createSparseNullifier } from '@zoltar/core-shared/evm/carryProof'

export const hashCarryLeaf = (leaf: CarryLeaf, outcome: ReportingOutcomeKey) => hashLeaf(leaf, getReportingOutcomeValue(outcome))

export function getCarrySnapshotRoot(leafCount: bigint, snapshotPeaks: readonly Hex[]) {
	return bagCarryPeaks(
		buildCarryPeakHeights(leafCount)
			.sort((left, right) => left - right)
			.map(peakHeight => {
				const peak = snapshotPeaks[peakHeight]
				if (peak === undefined) throw new Error('Missing parent carry snapshot peak.')
				return peak
			}),
	)
}
