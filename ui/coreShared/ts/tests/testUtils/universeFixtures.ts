import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { ZoltarUniverseSummary } from '../../types/contracts.js'

/** Universe 1, an unforked child of genesis with a minimal REP supply; tests override the fields they exercise. */
export function createUniverseSummary(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkQuestionDetails: undefined,
		forkThresholdAttoRep: 1n,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1n,
		universeId: 1n,
		...overrides,
	}
}

/** Binary fork: Invalid=0, Yes=1 and No=2; the Yes child is deployed. */
export function createForkedUniverseSummary(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return createUniverseSummary({
		childUniverses: [
			{ exists: false, forkTime: 1n, outcomeIndex: 0n, outcomeLabel: 'Invalid', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 4n },
			{ exists: true, forkTime: 1n, outcomeIndex: 1n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 2n },
			{ exists: false, forkTime: 1n, outcomeIndex: 2n, outcomeLabel: 'No', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 3n },
		],
		forkTime: 1n,
		hasForked: true,
		...overrides,
	})
}
