import { hashCarryLeaf as hashLeaf, type CarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'

export { bagCarryPeaks, buildCarryMerkleMountainRangeProof, buildCarryPeakHeights, compareBigintAscending, createSparseNullifier } from '@zoltar/core-shared/evm/carryProof'

export const hashCarryLeaf = (leaf: CarryLeaf, outcome: ReportingOutcomeKey) => hashLeaf(leaf, getReportingOutcomeValue(outcome))
