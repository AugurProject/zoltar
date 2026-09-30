import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { formatAdditionalCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getOracleRequestEthGuardMessage } from '../../open-oracle/lib/oracleRequestEth.js'
import { MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP, MIN_STAGED_OPERATION_TIMEOUT_MINUTES, parseTargetHealthFactorBps } from './securityVault.js'

export function getTargetHealthFactorGuardMessage(targetHealthFactor: string, minimumBps?: bigint) {
	try {
		parseTargetHealthFactorBps(targetHealthFactor, undefined, minimumBps)
		return undefined
	} catch (error) {
		return error instanceof Error ? error.message : 'Enter a valid deposit target factor.'
	}
}

export function getVaultDepositGuardMessage({
	approvalSatisfied,
	currentVaultRepBackingAttoRep,
	depositAmount,
	isDepositBelowMinimum,
	minimumVaultRepDepositAttoRep = MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP,
	targetHealthFactor = '1',
	minimumBackingRatioBps,
	walletRepShortfallAttoRep,
}: {
	approvalSatisfied: boolean
	currentVaultRepBackingAttoRep?: bigint | undefined
	depositAmount: bigint | undefined
	isDepositBelowMinimum: boolean
	minimumVaultRepDepositAttoRep?: bigint | undefined
	minimumBackingRatioBps?: bigint | undefined
	targetHealthFactor?: string | undefined
	walletRepShortfallAttoRep: bigint | undefined
}) {
	if (depositAmount === undefined) return 'Enter a valid REP deposit amount.'
	if (depositAmount <= 0n) return undefined
	const targetHealthFactorGuardMessage = getTargetHealthFactorGuardMessage(targetHealthFactor, minimumBackingRatioBps)
	if (targetHealthFactorGuardMessage !== undefined) return targetHealthFactorGuardMessage
	if (!approvalSatisfied) return 'Approve enough REP before depositing.'
	if (walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n) return `Need ${formatAdditionalCurrencyBalance(walletRepShortfallAttoRep, 'REP')} in this wallet.`
	if (isDepositBelowMinimum) {
		// Pool-held REP-per-unit rounding can credit slightly less than the deposit, so an exact minimum can still fall short.
		if (currentVaultRepBackingAttoRep !== undefined && currentVaultRepBackingAttoRep > 0n) return `This vault must hold at least ${formatCurrencyBalanceWithUnit(minimumVaultRepDepositAttoRep, 'REP')} after the deposit. Deposit more REP.`
		if (depositAmount >= minimumVaultRepDepositAttoRep) return `Pool rounding would credit this vault slightly less than the ${formatCurrencyBalanceWithUnit(minimumVaultRepDepositAttoRep, 'REP')} minimum. Deposit a little more.`
		return `New vaults require at least ${formatCurrencyBalanceWithUnit(minimumVaultRepDepositAttoRep, 'REP')} in the first deposit.`
	}
	return undefined
}

export function getVaultWithdrawGuardMessage({
	bufferRequiredEthCost = false,
	disputeStakedAttoRep = 0n,
	requiredCostAttoEth,
	stagedOperationTimeoutMinutes,
	withdrawAmount,
	withdrawableRepAmountAttoRep,
	walletBalanceAttoEth,
}: {
	bufferRequiredEthCost?: boolean | undefined
	disputeStakedAttoRep?: bigint | undefined
	requiredCostAttoEth: bigint | undefined
	stagedOperationTimeoutMinutes: bigint | undefined
	withdrawAmount: bigint | undefined
	withdrawableRepAmountAttoRep: bigint | undefined
	walletBalanceAttoEth: bigint | undefined
}) {
	if (withdrawAmount === undefined) return 'Enter a valid REP withdraw amount.'
	if (withdrawAmount <= 0n) return undefined
	if (disputeStakedAttoRep > 0n) return 'Settle escalation deposits before withdrawing REP.'
	// Without a price the REP locked by commitments is unknown, so no amount can be offered safely.
	if (withdrawableRepAmountAttoRep === undefined) return 'A REP price is needed to estimate how much REP your commitment keeps locked. Request a new oracle price or lower the commitment limit first.'
	if (withdrawableRepAmountAttoRep <= 0n) return undefined
	if (withdrawAmount > withdrawableRepAmountAttoRep) return `Reduce the withdrawal to ${formatCurrencyBalanceWithUnit(withdrawableRepAmountAttoRep, 'REP')} or less.`
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

export function getVaultRedeemRepGuardMessage({ disputeStakedAttoRep, redeemableRepAmountAttoRep, underwritingLimitAttoEth }: { disputeStakedAttoRep: bigint | undefined; redeemableRepAmountAttoRep: bigint | undefined; underwritingLimitAttoEth: bigint | undefined }) {
	if (disputeStakedAttoRep !== undefined && disputeStakedAttoRep > 0n) return 'Settle escalation deposits before redeeming REP.'
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
	if (isPriceValid === false) return 'Request a new price in Price oracle before executing this operation.'
	if (resolvedPendingOperationId === undefined) return 'Enter a valid staged operation ID.'
	return undefined
}
