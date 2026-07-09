import type { Address } from '@zoltar/shared/ethereum'
import { formatCurrencyBalance } from './formatters.js'
import { getOracleRequestEthGuardMessage } from './oracleRequestEth.js'
import { MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_SECURITY_BOND_ALLOWANCE, MIN_SECURITY_VAULT_REP_DEPOSIT, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from './securityVault.js'

export function getVaultDepositGuardMessage({ approvalSatisfied, depositAmount, isDepositBelowMinimum, repBalanceGap }: { approvalSatisfied: boolean; depositAmount: bigint | undefined; isDepositBelowMinimum: boolean; repBalanceGap: bigint | undefined }) {
	if (depositAmount === undefined) return 'Enter a valid REP deposit amount.'
	if (depositAmount <= 0n) return undefined
	if (!approvalSatisfied) return 'Approve enough REP before depositing.'
	if (repBalanceGap !== undefined && repBalanceGap > 0n) return `Need ${formatCurrencyBalance(repBalanceGap)} more REP in this wallet.`
	if (isDepositBelowMinimum) return `New vaults require at least ${formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)} REP in the first deposit.`
	return undefined
}

export function getVaultWithdrawGuardMessage({
	bufferRequiredEthCost = false,
	requiredEthCost,
	stagedOperationTimeoutMinutes,
	withdrawAmount,
	withdrawableRepAmount,
	walletEthBalance,
}: {
	bufferRequiredEthCost?: boolean | undefined
	requiredEthCost: bigint | undefined
	stagedOperationTimeoutMinutes: bigint | undefined
	withdrawAmount: bigint | undefined
	withdrawableRepAmount: bigint | undefined
	walletEthBalance: bigint | undefined
}) {
	if (withdrawAmount === undefined) return 'Enter a valid REP withdraw amount.'
	if (withdrawAmount <= 0n) return undefined
	if (withdrawableRepAmount === undefined || withdrawableRepAmount <= 0n) return undefined
	if (withdrawAmount > withdrawableRepAmount) return `Reduce the withdrawal to ${formatCurrencyBalance(withdrawableRepAmount)} REP or less.`
	if (stagedOperationTimeoutMinutes === undefined || stagedOperationTimeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) return 'Enter a staged operation timeout of at least 1 minute.'
	if (stagedOperationTimeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) return 'Enter a staged operation timeout of 5 minutes or less.'
	const ethGuardMessage = getOracleRequestEthGuardMessage({
		actionLabel: 'queue this REP withdrawal',
		includeBuffer: bufferRequiredEthCost,
		requiredEthCost,
		walletEthBalance,
	})
	if (ethGuardMessage !== undefined) return ethGuardMessage
	return undefined
}

export function getVaultSetSecurityBondAllowanceGuardMessage({
	bufferRequiredEthCost = false,
	maxSecurityBondAllowanceAmount,
	requiredEthCost,
	securityBondAllowanceAmount,
	stagedOperationTimeoutMinutes,
	walletEthBalance,
}: {
	bufferRequiredEthCost?: boolean | undefined
	maxSecurityBondAllowanceAmount: bigint | undefined
	requiredEthCost: bigint | undefined
	securityBondAllowanceAmount: bigint | undefined
	stagedOperationTimeoutMinutes: bigint | undefined
	walletEthBalance: bigint | undefined
}) {
	if (securityBondAllowanceAmount === undefined || securityBondAllowanceAmount < 0n) return 'Enter a valid security bond allowance.'
	if (securityBondAllowanceAmount !== 0n && securityBondAllowanceAmount < MIN_SECURITY_BOND_ALLOWANCE) return `Enter at least ${formatCurrencyBalance(MIN_SECURITY_BOND_ALLOWANCE)} ETH for a non-zero allowance.`
	if (maxSecurityBondAllowanceAmount !== undefined && securityBondAllowanceAmount > maxSecurityBondAllowanceAmount) return `Reduce the security bond allowance to ${formatCurrencyBalance(maxSecurityBondAllowanceAmount)} ETH or less.`
	if (stagedOperationTimeoutMinutes === undefined || stagedOperationTimeoutMinutes < MIN_STAGED_OPERATION_TIMEOUT_MINUTES) return 'Enter a staged operation timeout of at least 1 minute.'
	if (stagedOperationTimeoutMinutes > MAX_STAGED_OPERATION_TIMEOUT_MINUTES) return 'Enter a staged operation timeout of 5 minutes or less.'
	const ethGuardMessage = getOracleRequestEthGuardMessage({
		actionLabel: 'queue this bond allowance update',
		includeBuffer: bufferRequiredEthCost,
		requiredEthCost,
		walletEthBalance,
	})
	if (ethGuardMessage !== undefined) return ethGuardMessage
	return undefined
}

export function getVaultRedeemRepGuardMessage({ escalationEscrowedRep, redeemableRepAmount }: { escalationEscrowedRep: bigint | undefined; redeemableRepAmount: bigint | undefined }) {
	if (escalationEscrowedRep !== undefined && escalationEscrowedRep > 0n) return 'Settle escalation deposits before redeeming REP.'
	if (redeemableRepAmount === undefined || redeemableRepAmount <= 0n) return 'No redeemable REP is available for this vault.'
	return undefined
}

export function getVaultRequestPriceGuardMessage({
	accountAddress,
	hasLoadedSelectedPool,
	bufferRequiredEthCost = true,
	isMainnet,
	pendingReportId,
	requiredEthCost,
	walletEthBalance,
}: {
	accountAddress: Address | undefined
	hasLoadedSelectedPool: boolean
	bufferRequiredEthCost?: boolean | undefined
	isMainnet: boolean
	pendingReportId: bigint | undefined
	requiredEthCost: bigint | undefined
	walletEthBalance: bigint | undefined
}) {
	if (accountAddress === undefined) return 'Connect a wallet before requesting a new price.'
	if (!isMainnet) return undefined
	if (!hasLoadedSelectedPool) return 'Load a security pool before requesting a new price.'
	if (pendingReportId !== undefined && pendingReportId > 0n) return 'A pending price report already exists for this pool.'
	const ethGuardMessage = getOracleRequestEthGuardMessage({
		actionLabel: 'request a new price',
		includeBuffer: bufferRequiredEthCost,
		requiredEthCost,
		walletEthBalance,
	})
	if (ethGuardMessage !== undefined) return ethGuardMessage
	return undefined
}

export function getVaultExecutePendingOperationGuardMessage({
	accountAddress,
	hasLoadedOracleManager,
	isMainnet,
	isPriceValid,
	resolvedPendingOperationId,
}: {
	accountAddress: Address | undefined
	hasLoadedOracleManager: boolean
	isMainnet: boolean
	isPriceValid: boolean | undefined
	resolvedPendingOperationId: bigint | undefined
}) {
	if (accountAddress === undefined) return 'Connect a wallet before executing a staged operation.'
	if (!isMainnet) return undefined
	if (!hasLoadedOracleManager) return 'Load the price oracle before executing a staged operation.'
	if (isPriceValid === false) return 'Wait for a valid oracle price before executing a staged operation.'
	if (resolvedPendingOperationId === undefined) return 'Enter a valid staged operation id.'
	return undefined
}
