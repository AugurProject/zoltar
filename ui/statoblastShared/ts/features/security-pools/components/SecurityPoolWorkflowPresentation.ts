import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { ForkAuctionDetails, ListedSecurityPool, OracleQueueOperation } from '@zoltar/ui-core-shared/types/contracts.js'

export function buildSelectedPoolSummaryPool({ forkAuctionDetails, selectedPool }: { forkAuctionDetails: ForkAuctionDetails | undefined; selectedPool: ListedSecurityPool | undefined }) {
	if (selectedPool === undefined) return undefined
	if (forkAuctionDetails === undefined) return selectedPool
	return {
		...selectedPool,
		settlementCollateralAttoEth: forkAuctionDetails.settlementCollateralAttoEth,
		hasForkActivity: forkAuctionDetails.hasForkActivity,
		forkOutcome: forkAuctionDetails.forkOutcome,
		forkOwnSecurityPool: forkAuctionDetails.forkOwnSecurityPool,
		marketDetails: forkAuctionDetails.marketDetails,
		migratedAttoRep: forkAuctionDetails.migratedAttoRep,
		questionOutcome: forkAuctionDetails.questionOutcome,
		securityPoolAddress: forkAuctionDetails.securityPoolAddress,
		systemState: forkAuctionDetails.systemState,
		truthAuctionAddress: forkAuctionDetails.truthAuctionAddress,
		truthAuctionStartedAt: forkAuctionDetails.truthAuctionStartedAt,
		universeId: forkAuctionDetails.universeId,
	}
}

export function getPendingOperationLabel(operation: OracleQueueOperation) {
	switch (operation) {
		case 'liquidation':
			return securityPoolCopy.liquidation
		case 'setVaultUnderwritingLimit':
			return securityPoolCopy.setVaultUnderwritingLimit
		case 'withdrawRep':
			return securityPoolCopy.withdrawRep
		default:
			return assertNever(operation)
	}
}

export function getPendingOperationAmountPresentation(operation: OracleQueueOperation) {
	switch (operation) {
		case 'liquidation':
			return { summaryLabel: securityPoolCopy.requestedLiquidationDebt, suffix: commonCopy.eth, units: 18 }
		case 'withdrawRep':
			// The action heading and REP amount already identify a withdrawal.
			return { summaryLabel: undefined, suffix: commonCopy.rep, units: 18 }
		case 'setVaultUnderwritingLimit':
			return { summaryLabel: securityPoolCopy.vaultBackingFactor, suffix: commonCopy.eth, units: 18 }
		default:
			return assertNever(operation)
	}
}
export function getStagedOperationExecutionModeLabel(operationId: bigint, pendingSettlementOperationIds: bigint[]) {
	return pendingSettlementOperationIds.includes(operationId) ? securityPoolCopy.autoExecPending : securityPoolCopy.manualExecution
}
