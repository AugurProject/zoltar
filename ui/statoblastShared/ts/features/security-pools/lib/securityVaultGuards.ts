import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { getOracleRequestEthGuardMessage } from '../../open-oracle/lib/oracleRequestEth.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export function getVaultRedeemRepGuardMessage({ disputeStakedAttoRep, redeemableRepAmountAttoRep, underwritingLimitAttoEth }: { disputeStakedAttoRep: bigint | undefined; redeemableRepAmountAttoRep: bigint | undefined; underwritingLimitAttoEth: bigint | undefined }) {
	if (disputeStakedAttoRep !== undefined && disputeStakedAttoRep > 0n) return securityPoolCopy.escalationWithdrawalRequiredDetail
	if (redeemableRepAmountAttoRep === undefined || redeemableRepAmountAttoRep <= 0n) return 'No redeemable REP is available for this vault.'
	// `redeemRepFromVault` reverts while the vault still holds a commitment.
	if (underwritingLimitAttoEth === undefined) return 'Refresh vault details before redeeming REP.'
	if (underwritingLimitAttoEth > 0n) return 'Set your commitment limit to 0 ETH before redeeming REP. The pool keeps vault REP locked while the vault still has a commitment.'
	return undefined
}

export function getVaultRequestPriceGuardMessage({
	accountAddress,
	hasLoadedSelectedPool,
	bufferRequiredEthCost = true,
	isOnActiveAppChain,
	isPriceValid,
	pendingReportId,
	requiredCostAttoEth,
	walletBalanceAttoEth,
}: {
	accountAddress: Address | undefined
	hasLoadedSelectedPool: boolean
	bufferRequiredEthCost?: boolean | undefined
	isOnActiveAppChain: boolean
	isPriceValid: boolean | undefined
	pendingReportId: bigint | undefined
	requiredCostAttoEth: bigint | undefined
	walletBalanceAttoEth: bigint | undefined
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('requesting a new price') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (!hasLoadedSelectedPool) return 'Select a security pool before requesting a new price.'
	if (pendingReportId !== undefined && pendingReportId > 0n) return 'A pending price report already exists for this pool.'
	if (isPriceValid === true) return 'The current oracle price is still valid.'
	const ethGuardMessage = getOracleRequestEthGuardMessage({
		actionLabel: 'request a new price',
		includeBuffer: bufferRequiredEthCost,
		requiredCostAttoEth,
		walletBalanceAttoEth,
	})
	if (ethGuardMessage !== undefined) return ethGuardMessage
	return undefined
}

export function getVaultExecutePendingOperationGuardMessage({
	accountAddress,
	hasLoadedOracleManager,
	isOnActiveAppChain,
	isPriceValid,
	pendingSettlementOperationIds = [],
	resolvedPendingOperationId,
}: {
	accountAddress: Address | undefined
	hasLoadedOracleManager: boolean
	isOnActiveAppChain: boolean
	isPriceValid: boolean | undefined
	pendingSettlementOperationIds?: readonly bigint[] | undefined
	resolvedPendingOperationId: bigint | undefined
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('executing a staged operation') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (!hasLoadedOracleManager) return securityPoolCopy.loadingOracleDetails
	if (isPriceValid === false) {
		if (resolvedPendingOperationId !== undefined && pendingSettlementOperationIds.includes(resolvedPendingOperationId)) return securityPoolCopy.autoExecAfterSettlement
		return 'Request a new price in Price oracle before executing this operation.'
	}
	if (resolvedPendingOperationId === undefined) return 'Enter a valid staged operation ID.'
	return undefined
}
