import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { type SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import type { ForkAuctionDetails, ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'

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

export function getPendingOperationLabel(operation: 'liquidation' | 'withdrawRep') {
	switch (operation) {
		case 'liquidation':
			return securityPoolCopy.liquidation
		case 'withdrawRep':
			return securityPoolCopy.withdrawRep
		default:
			return assertNever(operation)
	}
}

export function getPendingOperationAmountPresentation(operation: 'liquidation' | 'withdrawRep') {
	switch (operation) {
		case 'liquidation':
			return { label: securityPoolCopy.requestedLiquidationDebt, suffix: commonCopy.eth }
		case 'withdrawRep':
			return { label: securityPoolCopy.repWithdrawal, suffix: commonCopy.rep }
		default:
			return assertNever(operation)
	}
}
export function getStagedOperationExecutionModeLabel(operationId: bigint, pendingSettlementOperationIds: bigint[]) {
	return pendingSettlementOperationIds.includes(operationId) ? securityPoolCopy.autoExecPending : securityPoolCopy.manualExecution
}
export function getSecurityPoolStatusBadgeTone(systemState: SecurityPoolLifecycleState | undefined) {
	if (systemState === 'operational') return 'ok'
	if (systemState === undefined) return 'muted'
	return 'warning'
}
