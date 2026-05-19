import type { Address } from 'viem'
import { formatCurrencyBalance } from './formatters.js'
import { MIN_SECURITY_BOND_ALLOWANCE, MIN_SECURITY_VAULT_REP_DEPOSIT } from './securityVault.js'
import { getWalletPresentation } from './userCopy.js'

export function getVaultApprovalGuardMessage({ accountAddress, isMainnet, selectedVaultDetailsLoaded, selectedVaultIsOwnedByAccount }: { accountAddress: Address | undefined; isMainnet: boolean; selectedVaultDetailsLoaded: boolean; selectedVaultIsOwnedByAccount: boolean }) {
	const walletPresentation = getWalletPresentation({ accountAddress, isMainnet })
	if (walletPresentation !== undefined) return walletPresentation.detail
	if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to approve REP.'
	if (!selectedVaultDetailsLoaded) return 'Refresh the vault first.'
	return undefined
}

export function getVaultDepositGuardMessage({
	accountAddress,
	approvalSatisfied,
	isDepositBelowMinimum,
	isMainnet,
	repBalanceGap,
	selectedVaultDetailsLoaded,
	selectedVaultIsOwnedByAccount,
}: {
	accountAddress: Address | undefined
	approvalSatisfied: boolean
	isDepositBelowMinimum: boolean
	isMainnet: boolean
	repBalanceGap: bigint | undefined
	selectedVaultDetailsLoaded: boolean
	selectedVaultIsOwnedByAccount: boolean
}) {
	if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to deposit REP.'
	if (accountAddress === undefined) return 'Connect a wallet before depositing REP.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before depositing REP.'
	if (!selectedVaultDetailsLoaded) return 'Refresh the vault before depositing REP.'
	if (!approvalSatisfied) return 'Approve enough REP before depositing.'
	if (repBalanceGap !== undefined && repBalanceGap > 0n) return `Need ${formatCurrencyBalance(repBalanceGap)} more REP in this wallet.`
	if (isDepositBelowMinimum) return `New vaults require at least ${formatCurrencyBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)} REP in the first deposit.`
	return undefined
}

export function getVaultWithdrawGuardMessage({
	accountAddress,
	hasValidOraclePrice,
	isMainnet,
	selectedVaultIsOwnedByAccount,
	withdrawAmount,
	withdrawableRepAmount,
}: {
	accountAddress: Address | undefined
	hasValidOraclePrice: boolean
	isMainnet: boolean
	selectedVaultIsOwnedByAccount: boolean
	withdrawAmount: bigint | undefined
	withdrawableRepAmount: bigint | undefined
}) {
	if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to withdraw REP.'
	if (accountAddress === undefined) return 'Connect a wallet before withdrawing REP.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before withdrawing REP.'
	if (!hasValidOraclePrice) return 'A valid oracle price is required before withdrawing REP.'
	if (withdrawAmount === undefined || withdrawAmount <= 0n) return 'Enter a valid REP withdraw amount.'
	if (withdrawableRepAmount === undefined || withdrawableRepAmount <= 0n) return 'No REP is currently withdrawable from this vault.'
	if (withdrawAmount > withdrawableRepAmount) return `Reduce the withdrawal to ${formatCurrencyBalance(withdrawableRepAmount)} REP or less.`
	return undefined
}

export function getVaultSetSecurityBondAllowanceGuardMessage({
	hasValidOraclePrice,
	isMainnet,
	maxSecurityBondAllowanceAmount,
	securityBondAllowanceAmount,
	selectedVaultDetailsLoaded,
	selectedVaultIsOwnedByAccount,
}: {
	hasValidOraclePrice: boolean
	isMainnet: boolean
	maxSecurityBondAllowanceAmount: bigint | undefined
	securityBondAllowanceAmount: bigint | undefined
	selectedVaultDetailsLoaded: boolean
	selectedVaultIsOwnedByAccount: boolean
}) {
	if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to set the security bond allowance.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before setting the security bond allowance.'
	if (!selectedVaultDetailsLoaded) return 'Refresh the vault before setting the security bond allowance.'
	if (!hasValidOraclePrice) return 'A valid oracle price is required before setting the security bond allowance.'
	if (securityBondAllowanceAmount === undefined || securityBondAllowanceAmount < 0n) return 'Enter a valid security bond allowance.'
	if (securityBondAllowanceAmount !== 0n && securityBondAllowanceAmount < MIN_SECURITY_BOND_ALLOWANCE) return `Enter at least ${formatCurrencyBalance(MIN_SECURITY_BOND_ALLOWANCE)} ETH for a non-zero allowance.`
	if (maxSecurityBondAllowanceAmount !== undefined && securityBondAllowanceAmount > maxSecurityBondAllowanceAmount) {
		return `Reduce the security bond allowance to ${formatCurrencyBalance(maxSecurityBondAllowanceAmount)} ETH or less.`
	}
	return undefined
}

export function getVaultClaimFeesGuardMessage({ hasClaimableFees, isMainnet, selectedVaultIsOwnedByAccount }: { hasClaimableFees: boolean; isMainnet: boolean; selectedVaultIsOwnedByAccount: boolean }) {
	if (!selectedVaultIsOwnedByAccount) return 'Select your own vault to claim fees.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before claiming fees.'
	if (!hasClaimableFees) return 'No claimable fees are available for this vault.'
	return undefined
}

export function getVaultRequestPriceGuardMessage({ accountAddress, hasLoadedSelectedPool, isMainnet, pendingReportId }: { accountAddress: Address | undefined; hasLoadedSelectedPool: boolean; isMainnet: boolean; pendingReportId: bigint | undefined }) {
	if (accountAddress === undefined) return 'Connect a wallet before requesting a new price.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before requesting a new price.'
	if (!hasLoadedSelectedPool) return 'Load a security pool before requesting a new price.'
	if (pendingReportId !== undefined && pendingReportId > 0n) return 'A pending price report already exists for this pool.'
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
	if (!isMainnet) return 'Switch to Ethereum mainnet before executing a staged operation.'
	if (!hasLoadedOracleManager) return 'Load the price oracle before executing a staged operation.'
	if (isPriceValid === false) return 'Wait for a valid oracle price before executing a staged operation.'
	if (resolvedPendingOperationId === undefined) return 'Enter a valid staged operation id.'
	return undefined
}
