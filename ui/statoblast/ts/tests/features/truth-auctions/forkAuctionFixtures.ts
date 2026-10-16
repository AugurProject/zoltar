import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import type { ForkAuctionDetails, ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { ForkAuctionSectionProps } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { ForkAuctionFormState } from '@zoltar/ui-statoblast-shared/types/app.js'
import { createSelectedPool } from '../security-pools/workflow/builders.js'

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

/** An operational YES child pool of the parent pool on universe 11, without underwriting. */
export function createForkChildPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return createSelectedPool({
		feeEligibleUnderwritingLimitAttoEth: 0n,
		forkOutcome: 'yes',
		hasForkActivity: true,
		migratedAttoRep: 1n,
		parent: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		totalUnderwritingLimitAttoEth: 0n,
		truthAuctionStartedAt: 1n,
		universeHasForked: true,
		universeId: 11n,
		...overrides,
	})
}

/** Fork-auction section props with no-op callbacks, no pending action, and the empty parent-pool form. */
export function createForkAuctionSectionProps(forkAuctionDetails: ForkAuctionDetails | undefined, overrides: Partial<ForkAuctionSectionProps> = {}): ForkAuctionSectionProps {
	return {
		accountState: createAccountState(),
		forkAuctionActiveAction: undefined,
		forkAuctionDetails,
		forkAuctionError: undefined,
		forkAuctionForm: createForkAuctionForm(),
		forkAuctionResult: undefined,
		loadingForkAuctionDetails: false,
		onClaimAuctionProceeds: () => undefined,
		onClaimParentEscalationDeposits: () => undefined,
		onCreateChildUniverse: () => undefined,
		onFinalizeTruthAuction: () => undefined,
		onForkAuctionFormChange: () => undefined,
		onForkUniverse: () => undefined,
		onForkWithOwnEscalation: () => undefined,
		onInitiateFork: () => undefined,
		onLoadForkAuction: () => undefined,
		onMigrateRepToZoltar: () => undefined,
		onMigrateUnresolvedEscalation: _selectedChildOutcome => undefined,
		onMigrateVault: () => undefined,
		onRefundLosingBids: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		onWithdrawForkedEscalation: (_outcome, _parentDepositIndexes) => undefined,
		securityPools: [],
		...overrides,
	}
}
