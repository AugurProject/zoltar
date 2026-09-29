import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ForkAuctionFormState } from '@zoltar/ui-zoltar-shared/types/app.js'

export const PARENT_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f0'

/** An empty fork-auction form addressed to the parent pool with the YES outcome selected. */
export function createForkAuctionForm(overrides: Partial<ForkAuctionFormState> = {}): ForkAuctionFormState {
	return {
		claimBidIndex: '',
		claimBidTick: '',
		depositIndexes: '',
		directForkQuestionId: '',
		directForkUniverseId: '',
		refundBidIndex: '',
		refundTick: '',
		repMigrationOutcomes: '',
		securityPoolAddress: PARENT_POOL_ADDRESS,
		selectedOutcome: 'yes',
		settlementAddress: '',
		submitBidAmount: '',
		submitBidPrice: '',
		vaultAddress: '',
		...overrides,
	}
}
