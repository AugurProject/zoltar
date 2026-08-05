import type { Address } from '@zoltar/shared/ethereum'
import { getWalletActiveAppChainGuardState } from '../../../lib/actionGuards.js'
import { formatCurrencyBalance } from '../../../lib/formatters.js'
import { getOracleRequestEthGuardMessage } from '../../open-oracle/lib/oracleRequestEth.js'
import { MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_COVERAGE_COMMITMENT_ATTO_ETH, MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from './securityVault.js'

export function getVaultDepositGuardMessage({ approvalSatisfied, depositAmount, isDepositBelowMinimum, walletRepShortfallAttoRep }: { approvalSatisfied: boolean; depositAmount: bigint | undefined; isDepositBelowMinimum: boolean; walletRepShortfallAttoRep: bigint | undefined }) {
	if (depositAmount === undefined) return 'Enter a valid REP deposit amount.'
	if (depositAmount <= 0n) return undefined
	if (!approvalSatisfied) return 'Approve enough REP before depositing.'
	if (walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n) return `Need ${formatCurrencyBalance(walletRepShortfallAttoRep)} more REP in this wallet.`
	if (isDepositBelowMinimum) return `New vaults require at least ${formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP)} REP in the first deposit.`
	return undefined
}

export function getVaultWithdrawGuardMessage({
	bufferRequiredEthCost = false,
	disputeStakedRepAttoRep = 0n,
	requiredCostAttoEth,
	stagedOperationTimeoutMinutes,
	withdrawAmount,
	withdrawableRepAmountAttoRep,
	walletBalanceAttoEth,
}: {
	bufferRequiredEthCost?: boolean | undefined
	disputeStakedRepAttoRep?: bigint | undefined
	requiredCostAttoEth: bigint | undefined
	stagedOperationTimeoutMinutes: bigint | undefined
	withdrawAmount: bigint | undefined
	withdrawableRepAmountAttoRep: bigint | undefined
	walletBalanceAttoEth: bigint | undefined
}) {
	if (withdrawAmount === undefined) return 'Enter a valid REP withdraw amount.'
	if (withdrawAmount <= 0n) return undefined
	if (disputeStakedRepAttoRep > 0n) return 'Settle escalation deposits before withdrawing REP.'
	if (withdrawableRepAmountAttoRep === undefined || withdrawableRepAmountAttoRep <= 0n) return undefined
	if (withdrawAmount > withdrawableRepAmountAttoRep) return `Reduce the withdrawal to ${formatCurrencyBalance(withdrawableRepAmountAttoRep)} REP or less.`
	if (stagedOperationTimeoutMinutes === undefined || stagedOperationTimeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) return 'Enter a staged operation timeout of at least 1 minute.'
	if (stagedOperationTimeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) return 'Enter a staged operation timeout of 5 minutes or less.'
	const ethGuardMessage = getOracleRequestEthGuardMessage({
		actionLabel: 'queue this REP withdrawal',
		includeBuffer: bufferRequiredEthCost,
		requiredCostAttoEth,
		walletBalanceAttoEth,
	})
	if (ethGuardMessage !== undefined) return ethGuardMessage
	return undefined
}

export function getVaultSetCoverageCommitmentGuardMessage({
	bufferRequiredEthCost = false,
	maxCoverageCommitmentAttoEthAmount,
	requiredCostAttoEth,
	coverageCommitmentAttoEthAmount,
	stagedOperationTimeoutMinutes,
	walletBalanceAttoEth,
}: {
	bufferRequiredEthCost?: boolean | undefined
	maxCoverageCommitmentAttoEthAmount: bigint | undefined
	requiredCostAttoEth: bigint | undefined
	coverageCommitmentAttoEthAmount: bigint | undefined
	stagedOperationTimeoutMinutes: bigint | undefined
	walletBalanceAttoEth: bigint | undefined
}) {
	if (coverageCommitmentAttoEthAmount === undefined || coverageCommitmentAttoEthAmount < 0n) return 'Enter a valid coverage commitment.'
	if (coverageCommitmentAttoEthAmount !== 0n && coverageCommitmentAttoEthAmount < MIN_COVERAGE_COMMITMENT_ATTO_ETH) return `Enter at least ${formatCurrencyBalance(MIN_COVERAGE_COMMITMENT_ATTO_ETH)} ETH for a non-zero coverage commitment.`
	if (maxCoverageCommitmentAttoEthAmount !== undefined && coverageCommitmentAttoEthAmount > maxCoverageCommitmentAttoEthAmount) return `Reduce the coverage commitment to ${formatCurrencyBalance(maxCoverageCommitmentAttoEthAmount)} ETH or less.`
	if (stagedOperationTimeoutMinutes === undefined || stagedOperationTimeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) return 'Enter a staged operation timeout of at least 1 minute.'
	if (stagedOperationTimeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) return 'Enter a staged operation timeout of 5 minutes or less.'
	const ethGuardMessage = getOracleRequestEthGuardMessage({
		actionLabel: 'queue this coverage commitment update',
		includeBuffer: bufferRequiredEthCost,
		requiredCostAttoEth,
		walletBalanceAttoEth,
	})
	if (ethGuardMessage !== undefined) return ethGuardMessage
	return undefined
}

export function getVaultRedeemRepGuardMessage({ disputeStakedRepAttoRep, redeemableRepAmountAttoRep }: { disputeStakedRepAttoRep: bigint | undefined; redeemableRepAmountAttoRep: bigint | undefined }) {
	if (disputeStakedRepAttoRep !== undefined && disputeStakedRepAttoRep > 0n) return 'Settle escalation deposits before redeeming REP.'
	if (redeemableRepAmountAttoRep === undefined || redeemableRepAmountAttoRep <= 0n) return 'No redeemable REP is available for this vault.'
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
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before requesting a new price.' })
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
	resolvedPendingOperationId,
}: {
	accountAddress: Address | undefined
	hasLoadedOracleManager: boolean
	isOnActiveAppChain: boolean
	isPriceValid: boolean | undefined
	resolvedPendingOperationId: bigint | undefined
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before executing a staged operation.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (!hasLoadedOracleManager) return 'Loading price oracle details.'
	if (isPriceValid === false) return 'Wait for a valid oracle price before executing a staged operation.'
	if (resolvedPendingOperationId === undefined) return 'Enter a valid staged operation ID.'
	return undefined
}
